import { homedir, networkInterfaces } from "node:os";
import path from "node:path";

import { resolveLauncherDirectory } from "./launcher";

type LoggerLike = Pick<Console, "error" | "log">;

/** Runs `bun . --pair` in hub-server's folder: a one-shot that writes a new code and exits. */
export type RunPair = (directory: string) => Promise<{ exitCode: number; stderr: string }>;

const PAIR_HELP = [
  "Usage: hub pair [--new] [--address <host:port>]",
  "",
  "Shows the pairing code of this device's hub-server. Enter it with the hub's address in the",
  "Hub app (Connect to a Hub) to become the hub's owner. The code works once, for one hour.",
  "",
  "  --new                   Replace the code with a new one (hub-server --pair)",
  "  --address <host:port>   The address the Hub app should dial (default: this device's LAN address)",
].join("\n");

async function runPair(directory: string): Promise<{ exitCode: number; stderr: string }> {
  const pair = Bun.spawn([process.execPath, ".", "--pair"], { cwd: directory, stdout: "ignore", stderr: "pipe", timeout: 30_000 });
  const [exitCode, stderr] = await Promise.all([pair.exited, new Response(pair.stderr).text()]);
  return { exitCode, stderr };
}

/** The launcher's hub-server folder (`Git.directory` in hub-launcher names it after the repository) */
export function resolveHubServerDirectory(homeDirectory = homedir()): string {
  return path.join(resolveLauncherDirectory(homeDirectory), "apps", "hub-server");
}

/** `K7Q2MX` → `K7Q-2MX`, as hub-server shows it */
export function formatPairingCode(text: string): string | undefined {
  const code = text.replace(/[\s-]/g, "").toUpperCase();
  if (!code) return undefined;
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

async function readPairingCode(directory: string): Promise<string | undefined> {
  const file = Bun.file(path.join(directory, "data", "pairing-code"));
  return (await file.exists()) ? formatPairingCode(await file.text()) : undefined;
}

/** `hub://pair?a=<address>&c=<code>`, which the Hub app opens as "Connect to a Hub" with both filled in */
export function pairingLink(address: string, code: string): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/%3A/gi, ":");
  return `hub://pair?a=${encode(address)}&c=${encode(code)}`;
}

/**
 * This device's LAN IPv4 address with the hub's port, for other devices to dial. Ethernet and Wi-Fi interfaces come
 * before bridges and VPNs, and link-local addresses (169.254.x) last.
 */
export function lanAddress(port: string | number, interfaces = networkInterfaces()): string {
  const rank = (name: string, address: string) =>
    (address.startsWith("169.254.") ? 2 : 0) + (/^(en|eth|wl)/.test(name) ? 0 : 1);
  const candidates = Object.entries(interfaces)
    .flatMap(([name, list]) => (list ?? []).filter(item => item.family === "IPv4" && !item.internal).map(item => ({ name, address: item.address })))
    .sort((a, b) => rank(a.name, a.address) - rank(b.name, b.address));
  return `${candidates[0]?.address ?? "localhost"}:${port}`;
}

function hubPort(hub: string | undefined): string {
  if (!hub) return "1997";
  const match = /:(\d+)\/?$/.exec(hub) ?? /^(\d+)$/.exec(hub);
  return match?.[1] ?? "1997";
}

/**
 * The code never goes over the hub: it is read from hub-server's `data/pairing-code` on this device. With `--new`
 * (no owner yet, or every owner device lost) hub-server's one-shot `--pair` writes a new one.
 */
export async function pair(options: {
  args: string[];
  env?: Record<string, string | undefined>;
  homeDirectory?: string;
  logger?: LoggerLike;
  run?: RunPair;
  interfaces?: ReturnType<typeof networkInterfaces>;
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

  const directory = resolveHubServerDirectory(options.homeDirectory ?? homedir());
  if (!(await Bun.file(path.join(directory, "package.json")).exists())) {
    logger.error(`hub-server isn't installed at ${directory}. Start the launcher with \`hub\` first.`);
    process.exitCode = 1;
    return;
  }
  if (args.includes("--new")) {
    const result = await (options.run ?? runPair)(directory);
    if (result.exitCode !== 0) {
      logger.error(`hub-server --pair failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
      process.exitCode = 1;
      return;
    }
  }
  const code = await readPairingCode(directory);
  if (!code) {
    logger.log("No pairing code: this hub already has an owner, or the code was used or expired.");
    logger.log("Run `hub pair --new` for a new code.");
    return;
  }
  const dial = address ?? lanAddress(hubPort(env.HUB), options.interfaces);
  logger.log(`Pairing code: ${code} (works once, for one hour)`);
  logger.log(`Hub address:  ${dial}`);
  logger.log(`Link:         ${pairingLink(dial, code)}`);
  logger.log("In the Hub app, choose Connect to a Hub and enter the address and the code.");
}
