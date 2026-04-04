import path from "node:path";

const PACKAGE_SPEC = "v57/hub";
const BOOTSTRAP_ENV = "HUB_BOOTSTRAPPED";

type SpawnLike = {
  stdout?: ReadableStream<Uint8Array> | number | null;
  exited: Promise<number>;
};

type SpawnFunction = (cmd: string[], options?: Record<string, unknown>) => SpawnLike;

type WhichFunction = (bin: string, options?: { PATH?: string }) => string | null;

async function runCommand(cmd: string[], spawn: SpawnFunction): Promise<void> {
  const process = spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")} (exit code ${exitCode})`);
  }
}

export async function resolveGlobalBinDir(spawn: SpawnFunction): Promise<string> {
  const process = spawn(["bun", "pm", "bin", "-g"], {
    stdout: "pipe",
    stderr: "inherit",
  });

  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to resolve Bun global bin directory (exit code ${exitCode})`);
  }

  if (!process.stdout || typeof process.stdout === "number") {
    throw new Error("Failed to read Bun global bin directory");
  }

  const stdout = await process.stdout.text();
  return stdout.trim();
}

function buildPathEnv(globalBinDir: string, existingPath: string | undefined): string {
  return [globalBinDir, existingPath].filter(Boolean).join(path.delimiter);
}

export async function bootstrapHub(options?: {
  args?: string[];
  env?: Record<string, string | undefined>;
  globalBinDir?: string;
  spawn?: SpawnFunction;
  which?: WhichFunction;
}): Promise<void> {
  const args = options?.args ?? [];
  const spawn = options?.spawn ?? ((cmd, spawnOptions) => Bun.spawn({ cmd, ...spawnOptions }));
  const which = options?.which ?? ((bin, whichOptions) => Bun.which(bin, whichOptions));
  const env = options?.env ?? process.env;

  await runCommand(["bun", "i", "-g", PACKAGE_SPEC], spawn);
  await runCommand(["bun", "update", "-g", PACKAGE_SPEC], spawn);

  const globalBinDir = options?.globalBinDir ?? (await resolveGlobalBinDir(spawn));
  const pathEnv = buildPathEnv(globalBinDir, env.PATH);
  const hubCommand = which("hub", { PATH: pathEnv }) ?? "hub";

  const subprocess = spawn([hubCommand, ...args], {
    env: {
      ...env,
      PATH: pathEnv,
      [BOOTSTRAP_ENV]: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to run hub (exit code ${exitCode})`);
  }
}

export const bootstrapEnvironmentVariable = BOOTSTRAP_ENV;
