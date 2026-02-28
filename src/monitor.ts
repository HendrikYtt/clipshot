import { spawn, execSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const POLL_INTERVAL_MS = 200;
const LOG_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

let lastImageHash: string | null = null;
let logFile: string | null = null;
let logStartTime: number = 0;
let lastSeenScreenshotMtime: number = 0;

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

function isWSL(): boolean {
  if (isWindows) {
    return false;
  }
  try {
    const release = fs.readFileSync("/proc/version", "utf8");
    return release.toLowerCase().includes("microsoft") || release.toLowerCase().includes("wsl");
  } catch {
    return false;
  }
}

function getLogDir(): string {
  return path.join(os.homedir(), ".config", "clipshot", "logs");
}

function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function createNewLogFile(): string {
  ensureLogDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `clipshot-${timestamp}.log`;
  return path.join(getLogDir(), filename);
}

function log(message: string): void {
  const now = Date.now();
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;

  // Check if we need a new log file
  if (!logFile || (now - logStartTime) > LOG_MAX_AGE_MS) {
    logFile = createNewLogFile();
    logStartTime = now;
  }

  // Write to file
  fs.appendFileSync(logFile, line);

  // Also print to console if not in background
  if (!process.env.SHOTMON_BACKGROUND) {
    process.stdout.write(message + "\n");
  }
}

async function getClipboardImageWindows(): Promise<Buffer | null> {
  const tempFileName = `clipshot-clipboard-${Date.now()}.png`;
  let tempFilePath: string | null = null;

  try {
    // PowerShell script to get clipboard image and save directly to temp file
    // This avoids base64 encoding and stdout buffer limits for large images
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
  $tempPath = Join-Path $env:TEMP '${tempFileName}'
  $img.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $tempPath
}
`;
    // Encode as UTF-16LE base64 for -EncodedCommand
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    // Use powershell.exe for WSL, powershell for native Windows
    const psCmd = isWindows ? "powershell" : "powershell.exe";
    const windowsPath = execSync(`${psCmd} -NoProfile -WindowStyle Hidden -EncodedCommand ${encoded}`, {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    }).trim();

    if (!windowsPath || windowsPath.length === 0) {
      return null;
    }

    // Convert path for WSL if needed
    if (isWindows) {
      tempFilePath = windowsPath;
    } else {
      tempFilePath = execSync(`wslpath '${windowsPath}'`, { encoding: "utf8", timeout: 2000 }).trim();
    }

    if (fs.existsSync(tempFilePath)) {
      const imageBuffer = fs.readFileSync(tempFilePath);
      fs.unlinkSync(tempFilePath);
      return imageBuffer;
    }

    return null;
  } catch {
    // Try to clean up temp file if it was created
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
    return null;
  }
}

async function getClipboardImageNative(): Promise<Buffer | null> {
  try {
    // Check if clipboard has image using xclip
    const targets = execSync("xclip -selection clipboard -t TARGETS -o 2>/dev/null", {
      encoding: "utf8",
      timeout: 2000,
    });

    if (!targets.includes("image/png")) {
      return null;
    }

    // Get image data
    const imageData = execSync("xclip -selection clipboard -t image/png -o 2>/dev/null", {
      encoding: "buffer",
      timeout: 5000,
      maxBuffer: 50 * 1024 * 1024, // 50MB max
    });

    return imageData.length > 0 ? imageData : null;
  } catch {
    return null;
  }
}

function getMacScreenshotDir(): string {
  try {
    const loc = execSync("defaults read com.apple.screencapture location 2>/dev/null", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    if (loc) return loc;
  } catch {
    // defaults command failed — key not set
  }
  return path.join(os.homedir(), "Desktop");
}

async function getClipboardImageMac(): Promise<Buffer | null> {
  try {
    const imageData = execSync("pngpaste - 2>/dev/null", {
      encoding: "buffer",
      timeout: 5000,
      maxBuffer: 50 * 1024 * 1024, // 50MB max
    });
    return imageData.length > 0 ? imageData : null;
  } catch {
    // pngpaste exits non-zero if no image on clipboard
    return null;
  }
}

function getLatestMacScreenshot(): Buffer | null {
  const dir = getMacScreenshotDir();
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith("Screenshot") && f.endsWith(".png"))
      .map((f) => {
        const fullPath = path.join(dir, f);
        const stat = fs.statSync(fullPath);
        return { path: fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const newest = files[0];
    if (newest.mtime <= lastSeenScreenshotMtime) return null;

    // Wait briefly to ensure file is fully written
    const now = Date.now();
    if (now - newest.mtime < 300) {
      return null; // Too fresh — check again next poll
    }

    lastSeenScreenshotMtime = newest.mtime;
    return fs.readFileSync(newest.path);
  } catch {
    return null;
  }
}

async function getClipboardImage(): Promise<Buffer | null> {
  if (isWindows || isWSL()) {
    return getClipboardImageWindows();
  }
  if (isMac) {
    return getClipboardImageMac();
  }
  return getClipboardImageNative();
}

function getImageHash(buffer: Buffer): string {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

function generateFilename(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `screenshot-${timestamp}.png`;
}

function getLocalScreenshotDir(): string {
  return path.join(os.homedir(), "clipshot-screenshots");
}

function saveLocal(imageBuffer: Buffer, filename: string): { success: boolean; path: string } {
  const dir = getLocalScreenshotDir();
  const filePath = path.join(dir, filename);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, imageBuffer);
    return { success: true, path: filePath };
  } catch {
    return { success: false, path: filePath };
  }
}

function getRemoteHomePath(remote: string): string {
  // Extract username from user@host format
  const match = remote.match(/^([^@]+)@/);
  if (match) {
    const user = match[1];
    return user === "root" ? "/root" : `/home/${user}`;
  }
  // Named host without user — resolve via ssh -G
  try {
    const output = execSync(`ssh -G ${remote} 2>/dev/null`, {
      encoding: "utf8",
      timeout: 3000,
    });
    const userMatch = output.match(/^user\s+(.+)$/m);
    if (userMatch) {
      const user = userMatch[1];
      return user === "root" ? "/root" : `/home/${user}`;
    }
  } catch {
    // ssh -G failed
  }
  return "~";
}

async function pipeToRemote(imageBuffer: Buffer, remote: string, filename: string): Promise<{ success: boolean; path: string; error?: string }> {
  const homeDir = getRemoteHomePath(remote);
  const remotePath = `${homeDir}/clipshot-screenshots/${filename}`;

  return new Promise((resolve) => {
    // Use ~ in the command so SSH resolves it correctly
    const proc = spawn("ssh", [
      remote,
      `mkdir -p ~/clipshot-screenshots && cat > ~/clipshot-screenshots/${filename}`
    ], {
      windowsHide: true,
    });

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.stdin.write(imageBuffer);
    proc.stdin.end();

    proc.on("close", (code) => {
      // Return the explicit path for clipboard, but command used ~ for reliability
      resolve({ success: code === 0, path: remotePath, error: stderr.trim() || undefined });
    });

    proc.on("error", (err) => {
      resolve({ success: false, path: remotePath, error: err.message });
    });
  });
}

function copyToClipboardWindows(text: string): void {
  try {
    if (isWindows) {
      // On native Windows, use PowerShell's Set-Clipboard
      const escaped = text.replace(/'/g, "''");
      execSync(`powershell -NoProfile -WindowStyle Hidden -Command "Set-Clipboard -Value '${escaped}'"`, { timeout: 2000, windowsHide: true });
    } else {
      // On WSL, use clip.exe
      execSync(`echo -n '${text.replace(/'/g, "'\\''")}' | clip.exe`, { timeout: 2000 });
    }
  } catch {
    // Ignore clipboard errors
  }
}

