import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";

import {
  handleAutostartCommand,
  resolveLinuxAutostartPath,
  resolveLinuxEnabledPath,
  resolveLinuxSystemAutostartPath,
  resolveLinuxSystemEnabledPath,
  resolveMacAutostartPath,
  resolveMacSystemAutostartPath,
  resolveWindowsAutostartPath,
  resolveWindowsSystemAutostartPath,
} from "./autostart";

function createLogger(messages: string[]): Pick<Console, "log" | "error"> {
  return {
    error: (message: string) => messages.push(message),
    log: (message: string) => messages.push(message),
  };
}

function createWindowsTaskScheduler() {
  let taskExists = false;
  const commands: string[][] = [];

  const spawn = (cmd: string[]): { exited: Promise<number> } => {
    commands.push(cmd);

    if (cmd[0] === "schtasks" && cmd[1] === "/Query") {
      return { exited: Promise.resolve(taskExists ? 0 : 1) };
    }

    if (cmd[0] === "schtasks" && cmd[1] === "/Create") {
      taskExists = true;
      return { exited: Promise.resolve(0) };
    }

    if (cmd[0] === "schtasks" && cmd[1] === "/Delete") {
      taskExists = false;
      return { exited: Promise.resolve(0) };
    }

    return { exited: Promise.resolve(0) };
  };

  return {
    commands,
    get taskExists() {
      return taskExists;
    },
    spawn,
  };
}

test("writes a Linux systemd user service and enables it", async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "hub-home-"));
  const messages: string[] = [];

  try {
    await handleAutostartCommand({
      currentPath: "/usr/bin:/bin",
      globalBinDir: "/Users/dimas/.bun/bin",
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "linux",
    });

    const servicePath = resolveLinuxAutostartPath(homeDirectory, path.posix);
    const enabledPath = resolveLinuxEnabledPath(homeDirectory, path.posix);

    expect(await Bun.file(servicePath).text()).toContain("Type=oneshot");
    expect(await Bun.file(servicePath).text()).toContain("exec hub");
    expect(await Bun.file(servicePath).text()).toContain("PATH=/Users/dimas/.bun/bin:/usr/bin:/bin");
    expect(await Bun.file(enabledPath).exists()).toBe(true);
    expect(messages.at(-1)).toBe(`Hub Launcher will start on login via ${servicePath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "linux",
    });

    expect(messages).toContain(`Hub Launcher autostart is enabled at ${enabledPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "linux",
      mode: "disable",
    });

    expect(await Bun.file(servicePath).exists()).toBe(false);
    expect(await Bun.file(enabledPath).exists()).toBe(false);
    expect(messages.at(-1)).toBe(`Hub Launcher autostart disabled at ${servicePath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "linux",
    });

    expect(messages).toContain(`Hub Launcher autostart is disabled at ${servicePath}`);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("writes a Linux system service for boot autostart", async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "hub-home-"));
  const systemRootDirectory = await mkdtemp(path.join(tmpdir(), "hub-system-"));
  const messages: string[] = [];

  try {
    await handleAutostartCommand({
      currentPath: "/usr/bin:/bin",
      globalBinDir: "/Users/dimas/.bun/bin",
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "linux",
      scope: "system",
      systemRootDirectory,
      userName: "dimas",
    });

    const servicePath = resolveLinuxSystemAutostartPath(systemRootDirectory, path.posix);
    const enabledPath = resolveLinuxSystemEnabledPath(systemRootDirectory, path.posix);

    expect(await Bun.file(servicePath).text()).toContain("WantedBy=multi-user.target");
    expect(await Bun.file(servicePath).text()).toContain("User=dimas");
    expect(await Bun.file(servicePath).text()).toContain(`HOME=${homeDirectory}`);
    expect(await Bun.file(enabledPath).exists()).toBe(true);
    expect(messages.at(-1)).toBe(`Hub Launcher will start on boot via ${servicePath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "linux",
      scope: "system",
      systemRootDirectory,
      userName: "dimas",
    });

    expect(messages).toContain(`Hub Launcher boot autostart is enabled at ${enabledPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "disable",
      pathImpl: path.posix,
      platform: "linux",
      scope: "system",
      systemRootDirectory,
      userName: "dimas",
    });

    expect(await Bun.file(servicePath).exists()).toBe(false);
    expect(await Bun.file(enabledPath).exists()).toBe(false);
    expect(messages.at(-1)).toBe(`Hub Launcher boot autostart disabled at ${servicePath}`);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
    await rm(systemRootDirectory, { recursive: true, force: true });
  }
});

test("writes a macOS LaunchAgent plist", async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "hub-home-"));
  const messages: string[] = [];

  try {
    await handleAutostartCommand({
      currentPath: "/usr/bin:/bin",
      globalBinDir: "/Users/dimas/.bun/bin",
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "darwin",
    });

    const plistPath = resolveMacAutostartPath(homeDirectory, path.posix);
    const plist = await Bun.file(plistPath).text();

    expect(plist).toContain("<string>exec hub</string>");
    expect(plist).toContain("<key>HUB_BOOTSTRAPPED</key>");
    expect(plist).toContain("<string>/Users/dimas/.bun/bin:/usr/bin:/bin</string>");
    expect(messages.at(-1)).toBe(`Hub Launcher will start on login via ${plistPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "darwin",
    });

    expect(messages).toContain(`Hub Launcher autostart is enabled at ${plistPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "darwin",
      mode: "disable",
    });

    expect(await Bun.file(plistPath).exists()).toBe(false);
    expect(messages.at(-1)).toBe(`Hub Launcher autostart disabled at ${plistPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "darwin",
    });

    expect(messages).toContain(`Hub Launcher autostart is disabled at ${plistPath}`);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("writes a macOS LaunchDaemon plist for boot autostart", async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "hub-home-"));
  const systemRootDirectory = await mkdtemp(path.join(tmpdir(), "hub-system-"));
  const messages: string[] = [];

  try {
    await handleAutostartCommand({
      currentPath: "/usr/bin:/bin",
      globalBinDir: "/Users/dimas/.bun/bin",
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "darwin",
      scope: "system",
      systemRootDirectory,
      userName: "dimas",
    });

    const plistPath = resolveMacSystemAutostartPath(systemRootDirectory, path.posix);
    const plist = await Bun.file(plistPath).text();

    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>UserName</key>");
    expect(plist).toContain("<string>dimas</string>");
    expect(messages.at(-1)).toBe(`Hub Launcher will start on boot via ${plistPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "darwin",
      scope: "system",
      systemRootDirectory,
      userName: "dimas",
    });

    expect(messages).toContain(`Hub Launcher boot autostart is enabled at ${plistPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "disable",
      pathImpl: path.posix,
      platform: "darwin",
      scope: "system",
      systemRootDirectory,
      userName: "dimas",
    });

    expect(await Bun.file(plistPath).exists()).toBe(false);
    expect(messages.at(-1)).toBe(`Hub Launcher boot autostart disabled at ${plistPath}`);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
    await rm(systemRootDirectory, { recursive: true, force: true });
  }
});

