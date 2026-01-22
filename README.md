# clipshot

Screenshot monitor CLI. Watches clipboard for screenshots and uploads to remote server via SSH, or saves locally.

## Why?

When using AI CLI tools like Claude Code, Codex, or others, you often need to share screenshots with them. But this doesn't work great on Windows, and when you SSH into a remote server to use these tools, you can't paste images at all.

clipshot solves this - take a screenshot locally, and it automatically uploads to your remote server and copies the path to your clipboard. Just paste the path and the AI can read the image.

## Install

```bash
npm install -g clipshot
```

## Commands

```
clipshot              Setup config and start monitoring
clipshot start        Start monitoring (select target)
clipshot stop         Stop monitoring
clipshot status       Show running status and target
clipshot config       Modify remotes configuration
clipshot uninstall    Remove config files
```

## Features

- Auto-detects SSH remotes from `~/.ssh/config` and shell history
- **Local mode**: Saves to `~/clipshot-screenshots/`, copies path to clipboard
- **Remote mode**: Uploads via SSH, copies remote path to clipboard
- Fast SSH with ControlMaster connection reuse
- WSL support (reads Windows clipboard)

## How it works

1. Polls clipboard for new images (200ms interval)
2. Detects changes via MD5 hash comparison
3. Uploads via SSH or saves locally
4. Copies absolute path to clipboard for easy pasting
