# clipshot

Screenshot monitor CLI. Watches clipboard for screenshots and uploads to remote server via SSH, or saves locally.

![Demo](demo.gif)

## Why?

When using AI CLI tools like Claude Code, Codex, or others, you often need to share screenshots with them. But when you SSH into a remote server to use these tools, you can't paste images at all.

clipshot solves this - take a screenshot locally, and it automatically uploads to your remote server and copies the path to your clipboard. So you just take screenshot like usual and then paste the path and the AI can read the image.

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
- **macOS support**: Clipboard detection via `pngpaste` + file watcher for Cmd+Shift screenshots

## macOS Setup

clipshot supports two screenshot detection methods on macOS:

1. **File watcher** (works out of the box): Detects screenshots saved to disk via Cmd+Shift+3/4/5. Monitors your screenshot directory (defaults to `~/Desktop`, respects custom locations set in System Settings).

2. **Clipboard detection** (requires `pngpaste`): Detects screenshots copied to clipboard via Cmd+Ctrl+Shift+3/4. Install with:
   ```bash
   brew install pngpaste
   ```

Both methods work simultaneously — you can use either screenshot workflow and clipshot will detect it.

## How it works

1. Polls clipboard for new images (200ms interval)
2. On macOS, also watches the screenshot directory for new files
3. Detects changes via MD5 hash comparison
4. Uploads via SSH or saves locally
5. Copies absolute path to clipboard for easy pasting
