import path from "node:path";
import { mkdir, rm, symlink } from "node:fs/promises";
import { homedir, userInfo } from "node:os";

import { resolveGlobalBinDir } from "./bootstrap";

const AUTOSTART_ENVIRONMENT_VARIABLE = "HUB_BOOTSTRAPPED";
const MACOS_LABEL = "com.v57.hub";
const MACOS_SYSTEM_LABEL = "com.v57.hub.system";
const LINUX_SERVICE_NAME = "hub.service";
const WINDOWS_STARTUP_SCRIPT_NAME = "hub.cmd";
const WINDOWS_SYSTEM_TASK_NAME = "v57-hub-system";
const WINDOWS_SYSTEM_SCRIPT_NAME = "hub-system.cmd";

type PathLike = Pick<typeof path, "join" | "dirname">;
type SpawnLike = {
  stdout?: ReadableStream<Uint8Array> | number | null;
  exited: Promise<number>;
  pid?: number;
};
type SpawnFunction = (cmd: string[], options?: Record<string, unknown>) => SpawnLike;

function defaultSpawn(cmd: string[], options?: Record<string, unknown>): SpawnLike {
  return Bun.spawn({
    cmd,
    ...options,
  });
}

async function runCommand(cmd: string[], spawn: SpawnFunction, options: Record<string, unknown> = {}): Promise<void> {
  const process = spawn(cmd, options);
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")} (exit code ${exitCode})`);
  }
}