async function copyToClipboardNative(text: string): Promise<void> {
  try {
    // Use xclip to set clipboard text
    const escaped = text.replace(/'/g, "'\\''");
    execSync(`echo -n '${escaped}' | xclip -selection clipboard`, { timeout: 2000 });
  } catch {
    // Ignore clipboard errors
  }
}

async function copyToClipboardMac(text: string): Promise<void> {
  try {
    const escaped = text.replace(/'/g, "'\\''");
    execSync(`echo -n '${escaped}' | pbcopy`, { timeout: 2000 });
  } catch {
    // Ignore clipboard errors
  }
}

async function copyToClipboard(text: string): Promise<void> {
  if (isWindows || isWSL()) {
    copyToClipboardWindows(text);
  } else if (isMac) {
    await copyToClipboardMac(text);
  } else {
    await copyToClipboardNative(text);
  }
}

async function processNewImage(
  imageBuffer: Buffer,
  remote: string,
  source: "clipboard" | "file"
): Promise<void> {
  const filename = generateFilename();
  const size = Math.round(imageBuffer.length / 1024);

  log(`New screenshot (${source}): ${filename} (${size}KB)`);

  if (remote === "local") {
    const result = saveLocal(imageBuffer, filename);
    if (result.success) {
      log(`  -> Saved: ${result.path}`);
      await copyToClipboard(result.path);
      log(`  -> Copied to clipboard`);
    } else {
      log(`  -> Failed to save locally`);
    }
  } else {
    const result = await pipeToRemote(imageBuffer, remote, filename);
    if (result.success) {
      log(`  -> Sent to ${remote}:${result.path}`);
      await copyToClipboard(result.path);
      log(`  -> Copied to clipboard`);
    } else {
      log(`  -> Failed to send to ${remote}`);
      if (result.error) {
        log(`  -> Error: ${result.error}`);
      }
    }
  }
}

export async function startMonitor(remote: string): Promise<void> {
  // Initialize logging
  logFile = createNewLogFile();
  logStartTime = Date.now();

  const wsl = isWSL();
  const env = isWindows ? "Windows" : (wsl ? "WSL" : (isMac ? "macOS" : "Linux"));
  log(`Starting monitor for: ${remote}`);
  log(`Environment: ${env}`);
  log(`Log file: ${logFile}`);
  if (remote === "local") {
    log(`Saving to: ${getLocalScreenshotDir()}`);
  }

  // macOS-specific initialization
  if (isMac) {
    // Check pngpaste availability
    try {
      execSync("which pngpaste", { encoding: "utf8", timeout: 2000 });
    } catch {
      log("Warning: pngpaste not found. Install with: brew install pngpaste");
      log("  Clipboard detection disabled — file watcher still active.");
    }

    // Initialize lastSeenScreenshotMtime to newest existing Screenshot file
    const screenshotDir = getMacScreenshotDir();
    try {
      const files = fs.readdirSync(screenshotDir)
        .filter((f) => f.startsWith("Screenshot") && f.endsWith(".png"))
        .map((f) => {
          const stat = fs.statSync(path.join(screenshotDir, f));
          return stat.mtimeMs;
        });
      if (files.length > 0) {
        lastSeenScreenshotMtime = Math.max(...files);
      }
    } catch {
      // Directory might not exist
    }
    log(`Watching screenshot dir: ${screenshotDir}`);
  }

  log("");
  log("Monitoring clipboard... (Ctrl+C to stop)");
  log("");

  // Initialize with current clipboard state
  const initialImage = await getClipboardImage();
  if (initialImage) {
    lastImageHash = getImageHash(initialImage);
  }

  const poll = async () => {
    try {
      // Check clipboard
      const imageBuffer = await getClipboardImage();

      if (imageBuffer) {
        const currentHash = getImageHash(imageBuffer);
        if (currentHash !== lastImageHash) {
          lastImageHash = currentHash;
          await processNewImage(imageBuffer, remote, "clipboard");
        }
      }

      // On macOS, also check for new screenshot files (Cmd+Shift screenshots)
      if (isMac) {
        const fileBuffer = getLatestMacScreenshot();
        if (fileBuffer) {
          const fileHash = getImageHash(fileBuffer);
          if (fileHash !== lastImageHash) {
            lastImageHash = fileHash;
            await processNewImage(fileBuffer, remote, "file");
          }
        }
      }
    } catch (err) {
      log(`Error: ${err}`);
    }
  };

  // Start polling
  setInterval(poll, POLL_INTERVAL_MS);

  // Keep process running
  await new Promise(() => {});
}
