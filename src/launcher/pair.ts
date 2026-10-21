import { homedir, networkInterfaces } from "node:os";
import path from "node:path";

import { HubClient } from "../hub/client";
import { BunFileHubKeyStore, type HubKeyStore } from "../hub/auth/hub-key-store";
import { MemoryKeyStore } from "../hub/auth/memory-key-store";
import { LauncherControl } from "../hub/api/launcher-control";
import { resolveLauncherDirectory } from "./launcher";

type LoggerLike = Pick<Console, "error" | "log">;

/** What `hub pair` needs from the launcher: its info stream and `launcher/pair/new`. */
export interface PairingLauncher {
  pairingCode(): Promise<string | undefined>;
  newPairingCode(): Promise<string>;
  stop(): void;
}

export type ConnectLauncher = (options: { address: string | number; launcherKey: string; hubKeys?: HubKeyStore }) => PairingLauncher;

const PAIR_HELP = [
  "Usage: hub pair [--new] [--address <host:port>]",
  "",
  "Shows the pairing code of this device's hub-server. Enter it with the hub's address in the",
  "Hub app (Connect to a Hub) to become the hub's owner. The code works once, for one hour.",
  "",
  "  --new                   Replace the code with a new one",
  "  --address <host:port>   The address the Hub app should dial (default: this device's LAN address)",
].join("\n");

/** Connects to the local hub with the launcher's own key, which is the only key the launcher shows the code to. */
function connectLauncher(options: { address: string | number; launcherKey: string; hubKeys?: HubKeyStore }): PairingLauncher {
  const client = new HubClient({
    address: options.address,
    keyStore: new MemoryKeyStore(options.launcherKey),
    hubKeys: options.hubKeys ?? new BunFileHubKeyStore(),
  });
  const launcher = new LauncherControl(client);
  return {
    pairingCode: async () => (await launcher.info()).pairingCode,
    newPairingCode: () => launcher.newPairingCode(),
    stop: () => client.stop(),
  };
}

/** `hub://pair?a=<address>&c=<code>`, which the Hub app opens as "Connect to a Hub" with both filled in */
export function pairingLink(address: string, code: string): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/%3A/gi, ":");
  return `hub://pair?a=${encode(address)}&c=${encode(code)}`;
}

/** This device's first LAN IPv4 address with the hub's port, for other devices to dial */
export function lanAddress(port: string | number, interfaces = networkInterfaces()): string {
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) return `${item.address}:${port}`;
    }
  }
  return `localhost:${port}`;
}

function hubPort(hub: string | undefined): string {
  if (!hub) return "1997";
  const match = /:(\d+)\/?$/.exec(hub) ?? /^(\d+)$/.exec(hub);
  return match?.[1] ?? "1997";
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function pair(options: {
  args: string[];
  env?: Record<string, string | undefined>;
  homeDirectory?: string;
  logger?: LoggerLike;
  connect?: ConnectLauncher;
  interfaces?: ReturnType<typeof networkInterfaces>;
  timeout?: number;
}): Promise<void> {
  const logger = options.logger ?? console;
  const env = options.env ?? process.env;
  const args = options.args;
  if (args.includes("-h") || args.includes("--help")) {
    logger.log(PAIR_HELP);
    return;
  }
  const addressIndex = args.indexOf("--address");
  const address = addressIndex >= 0 ? args[addressIndex + 1] : undefined;
  if (addressIndex >= 0 && !address) {
    logger.error("--address needs a value, such as 192.168.1.5:1997");
    process.exitCode = 1;
    return;
  }

  const launcherDirectory = resolveLauncherDirectory(options.homeDirectory ?? homedir());
  const keyFile = Bun.file(path.join(launcherDirectory, "auth"));
  if (!(await keyFile.exists())) {
    logger.error(`Hub Launcher has no key at ${launcherDirectory}. Start it with \`hub\` first.`);
    process.exitCode = 1;
    return;
  }
  const hub = env.HUB ?? 1997;
  const launcher = (options.connect ?? connectLauncher)({ address: hub, launcherKey: (await keyFile.text()).trim() });
  try {
    const timeout = options.timeout ?? 15_000;
    const unreachable = `Can't reach the hub at ${hub}. Is the launcher running (\`hub status\`)?`;
    const code = args.includes("--new")
      ? await withTimeout(launcher.newPairingCode(), timeout, unreachable)
      : await withTimeout(launcher.pairingCode(), timeout, unreachable);
    if (!code) {
      logger.log("No pairing code: this hub already has an owner, or hub-server isn't installed.");
      logger.log("Run `hub pair --new` for a new code.");
      return;
    }
    const dial = address ?? lanAddress(hubPort(env.HUB), options.interfaces);
    logger.log(`Pairing code: ${code} (works once, for one hour)`);
    logger.log(`Hub address:  ${dial}`);
    logger.log(`Link:         ${pairingLink(dial, code)}`);
    logger.log("In the Hub app, choose Connect to a Hub and enter the address and the code.");
  } finally {
    launcher.stop();
  }
}
