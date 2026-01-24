import * as os from "os";
import * as fs from "fs";
import * as path from "path";

export interface SSHHost {
  name: string;
  hostname?: string;
  user?: string;
}

export interface Config {
  remotes: string[];
}

export function getConfigPath(): string {
  return path.join(os.homedir(), ".config", "clipshot", "config.json");
}

export function loadConfig(): Config | null {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const content = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(content);
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function detectSSHRemotes(): SSHHost[] {
  const home = os.homedir();
  const sshConfigPath = path.join(home, ".ssh", "config");

  if (!fs.existsSync(sshConfigPath)) {
    return [];
  }

  const content = fs.readFileSync(sshConfigPath, "utf-8");
  const lines = content.split("\n");
  const hosts: SSHHost[] = [];
  let currentHost: SSHHost | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith("host ")) {
      if (currentHost) {
        hosts.push(currentHost);
      }
      const hostName = trimmed.slice(5).trim().split(/\s+/)[0];
      // Skip wildcard patterns
      if (!hostName.includes("*")) {
        currentHost = { name: hostName };
      } else {
        currentHost = null;
      }
    } else if (currentHost) {
      if (trimmed.toLowerCase().startsWith("hostname ")) {
        currentHost.hostname = trimmed.slice(9).trim();
      } else if (trimmed.toLowerCase().startsWith("user ")) {
        currentHost.user = trimmed.slice(5).trim();
      }
    }
  }

  if (currentHost) {
    hosts.push(currentHost);
  }

  return hosts;
}

export function detectSSHFromHistory(limit = 5): string[] {
  const home = os.homedir();
  const historyFiles = [
    path.join(home, ".bash_history"),
    path.join(home, ".zsh_history"),
  ];

  // Track remotes in order of most recent appearance
  const remotes: string[] = [];

  for (const histFile of historyFiles) {
    if (!fs.existsSync(histFile)) continue;

    try {
      const content = fs.readFileSync(histFile, "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        // Match ssh commands: ssh [options] user@host or ssh [options] host
        const match = line.match(/\bssh\s+(?:[^@\s]+\s+)*?(\S+@\S+?)(?:\s|$)/);
        if (match) {
          const remote = match[1];
          // Filter out flags and invalid entries
          if (remote.includes("@") && !remote.startsWith("-")) {
            // Clean up any trailing characters
            const clean = remote.replace(/[;|&].*$/, "");
            if (clean.match(/^[\w.-]+@[\w.-]+$/)) {
              // Remove if exists, then add to end (most recent)
              const idx = remotes.indexOf(clean);
              if (idx !== -1) {
                remotes.splice(idx, 1);
              }
              remotes.push(clean);
            }
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Return most recent entries (last N items, reversed so most recent is first)
  return remotes.slice(-limit).reverse();
}
