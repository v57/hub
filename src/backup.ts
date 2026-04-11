import { constants as fsConstants } from "node:fs";
import path from "node:path";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { homedir } from "node:os";

import { LAUNCHER_PID_FILE_NAME, resolveLauncherDirectory } from "./launcher";

const BACKUPS_DIR_NAME = "Backups";

type PathLike = Pick<typeof path, "join" | "dirname">;
type LoggerLike = Pick<Console, "error" | "log">;

function defaultNow(): Date {
  return new Date();
}

function resolveBackupsDirectory(homeDirectory = homedir(), pathImpl: PathLike = path): string {
  return pathImpl.join(homeDirectory, "Hub", BACKUPS_DIR_NAME);
}

function resolveBackupDirectory(homeDirectory: string, backupId: string, pathImpl: PathLike = path): string {
  return pathImpl.join(resolveBackupsDirectory(homeDirectory, pathImpl), backupId);
}

function makeBackupId(now: Date): string {
  return now.toISOString().replace(/:/g, "-");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyFileWithClone(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_FICLONE);
  } catch {
    await copyFile(sourcePath, destinationPath);
  }
}

async function copyTree(sourcePath: string, destinationPath: string): Promise<void> {
  const stats = await lstat(sourcePath);

  if (stats.isDirectory()) {
    await mkdir(destinationPath, { recursive: true });

    const entries = await readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === LAUNCHER_PID_FILE_NAME) {
        continue;
      }

      await copyTree(path.join(sourcePath, entry.name), path.join(destinationPath, entry.name));
    }

    return;
  }

  if (stats.isSymbolicLink()) {
    const linkTarget = await readlink(sourcePath);
    try {
      await symlink(linkTarget, destinationPath);
    } catch {
      await copyTree(path.resolve(path.dirname(sourcePath), linkTarget), destinationPath);
    }
    return;
  }

  if (stats.isFile()) {
    await copyFileWithClone(sourcePath, destinationPath);
    return;
  }

  throw new Error(`Unsupported entry in backup source: ${sourcePath}`);
}

async function backupLauncher(homeDirectory: string, now: () => Date = defaultNow, logger: LoggerLike = console): Promise<string> {
  const launcherDirectory = resolveLauncherDirectory(homeDirectory);
  if (!(await pathExists(launcherDirectory))) {
    throw new Error(`Launcher directory not found at ${launcherDirectory}`);
  }

  const backupId = makeBackupId(now());
  const backupsDirectory = resolveBackupsDirectory(homeDirectory);
  const backupDirectory = resolveBackupDirectory(homeDirectory, backupId);

  await mkdir(backupsDirectory, { recursive: true });
  await rm(backupDirectory, { recursive: true, force: true });

  try {
    await copyTree(launcherDirectory, backupDirectory);
  } catch (error) {
    await rm(backupDirectory, { recursive: true, force: true });
    throw error;
  }

  return backupId;
}

async function listBackups(homeDirectory: string): Promise<string[]> {
  const backupsDirectory = resolveBackupsDirectory(homeDirectory);
  if (!(await pathExists(backupsDirectory))) {
    return [];
  }

  const entries = await readdir(backupsDirectory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => right.localeCompare(left));
}

async function restoreBackup(homeDirectory: string, backupId: string): Promise<void> {
  const backupDirectory = resolveBackupDirectory(homeDirectory, backupId);
  if (!(await pathExists(backupDirectory))) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  const launcherDirectory = resolveLauncherDirectory(homeDirectory);
  await rm(launcherDirectory, { recursive: true, force: true });
  await mkdir(path.dirname(launcherDirectory), { recursive: true });
  await copyTree(backupDirectory, launcherDirectory);
}

async function removeBackup(homeDirectory: string, backupId: string): Promise<boolean> {
  const backupDirectory = resolveBackupDirectory(homeDirectory, backupId);
  if (!(await pathExists(backupDirectory))) {
    return false;
  }

  await rm(backupDirectory, { recursive: true, force: true });
  return true;
}

async function removeAllBackups(homeDirectory: string): Promise<void> {
  await rm(resolveBackupsDirectory(homeDirectory), { recursive: true, force: true });
}

export async function handleBackupCommand(options: {
  args: string[];
  homeDirectory?: string;
  isProcessAlive?: (pid: number) => boolean;
  logger?: LoggerLike;
  now?: () => Date;
}): Promise<void> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const isProcessAlive = options.isProcessAlive ?? (() => false);
  const logger = options.logger ?? console;
  const now = options.now ?? defaultNow;
  const [subcommand, subcommandArg] = options.args;

  if (!subcommand) {
    const backupId = await backupLauncher(homeDirectory, now, logger);
    logger.log(`Hub Launcher backed up to ${resolveBackupDirectory(homeDirectory, backupId)}`);
    return;
  }

  if (subcommand === "list") {
    const backups = await listBackups(homeDirectory);
    if (backups.length === 0) {
      logger.log("No backups found");
      return;
    }

    for (const backupId of backups) {
      logger.log(backupId);
    }
    return;
  }

  if (subcommand === "restore") {
    const backups = await listBackups(homeDirectory);
    const backupId = subcommandArg ?? backups[0];
    if (!backupId) {
      console.error(`No backups available in ${resolveBackupsDirectory(homeDirectory)}`);
      process.exitCode = 1;
      return;
    }

    const launcherDirectory = resolveLauncherDirectory(homeDirectory);
    const pidFilePath = path.join(launcherDirectory, LAUNCHER_PID_FILE_NAME);
    const pidFile = Bun.file(pidFilePath);
    const pidText = await pidFile.exists() ? await pidFile.text() : null;
    const pid = pidText ? Number.parseInt(pidText.trim(), 10) : null;
    if (pid !== null && isProcessAlive(pid)) {
      logger.error(`Hub Launcher is running at ${launcherDirectory}. Stop it first before restoring.`);
      process.exitCode = 1;
      return;
    }

    await restoreBackup(homeDirectory, backupId);
    logger.log(`Hub Launcher restored from ${resolveBackupDirectory(homeDirectory, backupId)} to ${launcherDirectory}`);
    return;
  }

  if (subcommand === "remove") {
    if (subcommandArg === "all") {
      await removeAllBackups(homeDirectory);
      logger.log(`Removed all backups from ${resolveBackupsDirectory(homeDirectory)}`);
      return;
    }

    if (!subcommandArg) {
      logger.error("Please specify a backup id or 'all'");
      process.exitCode = 1;
      return;
    }

    const removed = await removeBackup(homeDirectory, subcommandArg);
    if (!removed) {
      logger.error(`Backup not found: ${subcommandArg}`);
      process.exitCode = 1;
      return;
    }

    logger.log(`Removed backup ${subcommandArg}`);
    return;
  }

  logger.error(`Unknown backup command: ${subcommand}`);
  process.exitCode = 1;
}

export {
  backupLauncher,
  listBackups,
  removeAllBackups,
  removeBackup,
  resolveBackupDirectory,
  resolveBackupsDirectory,
  restoreBackup,
};
