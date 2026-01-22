#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, execSync } from "child_process";
import { Config, loadConfig, saveConfig, detectSSHRemotes, detectSSHFromHistory } from "./config";
import { promptConfirm, promptSelect, promptInput, promptMultiSelect } from "./prompts";
import { startMonitor } from "./monitor";

function getVersion(): string {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

async function addRemotes(existing: string[]): Promise<string[]> {
  const remotes = [...existing];

  // Collect all detected remotes
  const allDetected: { name: string; source: string }[] = [];

  // From SSH config
  const sshHosts = detectSSHRemotes();
  for (const host of sshHosts) {
    if (!remotes.includes(host.name)) {
      const details = [host.user, host.hostname].filter(Boolean).join("@");
      allDetected.push({
        name: host.name,
        source: details ? `config: ${details}` : "config",
      });
    }
  }

  // From bash/zsh history
  const historyRemotes = detectSSHFromHistory();
  for (const remote of historyRemotes) {
    if (!remotes.includes(remote) && !allDetected.find(d => d.name === remote)) {
      allDetected.push({
        name: remote,
        source: "history",
      });
    }
  }

  if (allDetected.length > 0) {
    const choices = allDetected.map(d => `${d.name} (${d.source})`);

    const selected = await promptMultiSelect(
      "Select SSH remotes to add (space to toggle, enter to confirm)",
      choices
    );

    for (const msg of selected) {
      const detected = allDetected.find(d => `${d.name} (${d.source})` === msg);
      if (detected) {
        remotes.push(detected.name);
      }
    }
  }

  // Add custom remotes
  let addMore = await promptConfirm("Add a custom SSH remote?");
  while (addMore) {
    const remoteName = await promptInput("Enter SSH remote (e.g., user@host)");
    if (remoteName && !remotes.includes(remoteName)) {
      remotes.push(remoteName);
      console.log(`Added: ${remoteName}`);
    }
    addMore = await promptConfirm("Add another?");
  }

  return remotes;
}

function startBackground(remote: string): void {
  const child = spawn(process.execPath, [__filename, "--daemon", remote], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, SHOTMON_BACKGROUND: "1" },
  });
  child.unref();
  console.log(`Started in background (PID: ${child.pid})`);
  console.log(`Logs: ~/.config/clipshot/logs/`);
}

function showHelp(): void {
  console.log(`Usage: clipshot <command>

Commands:
  start      Start monitoring in background
  stop       Stop background process
  status     Show if running
  config     Modify configuration
  uninstall  Remove config and stop process

Run without command to setup/configure.
`);
}

function uninstall(): void {
  // Stop any running process
  try {
    const result = execSync("pgrep -f 'node.*[c]lipshot.*--daemon'", { encoding: "utf8" });
    const pids = result.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      process.kill(parseInt(pid), "SIGTERM");
    }
    if (pids.length > 0) {
      console.log("Stopped running process");
    }
  } catch {
    // Not running
  }

  // Remove config directory
  const configDir = path.join(os.homedir(), ".config", "clipshot");
  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true });
    console.log(`Removed ${configDir}`);
  }

  console.log("\nNow run: npm uninstall -g clipshot");
}

function stopBackground(): void {
  try {
    // Use bracket trick to avoid pgrep matching itself
    const result = execSync("pgrep -f 'node.*[c]lipshot.*--daemon'", { encoding: "utf8" });
    const pids = result.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      process.kill(parseInt(pid), "SIGTERM");
      console.log(`Stopped process ${pid}`);
    }
    if (pids.length === 0) {
      console.log("No clipshot process running");
    }
  } catch {
    console.log("No clipshot process running");
  }
}

function showStatus(): void {
  try {
    // Use bracket trick to avoid pgrep matching itself
    const result = execSync("pgrep -af 'node.*[c]lipshot.*--daemon'", { encoding: "utf8" });
    const lines = result.trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      for (const line of lines) {
        // Parse "PID command args"
        const match = line.match(/^(\d+)\s+.*--daemon\s+(.+)$/);
        if (match) {
          const pid = match[1];
          const target = match[2];
          console.log(`Running (PID: ${pid}) -> ${target}`);
        } else {
          const pid = line.split(/\s+/)[0];
          console.log(`Running (PID: ${pid})`);
        }
      }
    } else {
      console.log("Not running");
    }
  } catch {
    console.log("Not running");
  }
}

async function runConfig(): Promise<Config> {
  let config: Config | null = loadConfig();

  if (!config || config.remotes.length === 0) {
    if (!config) {
      console.log("Welcome! Let's add some SSH remotes.\n");
    } else {
      console.log("No remotes configured. Let's add some.\n");
    }

    const remotes = await addRemotes([]);
    config = { remotes };
    saveConfig(config);

    if (remotes.length > 0) {
      console.log(`\nSaved ${remotes.length} remote(s).`);
    }
  } else {
    console.log(`SSH remotes: ${config.remotes.join(", ")}\n`);

    const modify = await promptConfirm("Modify remotes?");
    if (modify) {
      const toKeep = await promptMultiSelect(
        "Select remotes to keep (space to toggle, enter to confirm)",
        config.remotes
      );

      const remotes = await addRemotes(toKeep);
      config = { remotes };
      saveConfig(config);
      console.log(`\nSaved ${remotes.length} remote(s).`);
    }
  }

  return config;
}

async function startCommand(): Promise<void> {
  const config = loadConfig();

  if (!config || config.remotes.length === 0) {
    console.log("No remotes configured. Run 'clipshot' first to set up.");
    process.exit(1);
  }

  // Add "local" option to the list
  const options = ["local", ...config.remotes];

  let selected: string;
  if (options.length === 1) {
    selected = options[0];
  } else {
    selected = await promptSelect("Select target", options);
  }

  // Stop any existing process before starting new one
  try {
    const result = execSync("pgrep -f 'node.*[c]lipshot.*--daemon'", { encoding: "utf8" });
    const pids = result.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      process.kill(parseInt(pid), "SIGTERM");
    }
    if (pids.length > 0) {
      console.log(`Stopped previous process`);
    }
  } catch {
    // Not running, continue
  }

  startBackground(selected);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle --daemon (internal use)
  if (command === "--daemon") {
    const remote = args[1];
    if (remote) {
      await startMonitor(remote);
    }
    return;
  }

  console.log(`clipshot v${getVersion()}\n`);

  // Handle commands
  if (command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  if (command === "stop") {
    stopBackground();
    return;
  }

  if (command === "status") {
    showStatus();
    return;
  }

  if (command === "start") {
    await startCommand();
    return;
  }

  if (command === "config") {
    await runConfig();
    return;
  }

  if (command === "uninstall") {
    uninstall();
    return;
  }

  // No command - run config flow then auto-start
  const config = await runConfig();

  if (config.remotes.length === 0) {
    console.log("No remotes configured. Run clipshot again to add remotes.");
    process.exit(0);
  }

  console.log("\n--- Starting monitor ---\n");
  await startCommand();
}

main().catch(console.error);