function buildPathEnv(globalBinDir: string, currentPath: string | undefined): string {
  return [globalBinDir, currentPath].filter(Boolean).join(path.delimiter);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdEscape(value: string): string {
  return JSON.stringify(value);
}

function resolveAutostartUsername(username: string | undefined): string {
  return username ?? process.env.SUDO_USER ?? process.env.USER ?? process.env.LOGNAME ?? userInfo().username;
}

function resolveSystemHomeDirectory(platform: NodeJS.Platform, username: string, pathImpl: PathLike = path): string {
  if (platform === "darwin") {
    return pathImpl.join("/Users", username);
  }

  if (platform === "win32") {
    return pathImpl.join("C:\\Users", username);
  }

  return pathImpl.join("/home", username);
}

function resolveLinuxAutostartDirectory(homeDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(homeDirectory, ".config", "systemd", "user");
}

function resolveLinuxAutostartPath(homeDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(resolveLinuxAutostartDirectory(homeDirectory, pathImpl), LINUX_SERVICE_NAME);
}

function resolveLinuxEnabledPath(homeDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(resolveLinuxAutostartDirectory(homeDirectory, pathImpl), "default.target.wants", LINUX_SERVICE_NAME);
}

function resolveMacAutostartDirectory(homeDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(homeDirectory, "Library", "LaunchAgents");
}

function resolveMacAutostartPath(homeDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(resolveMacAutostartDirectory(homeDirectory, pathImpl), MACOS_LABEL + ".plist");
}

function resolveWindowsStartupDirectory(homeDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(homeDirectory, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

function resolveWindowsAutostartPath(homeDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(resolveWindowsStartupDirectory(homeDirectory, pathImpl), WINDOWS_STARTUP_SCRIPT_NAME);
}

function resolveLinuxSystemAutostartDirectory(systemRootDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(systemRootDirectory, "etc", "systemd", "system");
}

function resolveLinuxSystemAutostartPath(systemRootDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(resolveLinuxSystemAutostartDirectory(systemRootDirectory, pathImpl), LINUX_SERVICE_NAME);
}

function resolveLinuxSystemEnabledPath(systemRootDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(resolveLinuxSystemAutostartDirectory(systemRootDirectory, pathImpl), "multi-user.target.wants", LINUX_SERVICE_NAME);
}

function resolveMacSystemAutostartPath(systemRootDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(systemRootDirectory, "Library", "LaunchDaemons", `${MACOS_SYSTEM_LABEL}.plist`);
}

function resolveWindowsSystemAutostartPath(systemRootDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(systemRootDirectory, "Hub", WINDOWS_SYSTEM_SCRIPT_NAME);
}

function renderLinuxService(
  pathEnv: string,
  options?: {
    homeDirectory?: string;
    system?: boolean;
    userName?: string;
  },
): string {
  const lines = [
    "[Unit]",
    "Description=Hub Launcher",
    "",
    "[Service]",
    "Type=oneshot",
    `Environment=${systemdEscape(`${AUTOSTART_ENVIRONMENT_VARIABLE}=1`)}`,
    `Environment=${systemdEscape(`PATH=${pathEnv}`)}`,
    "ExecStart=/bin/sh -lc \"exec hub\"",
    "",
  ];

  if (options?.system) {
    lines.splice(
      6,
      0,
      `User=${options.userName ?? ""}`,
      `Environment=${systemdEscape(`HOME=${options.homeDirectory ?? ""}`)}`,
      `Environment=${systemdEscape(`USER=${options.userName ?? ""}`)}`,
      `Environment=${systemdEscape(`LOGNAME=${options.userName ?? ""}`)}`,
      `WorkingDirectory=${options.homeDirectory ?? ""}`,
    );
  }

  lines.push("[Install]", `WantedBy=${options?.system ? "multi-user.target" : "default.target"}`, "");
  return lines.join("\n");
}

function renderMacPlist(
  pathEnv: string,
  options?: {
    homeDirectory?: string;
    system?: boolean;
    userName?: string;
  },
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(options?.system ? MACOS_SYSTEM_LABEL : MACOS_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>exec hub</string>
  </array>
  ${options?.system ? "<key>RunAtLoad</key>\n  <true/>\n" : ""}
  ${options?.system ? `<key>UserName</key>\n  <string>${xmlEscape(options.userName ?? "")}</string>\n` : ""}
  <key>EnvironmentVariables</key>
  <dict>
    <key>${xmlEscape(AUTOSTART_ENVIRONMENT_VARIABLE)}</key>
    <string>1</string>
    ${options?.system ? `<key>HOME</key>\n    <string>${xmlEscape(options.homeDirectory ?? "")}</string>\n    <key>USER</key>\n    <string>${xmlEscape(options.userName ?? "")}</string>\n    <key>LOGNAME</key>\n    <string>${xmlEscape(options.userName ?? "")}</string>\n` : ""}
    <key>PATH</key>
    <string>${xmlEscape(pathEnv)}</string>
  </dict>
</dict>
</plist>
`;
}

function renderWindowsScript(globalBinDir: string, options?: { homeDirectory?: string; system?: boolean; userName?: string }): string {
  return [
    "@echo off",
    `set "${AUTOSTART_ENVIRONMENT_VARIABLE}=1"`,
    ...(options?.system
      ? [
          `set "HOME=${options.homeDirectory ?? ""}"`,
          `set "USERPROFILE=${options.homeDirectory ?? ""}"`,
          `set "USERNAME=${options.userName ?? ""}"`,
          `set "USER=${options.userName ?? ""}"`,
          `set "LOGNAME=${options.userName ?? ""}"`,
        ]
      : []),
    `set "PATH=${globalBinDir};%PATH%"`,
    'start "" /B hub',
    "",
  ].join("\r\n");
}

async function writeFileEnsuringParent(filePath: string, content: string, pathImpl: PathLike = path): Promise<void> {
  await mkdir(pathImpl.dirname(filePath), { recursive: true });
  await Bun.write(filePath, content);
}

async function enableLinuxService(servicePath: string, enabledPath: string, pathImpl: PathLike = path): Promise<void> {
  await mkdir(pathImpl.dirname(enabledPath), { recursive: true });
  await rm(enabledPath, { force: true });
  await symlink(servicePath, enabledPath);
}

async function disableLinuxService(servicePath: string, enabledPath: string): Promise<void> {
  await rm(enabledPath, { force: true });
  await rm(servicePath, { force: true });
}

async function createWindowsSystemTask(scriptPath: string, spawn: SpawnFunction): Promise<void> {
  await runCommand(
    ["schtasks", "/Create", "/TN", WINDOWS_SYSTEM_TASK_NAME, "/SC", "ONSTART", "/TR", scriptPath, "/RU", "SYSTEM", "/RL", "HIGHEST", "/F"],
    spawn,
  );
}

async function deleteWindowsSystemTask(spawn: SpawnFunction): Promise<void> {
  const taskExists = await windowsSystemTaskExists(spawn);
  if (!taskExists) {
    return;
  }

  await runCommand(["schtasks", "/Delete", "/TN", WINDOWS_SYSTEM_TASK_NAME, "/F"], spawn);
}

async function windowsSystemTaskExists(spawn: SpawnFunction): Promise<boolean> {
  const process = spawn(["schtasks", "/Query", "/TN", WINDOWS_SYSTEM_TASK_NAME], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await process.exited;
  return exitCode === 0;
}

function describeAutostartRegistration(scope: "user" | "system"): string {
  return scope === "system" ? "boot autostart" : "autostart";
}

function resolveAutostartHomeDirectory(
  platform: NodeJS.Platform,
  scope: "user" | "system",
  homeDirectory: string | undefined,
  username: string,
  pathImpl: PathLike,
): string {
  if (homeDirectory) {
    return homeDirectory;
  }

  if (scope === "system" && process.env.SUDO_USER) {
    return resolveSystemHomeDirectory(platform, username, pathImpl);
  }

  return homedir();
}

async function disableAutostartEntry(options: {
  homeDirectory: string;
  pathImpl: PathLike;
  platform: NodeJS.Platform;
  scope: "user" | "system";
  spawn: SpawnFunction;
  systemRootDirectory: string;
}): Promise<string> {
  const { homeDirectory, pathImpl, platform, scope, spawn, systemRootDirectory } = options;

  if (scope === "system") {
    if (platform === "darwin") {
      const autostartPath = resolveMacSystemAutostartPath(systemRootDirectory, pathImpl);
      await rm(autostartPath, { force: true });
      return autostartPath;
    }

    if (platform === "linux") {
      const autostartPath = resolveLinuxSystemAutostartPath(systemRootDirectory, pathImpl);
      await disableLinuxService(autostartPath, resolveLinuxSystemEnabledPath(systemRootDirectory, pathImpl));
      return autostartPath;
    }

    if (platform === "win32") {
      await deleteWindowsSystemTask(spawn);
      const autostartPath = resolveWindowsSystemAutostartPath(systemRootDirectory, pathImpl);
      await rm(autostartPath, { force: true });
      return autostartPath;
    }
  }

  if (platform === "darwin") {
    const autostartPath = resolveMacAutostartPath(homeDirectory, pathImpl);
    await rm(autostartPath, { force: true });
    return autostartPath;
  }

  if (platform === "linux") {
    const autostartPath = resolveLinuxAutostartPath(homeDirectory, pathImpl);
    await disableLinuxService(autostartPath, resolveLinuxEnabledPath(homeDirectory, pathImpl));
    return autostartPath;
  }

  if (platform === "win32") {
    const autostartPath = resolveWindowsAutostartPath(homeDirectory, pathImpl);
    await rm(autostartPath, { force: true });
    return autostartPath;
  }

  throw new Error(`Autostart is not supported on ${platform}`);
}

async function resolveAutostartEntryStatus(options: {
  homeDirectory: string;
  pathImpl: PathLike;
  platform: NodeJS.Platform;
  scope: "user" | "system";
  spawn: SpawnFunction;
  systemRootDirectory: string;
}): Promise<{ enabled: boolean; path: string }> {
  const { homeDirectory, pathImpl, platform, scope, spawn, systemRootDirectory } = options;

  if (scope === "system") {
    if (platform === "darwin") {
      const autostartPath = resolveMacSystemAutostartPath(systemRootDirectory, pathImpl);
      return { enabled: await Bun.file(autostartPath).exists(), path: autostartPath };
    }

    if (platform === "linux") {
      const enabledPath = resolveLinuxSystemEnabledPath(systemRootDirectory, pathImpl);
      if (await Bun.file(enabledPath).exists()) {
        return { enabled: true, path: enabledPath };
      }

      return { enabled: false, path: resolveLinuxSystemAutostartPath(systemRootDirectory, pathImpl) };
    }

    if (platform === "win32") {
      const taskExists = await windowsSystemTaskExists(spawn);
      return { enabled: taskExists, path: resolveWindowsSystemAutostartPath(systemRootDirectory, pathImpl) };
    }
  }

  if (platform === "darwin") {
    const autostartPath = resolveMacAutostartPath(homeDirectory, pathImpl);
    return { enabled: await Bun.file(autostartPath).exists(), path: autostartPath };
  }

  if (platform === "linux") {
    const enabledPath = resolveLinuxEnabledPath(homeDirectory, pathImpl);
    if (await Bun.file(enabledPath).exists()) {
      return { enabled: true, path: enabledPath };
    }

    return { enabled: false, path: resolveLinuxAutostartPath(homeDirectory, pathImpl) };
  }

  if (platform === "win32") {
    const autostartPath = resolveWindowsAutostartPath(homeDirectory, pathImpl);
    return { enabled: await Bun.file(autostartPath).exists(), path: autostartPath };
  }

  throw new Error(`Autostart is not supported on ${platform}`);
}

export async function resolveAutostartMode(options?: {
  homeDirectory?: string;
  pathImpl?: PathLike;
  platform?: NodeJS.Platform;
  spawn?: SpawnFunction;
  systemRootDirectory?: string;
}): Promise<"disabled" | "login" | "boot"> {
  try {
    const platform = options?.platform ?? process.platform;
    const pathImpl = options?.pathImpl ?? path;
    const spawn = options?.spawn ?? defaultSpawn;
    const homeDirectory = options?.homeDirectory ?? homedir();
    const systemRootDirectory =
      options?.systemRootDirectory ?? (platform === "win32" ? process.env.ProgramData ?? "C:\\ProgramData" : "/");

    const systemStatus = await resolveAutostartEntryStatus({
      homeDirectory,
      pathImpl,
      platform,
      scope: "system",
      spawn,
      systemRootDirectory,
    });
    if (systemStatus.enabled) {
      return "boot";
    }

    const userStatus = await resolveAutostartEntryStatus({
      homeDirectory,
      pathImpl,
      platform,
      scope: "user",
      spawn,
      systemRootDirectory,
    });
    if (userStatus.enabled) {
      return "login";
    }
  } catch {
    return "disabled";
  }

  return "disabled";
}

export async function handleAutostartCommand(options?: {
  currentPath?: string;
  globalBinDir?: string;
  homeDirectory?: string;
  logger?: Pick<Console, "error" | "log">;
  mode?: "enable" | "disable" | "status";
  scope?: "user" | "system";
  platform?: NodeJS.Platform;
  pathImpl?: PathLike;
  spawn?: SpawnFunction;
  systemRootDirectory?: string;
  userName?: string;
}): Promise<void> {
  const logger = options?.logger ?? console;

  try {
    const platform = options?.platform ?? process.platform;
    const pathImpl = options?.pathImpl ?? path;
    const scope = options?.scope ?? "user";
    const mode = options?.mode ?? "enable";
    const spawn = options?.spawn ?? defaultSpawn;
    const userName = resolveAutostartUsername(options?.userName);
    const homeDirectory = resolveAutostartHomeDirectory(platform, scope, options?.homeDirectory, userName, pathImpl);
    const systemRootDirectory =
      options?.systemRootDirectory ?? (platform === "win32" ? process.env.ProgramData ?? "C:\\ProgramData" : "/");

    if (mode === "disable") {
      const autostartPath = await disableAutostartEntry({
        homeDirectory,
        pathImpl,
        platform,
        scope,
        spawn,
        systemRootDirectory,
      });
      logger.log(`Hub Launcher ${describeAutostartRegistration(scope)} disabled at ${autostartPath}`);
      return;
    }

    if (mode === "status") {
      const status = await resolveAutostartEntryStatus({
        homeDirectory,
        pathImpl,
        platform,
        scope,
        spawn,
        systemRootDirectory,
      });
      logger.log(
        status.enabled
          ? `Hub Launcher ${describeAutostartRegistration(scope)} is enabled at ${status.path}`
          : `Hub Launcher ${describeAutostartRegistration(scope)} is disabled at ${status.path}`,
      );
      return;
    }

    const currentPath = options?.currentPath ?? process.env.PATH;
    const globalBinDir =
      options?.globalBinDir ?? (await resolveGlobalBinDir((cmd, spawnOptions) => spawn(cmd, spawnOptions)));
    const pathEnv = buildPathEnv(globalBinDir, currentPath);

    if (scope === "system") {
      if (platform === "darwin") {
        const autostartPath = resolveMacSystemAutostartPath(systemRootDirectory, pathImpl);
        await writeFileEnsuringParent(
          autostartPath,
          renderMacPlist(pathEnv, { homeDirectory, system: true, userName }),
          pathImpl,
        );
        logger.log(`Hub Launcher will start on boot via ${autostartPath}`);
        return;
      }

      if (platform === "linux") {
        const autostartPath = resolveLinuxSystemAutostartPath(systemRootDirectory, pathImpl);
        await writeFileEnsuringParent(
          autostartPath,
          renderLinuxService(pathEnv, { homeDirectory, system: true, userName }),
          pathImpl,
        );
        await enableLinuxService(autostartPath, resolveLinuxSystemEnabledPath(systemRootDirectory, pathImpl), pathImpl);
        logger.log(`Hub Launcher will start on boot via ${autostartPath}`);
        return;
      }

      if (platform === "win32") {
        const autostartPath = resolveWindowsSystemAutostartPath(systemRootDirectory, pathImpl);
        await writeFileEnsuringParent(
          autostartPath,
          renderWindowsScript(globalBinDir, { homeDirectory, system: true, userName }),
          pathImpl,
        );
        await createWindowsSystemTask(autostartPath, spawn);
        logger.log(`Hub Launcher will start on boot via ${autostartPath}`);
        return;
      }
    } else {
      if (platform === "darwin") {
        const autostartPath = resolveMacAutostartPath(homeDirectory, pathImpl);
        await writeFileEnsuringParent(autostartPath, renderMacPlist(pathEnv), pathImpl);
        logger.log(`Hub Launcher will start on login via ${autostartPath}`);
        return;
      }

      if (platform === "linux") {
        const autostartPath = resolveLinuxAutostartPath(homeDirectory, pathImpl);
        await writeFileEnsuringParent(autostartPath, renderLinuxService(pathEnv), pathImpl);
        await enableLinuxService(autostartPath, resolveLinuxEnabledPath(homeDirectory, pathImpl), pathImpl);
        logger.log(`Hub Launcher will start on login via ${autostartPath}`);
        return;
      }

      if (platform === "win32") {
        const autostartPath = resolveWindowsAutostartPath(homeDirectory, pathImpl);
        await writeFileEnsuringParent(autostartPath, renderWindowsScript(globalBinDir), pathImpl);
        logger.log(`Hub Launcher will start on login via ${autostartPath}`);
        return;
      }
    }

    logger.error(`Autostart is not supported on ${platform}`);
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const action = options?.mode === "disable" ? "disable" : options?.mode === "status" ? "inspect" : "register";
    logger.error(
      `Failed to ${action} ${options?.scope === "system" ? "system " : ""}autostart: ${message}. If this location requires administrator privileges, rerun with sudo.`,
    );
    process.exitCode = 1;
  }
}

export {
  buildPathEnv,
  renderLinuxService,
  renderMacPlist,
  renderWindowsScript,
  resolveLinuxSystemAutostartPath,
  resolveLinuxSystemEnabledPath,
  resolveMacSystemAutostartPath,
  resolveLinuxEnabledPath,
  resolveLinuxAutostartPath,
  resolveMacAutostartPath,
  resolveWindowsSystemAutostartPath,
  resolveWindowsAutostartPath,
};
