import { homedir } from "node:os";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

import { handleAutostartCommand, resolveAutostartMode } from "./autostart";
import { backupLauncher, handleBackupCommand, resolveBackupDirectory } from "./backup";

const LAUNCHER_REPO = "https://github.com/v57/hub-launcher.git";
const LAUNCHER_ENTRYPOINT = "index.ts";
const LAUNCH_JSON_FILE_NAME = "launch.json";
export const LAUNCHER_PID_FILE_NAME = ".hub-launcher.pid";

type PathLike = Pick<typeof path, "join">;

type SpawnLike = {
  pid?: number;
  exited: Promise<number>;
  stdout?: ReadableStream<Uint8Array> | number | null;
};

type SpawnFunction = (cmd: string[], options?: Record<string, unknown>) => SpawnLike;
type LoggerLike = Pick<Console, "error" | "log">;
type FetchInput = string | URL | Request;
type FetchFunction = (input: FetchInput, init?: RequestInit) => Promise<Response>;

function defaultSpawn(cmd: string[], options?: Record<string, unknown>): SpawnLike {
  return Bun.spawn({
    cmd,
    ...options,
  });
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = String((error as { code?: string }).code);
      return code === "EPERM";
    }

    return false;
  }
}

function defaultKillProcess(pid: number): void {
  process.kill(pid);
}

export function resolveLauncherDirectory(homeDirectory = homedir(), pathImpl: PathLike = path): string {
  return pathImpl.join(homeDirectory, "Hub", "Launcher");
}

export function resolvePidFilePath(launcherDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(launcherDirectory, LAUNCHER_PID_FILE_NAME);
}

export function resolveLaunchJsonPath(launcherDirectory: string, pathImpl: PathLike = path): string {
  return pathImpl.join(launcherDirectory, LAUNCH_JSON_FILE_NAME);
}

export function parsePidFile(text: string): number | null {
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function isLauncherAlreadyRunning(pidText: string | null | undefined, isProcessAlive: (pid: number) => boolean = defaultIsProcessAlive): boolean {
  const pid = pidText ? parsePidFile(pidText) : null;
  return pid !== null && isProcessAlive(pid);
}

async function launcherExists(launcherDirectory: string): Promise<boolean> {
  return Bun.file(path.join(launcherDirectory, "package.json")).exists();
}

async function launchJsonExists(launcherDirectory: string): Promise<boolean> {
  return Bun.file(resolveLaunchJsonPath(launcherDirectory)).exists();
}

async function ensureLauncherCloned(launcherDirectory: string, spawn: SpawnFunction = defaultSpawn): Promise<void> {
  if (await launcherExists(launcherDirectory)) {
    return;
  }

  await mkdir(path.dirname(launcherDirectory), { recursive: true });

  const clone = spawn(["git", "clone", LAUNCHER_REPO, launcherDirectory], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await clone.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to clone ${LAUNCHER_REPO} (exit code ${exitCode})`);
  }
}

async function installLauncherDependencies(launcherDirectory: string, spawn: SpawnFunction = defaultSpawn): Promise<void> {
  const install = spawn([process.execPath, "install"], {
    cwd: launcherDirectory,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await install.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to install dependencies in ${launcherDirectory} (exit code ${exitCode})`);
  }
}

