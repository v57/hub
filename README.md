# hub

`hub` bootstraps, updates, and controls `hub-launcher`. Run it with `bunx v57/hub` and it will hand off to `hub` after making sure the global package is current.

## Quick Start

```bash
bun install
bunx v57/hub
```

Common first commands:

```bash
bunx v57/hub status
bunx v57/hub restart
bunx v57/hub backup
```

To update both `hub` and `hub-launcher`:

```bash
bunx v57/hub update
```

## Command Guide

### Launcher Lifecycle

- `bunx v57/hub` - bootstrap `hub` and launch `hub-launcher`
- `bunx v57/hub stop` - stop running launcher
- `bunx v57/hub restart` - start launcher, or restart it if already running
- `bunx v57/hub update` - refresh `hub` and `hub-launcher`, then relaunch
- `bunx v57/hub uninstall` - remove launcher when it is not running

### Backups

- `bunx v57/hub backup` - create backup of `~/Hub/Launcher`
- `bunx v57/hub backup list` - list backups
- `bunx v57/hub backup restore` - restore latest backup
- `bunx v57/hub backup restore <id>` - restore selected backup
- `bunx v57/hub backup remove <id>` - remove one backup
- `bunx v57/hub backup remove all` - remove all backups

### Launcher Config

- `bunx v57/hub launcher export` - print `launch.json` as base64, using gzip when smaller
- `bunx v57/hub launcher import <text>` - import base64 config
- `bunx v57/hub launcher import <url>` - fetch JSON config from URL and import it
- `bunx v57/hub launcher import --preview <text or url>` - print pretty JSON without changing files

### Autostart

- `bunx v57/hub autostart` - enable login/startup launch on your OS
- `bunx v57/hub autostart disable` - remove login/startup launch
- `bunx v57/hub autostart status` - show login/startup autostart state
- `bunx v57/hub autostart system` - enable boot-time launch
- `bunx v57/hub autostart system disable` - remove boot-time launch
- `bunx v57/hub autostart system status` - show boot-time autostart state

Use `sudo` if your OS needs admin rights for the system-level startup location.

### Status and Diagnostics

- `bunx v57/hub status` - show whether launcher is running, how autolaunch is set, and whether updates are available

## Command Cheatsheet

| Command | What it does |
| --- | --- |
| `bunx v57/hub` | Bootstrap `hub` and launch `hub-launcher` |
| `bunx v57/hub update` | Update `hub` and `hub-launcher` |
| `bunx v57/hub restart` | Restart launcher or start it if stopped |
| `bunx v57/hub stop` | Stop running launcher |
| `bunx v57/hub uninstall` | Remove launcher when stopped |
| `bunx v57/hub status` | Show running, autolaunch, and update status |
| `bunx v57/hub backup` | Create launcher backup |
| `bunx v57/hub backup restore [id]` | Restore latest or selected backup |
| `bunx v57/hub launcher export` | Export `launch.json` as base64 |
| `bunx v57/hub launcher import [text|url]` | Import launcher config |
| `bunx v57/hub autostart` | Enable login/startup autostart |
| `bunx v57/hub autostart system` | Enable boot autostart |

