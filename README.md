# clipshot

Screenshot monitor CLI. Watches clipboard for screenshots and uploads to remote server via SSH, or saves locally.

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