async function updateLauncherRepository(launcherDirectory: string, spawn: SpawnFunction = defaultSpawn): Promise<void> {
  const update = spawn(["git", "pull"], {
    cwd: launcherDirectory,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await update.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to update repository in ${launcherDirectory} (exit code ${exitCode})`);
  }
}

async function readPidFile(pidFilePath: string): Promise<string | null> {
  if (!(await Bun.file(pidFilePath).exists())) {
    return null;
  }

  return Bun.file(pidFilePath).text();
}

async function readLaunchJsonText(launchJsonPath: string): Promise<string> {
  if (!(await Bun.file(launchJsonPath).exists())) {
    throw new Error(`Launch configuration not found at ${launchJsonPath}`);
  }

  return Bun.file(launchJsonPath).text();
}

async function readSpawnText(process: SpawnLike): Promise<string> {
  if (!process.stdout || typeof process.stdout === "number") {
    throw new Error("Failed to read command output");
  }

  return process.stdout.text();
}

function minifyJson(text: string): string {
  return JSON.stringify(JSON.parse(text));
}

function isGzipData(data: Uint8Array): boolean {
  return data.byteLength >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

function encodeLaunchJson(text: string): string {
  const minified = minifyJson(text);
  const rawBytes = new TextEncoder().encode(minified);
  const gzipBytes = Bun.gzipSync(rawBytes);
  const chosenBytes = gzipBytes.byteLength < rawBytes.byteLength * 0.8 ? gzipBytes : rawBytes;
  return chosenBytes.toBase64();
}

function decodeLaunchJsonPayload(text: string): string {
  const payload = Uint8Array.fromBase64(text.trim());
  const bytes = isGzipData(payload) ? Bun.gunzipSync(payload) : payload;
  return new TextDecoder().decode(bytes);
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function readImportedLaunchJsonText(source: string, fetchImpl: FetchFunction = fetch): Promise<string> {
  if (isHttpUrl(source)) {
    const response = await fetchImpl(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch launch configuration from ${source} (status ${response.status})`);
    }

    return response.text();
  }

  return decodeLaunchJsonPayload(source);
}

async function exportLaunchConfiguration(launchJsonPath: string): Promise<string> {
  const launchJson = await readLaunchJsonText(launchJsonPath);
  return encodeLaunchJson(launchJson);
}

async function launcherHasUpdates(launcherDirectory: string, spawn: SpawnFunction = defaultSpawn): Promise<boolean> {
  if (!(await launcherExists(launcherDirectory))) {
    return false;
  }

  const fetchProcess = spawn(["git", "fetch", "--quiet"], {
    cwd: launcherDirectory,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await fetchProcess.exited) !== 0) {
    return false;
  }

  const revListProcess = spawn(["git", "rev-list", "--count", "HEAD..@{u}"], {
    cwd: launcherDirectory,
    stdout: "pipe",
    stderr: "inherit",
  });
  if ((await revListProcess.exited) !== 0) {
    return false;
  }

  const count = Number.parseInt((await readSpawnText(revListProcess)).trim(), 10);
  return Number.isFinite(count) && count > 0;
}

async function importLaunchConfiguration(
  options: {
    args: string[];
    homeDirectory: string;
    isProcessAlive: (pid: number) => boolean;
    logger: LoggerLike;
    now?: () => Date;
    fetch?: FetchFunction;
  },
  launcherDirectory: string,
  pidFilePath: string,
): Promise<void> {
  const preview = options.args.includes("--preview");
  const text = options.args.find(arg => arg !== "--preview");
  if (!text) {
    options.logger.error("Please provide an imported launch configuration");
    process.exitCode = 1;
    return;
  }

  const launchJsonText = await readImportedLaunchJsonText(text, options.fetch);
  const minifiedLaunchJson = minifyJson(launchJsonText);

  if (preview) {
    options.logger.log(JSON.stringify(JSON.parse(minifiedLaunchJson), null, 2));
    return;
  }

  const pidText = await readPidFile(pidFilePath);
  if (isLauncherAlreadyRunning(pidText, options.isProcessAlive)) {
    options.logger.error(`Hub Launcher is running at ${launcherDirectory}. Stop it first before importing.`);
    process.exitCode = 1;
    return;
  }

  const launchJsonPath = resolveLaunchJsonPath(launcherDirectory);
  if (await launchJsonExists(launcherDirectory)) {
    const backupId = await backupLauncher(options.homeDirectory, options.now);
    options.logger.log(`Hub Launcher backed up to ${resolveBackupDirectory(options.homeDirectory, backupId)}`);
  } else {
    await mkdir(launcherDirectory, { recursive: true });
  }

  await Bun.write(launchJsonPath, `${minifiedLaunchJson}\n`);
  options.logger.log(`Hub Launcher launch configuration imported to ${launchJsonPath}`);
}