test("writes a Windows startup script", async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "hub-home-"));
  const messages: string[] = [];

  try {
    await handleAutostartCommand({
      currentPath: "C:\\Windows\\System32",
      globalBinDir: "C:\\Users\\dimas\\.bun\\bin",
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "win32",
    });

    const scriptPath = resolveWindowsAutostartPath(homeDirectory, path.posix);
    const script = await Bun.file(scriptPath).text();

    expect(script).toContain('set "HUB_BOOTSTRAPPED=1"');
    expect(script).toContain('set "PATH=C:\\Users\\dimas\\.bun\\bin;%PATH%"');
    expect(script).toContain('start "" /B hub');
    expect(messages.at(-1)).toBe(`Hub Launcher will start on login via ${scriptPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "win32",
    });

    expect(messages).toContain(`Hub Launcher autostart is enabled at ${scriptPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "win32",
      mode: "disable",
    });

    expect(await Bun.file(scriptPath).exists()).toBe(false);
    expect(messages.at(-1)).toBe(`Hub Launcher autostart disabled at ${scriptPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "win32",
    });

    expect(messages).toContain(`Hub Launcher autostart is disabled at ${scriptPath}`);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("writes a Windows scheduled task for boot autostart", async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "hub-home-"));
  const systemRootDirectory = await mkdtemp(path.join(tmpdir(), "hub-system-"));
  const messages: string[] = [];
  const taskScheduler = createWindowsTaskScheduler();

  try {
    await handleAutostartCommand({
      currentPath: "C:\\Windows\\System32",
      globalBinDir: "C:\\Users\\dimas\\.bun\\bin",
      homeDirectory,
      logger: createLogger(messages),
      pathImpl: path.posix,
      platform: "win32",
      scope: "system",
      spawn: taskScheduler.spawn,
      systemRootDirectory,
      userName: "dimas",
    });

    const scriptPath = resolveWindowsSystemAutostartPath(systemRootDirectory, path.posix);
    const script = await Bun.file(scriptPath).text();

    expect(script).toContain(`set "HOME=${homeDirectory}"`);
    expect(script).toContain(`set "USERPROFILE=${homeDirectory}"`);
    expect(script).toContain('set "USERNAME=dimas"');
    expect(taskScheduler.taskExists).toBe(true);
    expect(taskScheduler.commands.some((command) => command[1] === "/Create")).toBe(true);
    expect(messages.at(-1)).toBe(`Hub Launcher will start on boot via ${scriptPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "status",
      pathImpl: path.posix,
      platform: "win32",
      scope: "system",
      spawn: taskScheduler.spawn,
      systemRootDirectory,
      userName: "dimas",
    });

    expect(messages).toContain(`Hub Launcher boot autostart is enabled at ${scriptPath}`);

    messages.length = 0;
    await handleAutostartCommand({
      homeDirectory,
      logger: createLogger(messages),
      mode: "disable",
      pathImpl: path.posix,
      platform: "win32",
      scope: "system",
      spawn: taskScheduler.spawn,
      systemRootDirectory,
      userName: "dimas",
    });

    expect(taskScheduler.taskExists).toBe(false);
    expect(await Bun.file(scriptPath).exists()).toBe(false);
    expect(taskScheduler.commands.some((command) => command[1] === "/Delete")).toBe(true);
    expect(messages.at(-1)).toBe(`Hub Launcher boot autostart disabled at ${scriptPath}`);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
    await rm(systemRootDirectory, { recursive: true, force: true });
  }
});
