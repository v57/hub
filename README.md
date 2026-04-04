# hub

Run this command with `bunx v57/hub` to update the global `v57/hub` install and then hand off to `hub`.

Any extra args after `bunx v57/hub` are forwarded to `hub`.

Use `bunx v57/hub stop` to stop the running `hub-launcher` process.

Use `bunx v57/hub update` to refresh `hub` and `hub-launcher`, then restart the launcher.

Use `bunx v57/hub restart` to restart the launcher, or start it if it is not already running.

Use `bunx v57/hub uninstall` to remove the launcher when it is not running.

Use `bunx v57/hub backup` to create a backup of `~/Hub/Launcher`.

Use `bunx v57/hub backup list` to list backups.

Use `bunx v57/hub backup restore` or `bunx v57/hub backup restore <id>` to restore the latest or a selected backup.

Use `bunx v57/hub backup remove <id>` or `bunx v57/hub backup remove all` to delete backups.

Use `bunx v57/hub launcher export` to print the current `launch.json` as base64, using gzip when it is much smaller.

Use `bunx v57/hub launcher import <text>` to back up the current launcher and replace `launch.json`, or pass a URL to fetch the JSON config first.

Use `bunx v57/hub launcher import --preview <text>` to print the imported config with 2-space indentation without replacing anything.

Use `bunx v57/hub status` to check whether the launcher is running, how it autolaunches, and whether updates are available.

Use `bunx v57/hub autostart` to register hub-launcher to run on login/startup for your OS.

Use `bunx v57/hub autostart system` to register hub-launcher to run on boot.

Use `bunx v57/hub autostart system disable` or `bunx v57/hub autostart system status` to manage the boot-time registration.

Use `bunx v57/hub autostart disable` to remove the login/startup registration.

Use `bunx v57/hub autostart status` to check whether login/startup registration is enabled.

If your environment requires a system-level startup location, rerun with `sudo`.

To install dependencies:

```bash
bun install
```

To run:

```bash
bunx v57/hub
```

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