async function writePidFile(pidFilePath: string, pid: number): Promise<void> {
  await Bun.write(pidFilePath, `${pid}\n`);
}

async function removePidFile(pidFilePath: string): Promise<void> {
  await rm(pidFilePath, { force: true });
}

async function uninstallLauncher(
  launcherDirectory: string,
  pidFilePath: string,
  isProcessAlive: (pid: number) => boolean = defaultIsProcessAlive,
): Promise<boolean> {
  const pidText = await readPidFile(pidFilePath);
  if (isLauncherAlreadyRunning(pidText, isProcessAlive)) {
    return false;
  }

  await rm(launcherDirectory, { recursive: true, force: true });
  return true;
}

async function stopLauncher(
  pidFilePath: string,
  isProcessAlive: (pid: number) => boolean = defaultIsProcessAlive,
  killProcess: (pid: number) => void = defaultKillProcess,
): Promise<boolean> {
  const pidText = await readPidFile(pidFilePath);
  const pid = pidText ? parsePidFile(pidText) : null;

  if (pid === null) {
    return false;
  }

  if (!isProcessAlive(pid)) {
    await removePidFile(pidFilePath);
    return false;
  }

  killProcess(pid);
  await removePidFile(pidFilePath);
  return true;
}

async function launchLauncher(launcherDirectory: string, pidFilePath: string, spawn: SpawnFunction = defaultSpawn): Promise<number> {
  const subprocess = spawn([process.execPath, LAUNCHER_ENTRYPOINT], {
    cwd: launcherDirectory,
    detached: true,
    windowsHide: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  if (!subprocess.pid) {
    throw new Error("Failed to launch hub-launcher in the background");
  }

  await writePidFile(pidFilePath, subprocess.pid);
  return subprocess.pid;
}

export async function main(options?: {
  homeDirectory?: string;
  args?: string[];
  isProcessAlive?: (pid: number) => boolean;
  killProcess?: (pid: number) => void;
  fetch?: FetchFunction;
  now?: () => Date;
  logger?: LoggerLike;
  platform?: NodeJS.Platform;
  systemRootDirectory?: string;
  spawn?: SpawnFunction;
}): Promise<void> {
  const homeDirectory = options?.homeDirectory ?? homedir();
  const args = options?.args ?? process.argv.slice(2);
  const isProcessAlive = options?.isProcessAlive ?? defaultIsProcessAlive;
  const killProcess = options?.killProcess ?? defaultKillProcess;
  const fetchImpl = options?.fetch ?? fetch;
  const now = options?.now;
  const logger = options?.logger ?? console;
  const platform = options?.platform ?? process.platform;
  const systemRootDirectory = options?.systemRootDirectory;
  const spawn = options?.spawn ?? defaultSpawn;

  const launcherDirectory = resolveLauncherDirectory(homeDirectory);
  const pidFilePath = resolvePidFilePath(launcherDirectory);

  if (args[0] === "launcher") {
    if (args[1] === "export") {
      const launchJsonPath = resolveLaunchJsonPath(launcherDirectory);
      const encoded = await exportLaunchConfiguration(launchJsonPath);
      logger.log(encoded);
      return;
    }

    if (args[1] === "import") {
      await importLaunchConfiguration(
        {
          args: args.slice(2),
          fetch: fetchImpl,
          homeDirectory,
          isProcessAlive,
          logger,
          now,
        },
        launcherDirectory,
        pidFilePath,
      );
      return;
    }

    logger.error("Unknown launcher command. Use `hub launcher export` or `hub launcher import <text>`.");
    process.exitCode = 1;
    return;
  }

  if (args[0] === "backup") {
    await handleBackupCommand({
      args: args.slice(1),
      homeDirectory,
      isProcessAlive,
      logger,
      now,
    });
    return;
  }

  if (args[0] === "autostart") {
    const scope = args[1] === "system" ? "system" : "user";
    const mode = scope === "system" ? args[2] : args[1];

    await handleAutostartCommand({
      currentPath: process.env.PATH,
      homeDirectory: scope === "system" ? undefined : homeDirectory,
      mode: mode === "disable" ? "disable" : mode === "status" ? "status" : "enable",
      scope,
      platform,
      systemRootDirectory,
    });
    return;
  }

  if (args[0] === "status") {
    const pidText = await readPidFile(pidFilePath);
    const running = isLauncherAlreadyRunning(pidText, isProcessAlive);
    const autostartMode = await resolveAutostartMode({
      homeDirectory,
      platform,
      spawn,
      systemRootDirectory,
    });
    const updatesAvailable = await launcherHasUpdates(launcherDirectory, spawn);

    logger.log(`Launcher: ${running ? "Running" : "Not running"}`);
    logger.log(`Autolaunch: ${autostartMode === "boot" ? "On Boot" : autostartMode === "login" ? "On Login" : "Disabled"}`);
    logger.log(`Updates: ${updatesAvailable ? "Available" : "No updates"}`);
    return;
  }

  if (args[0] === "stop") {
    const stopped = await stopLauncher(pidFilePath, isProcessAlive, killProcess);
    logger.log(stopped ? `Hub Launcher stopped at ${launcherDirectory}` : `Hub Launcher was not running at ${launcherDirectory}`);
    return;
  }

  if (args[0] === "uninstall") {
    const uninstalled = await uninstallLauncher(launcherDirectory, pidFilePath, isProcessAlive);
    if (!uninstalled) {
      logger.error(`Hub Launcher is running at ${launcherDirectory}. Stop it first before uninstalling.`);
      process.exitCode = 1;
      return;
    }

    logger.log(`Hub Launcher uninstalled from ${launcherDirectory}`);
    return;
  }

  if (args[0] === "update") {
    await ensureLauncherCloned(launcherDirectory, spawn);

    const wasRunning = await stopLauncher(pidFilePath, isProcessAlive, killProcess);
    await updateLauncherRepository(launcherDirectory, spawn);
    await installLauncherDependencies(launcherDirectory, spawn);

    const pid = await launchLauncher(launcherDirectory, pidFilePath, spawn);
    logger.log(
      wasRunning
        ? `Hub Launcher updated and relaunched at ${launcherDirectory} (pid ${pid})`
        : `Hub Launcher updated and started at ${launcherDirectory} (pid ${pid})`,
    );
    return;
  }

  if (args[0] === "restart") {
    await ensureLauncherCloned(launcherDirectory, spawn);

    await stopLauncher(pidFilePath, isProcessAlive, killProcess);
    await installLauncherDependencies(launcherDirectory, spawn);
    await removePidFile(pidFilePath);

    const pid = await launchLauncher(launcherDirectory, pidFilePath, spawn);
    logger.log(`Hub Launcher restarted at ${launcherDirectory} (pid ${pid})`);
    return;
  }

  await ensureLauncherCloned(launcherDirectory, spawn);

  const pidText = await readPidFile(pidFilePath);
  if (isLauncherAlreadyRunning(pidText, isProcessAlive)) {
    console.log(`Hub Launcher is already running at ${launcherDirectory}`);
    return;
  }

  await installLauncherDependencies(launcherDirectory, spawn);
  await removePidFile(pidFilePath);

  const pid = await launchLauncher(launcherDirectory, pidFilePath, spawn);
  logger.log(`Hub Launcher started in the background at ${launcherDirectory} (pid ${pid})`);
}
