# hub

`hub` controls `hub-launcher`. Run it with `hub` to use the already installed copy, or `hub` to bootstrap and update the global package before handing off to `hub`.

## Quick Start

Running it from `bunx` will automatically install `hub` command for simple future use
```bash
bunx v57/hub
```

Common first commands:

```bash
hub status
hub restart
hub backup
```

To update both `hub` and `hub-launcher`:

```bash
hub update
```

## Command Guide

### Launcher Lifecycle

- `hub` - control `hub-launcher` without updating the package
- `hub --help` - show the top-level command list and flag usage
- `hub` - bootstrap `hub`, update the package, and launch `hub-launcher`
- `hub stop` - stop running launcher
- `hub restart` - start launcher, or restart it if already running
- `hub update` - refresh `hub` and `hub-launcher`, then relaunch
- `hub uninstall` - remove launcher when it is not running

### Backups

- `hub backup` - create backup of `~/Hub/Launcher`
- `hub backup list` - list backups
- `hub backup restore` - restore latest backup
- `hub backup restore <id>` - restore selected backup
- `hub backup remove <id>` - remove one backup
- `hub backup remove all` - remove all backups

### Launcher Config

- `hub launcher export` - print `launch.json` as base64, using gzip when smaller
- `hub launcher import <text>` - import base64 config
- `hub launcher import <url>` - fetch JSON config from URL and import it
- `hub launcher import --preview <text or url>` - print pretty JSON without changing files

### Autostart

- `hub autostart` - enable login/startup launch on your OS
- `hub autostart disable` - remove login/startup launch
- `hub autostart status` - show login/startup autostart state
- `hub autostart system` - enable boot-time launch
- `hub autostart system disable` - remove boot-time launch
- `hub autostart system status` - show boot-time autostart state

Use `sudo` if your OS needs admin rights for the system-level startup location.

### Status and Diagnostics

- `hub status` - show whether launcher is running, how autolaunch is set, and whether updates are available

## Command Cheatsheet

| Command | What it does |
| --- | --- |
| `hub` | Launch `hub-launcher` without bootstrapping |
| `hub` | Bootstrap and update `hub`, then launch `hub-launcher` |
| `hub update` | Update `hub` and `hub-launcher` |
| `hub restart` | Restart launcher or start it if stopped |
| `hub stop` | Stop running launcher |
| `hub uninstall` | Remove launcher when stopped |
| `hub status` | Show running, autolaunch, and update status |
| `hub backup` | Create launcher backup |
| `hub backup restore [id]` | Restore latest or selected backup |
| `hub launcher export` | Export `launch.json` as base64 |
| `hub launcher import [text|url]` | Import launcher config |
| `hub autostart` | Enable login/startup autostart |
| `hub autostart system` | Enable boot autostart |
