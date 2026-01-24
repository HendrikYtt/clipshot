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

const isWindows = process.platform === "win32";

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
  try {
    // PowerShell script to get clipboard image as base64
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
  $ms = New-Object System.IO.MemoryStream
  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [Convert]::ToBase64String($ms.ToArray())
}
`;
    // Encode as UTF-16LE base64 for -EncodedCommand
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    // Use powershell.exe for WSL, powershell for native Windows
    const psCmd = isWindows ? "powershell" : "powershell.exe";
    const result = execSync(`${psCmd} -NoProfile -WindowStyle Hidden -EncodedCommand ${encoded}`, {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    }).trim();

    if (result && result.length > 0) {
      return Buffer.from(result, "base64");
    }
    return null;
  } catch {
    return null;
  }
}

async function getClipboardImageNative(): Promise<Buffer | null> {
  try {
    // Try using @crosscopy/clipboard for native Linux/macOS
    // @ts-ignore
    const Clipboard = require("@crosscopy/clipboard").default;
    const hasImage = await Clipboard.hasImage();
    if (!hasImage) {
      return null;
    }
    const base64 = await Clipboard.getImageBase64();
    if (!base64) {
      return null;
    }
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

async function getClipboardImage(): Promise<Buffer | null> {
  if (isWindows || isWSL()) {
    return getClipboardImageWindows();
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
  // Named host without user - fall back to ~
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
    // @ts-ignore
    const Clipboard = require("@crosscopy/clipboard").default;
    await Clipboard.setText(text);
  } catch {
    // Ignore clipboard errors
  }
}

async function copyToClipboard(text: string): Promise<void> {
  if (isWindows || isWSL()) {
    copyToClipboardWindows(text);
  } else {
    await copyToClipboardNative(text);
  }
}

export async function startMonitor(remote: string): Promise<void> {
  // Initialize logging
  logFile = createNewLogFile();
  logStartTime = Date.now();

  const wsl = isWSL();
  const env = isWindows ? "Windows" : (wsl ? "WSL" : "Native");
  log(`Starting monitor for: ${remote}`);
  log(`Environment: ${env}`);
  log(`Log file: ${logFile}`);
  if (remote === "local") {
    log(`Saving to: ${getLocalScreenshotDir()}`);
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
      const imageBuffer = await getClipboardImage();

      if (!imageBuffer) {
        return;
      }

      const currentHash = getImageHash(imageBuffer);

      if (currentHash !== lastImageHash) {
        lastImageHash = currentHash;

        const filename = generateFilename();
        const size = Math.round(imageBuffer.length / 1024);

        log(`New screenshot: ${filename} (${size}KB)`);

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
    } catch (err) {
      log(`Error: ${err}`);
    }
  };

  // Start polling
  setInterval(poll, POLL_INTERVAL_MS);

  // Keep process running
  await new Promise(() => {});
}
