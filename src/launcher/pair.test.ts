import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatPairingCode, lanAddress, pair, pairingLink, resolveHubServerDirectory, type RunPair } from "./pair";
import { run } from "./index";

let home: string;
let server: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hub-pair-"));
  server = resolveHubServerDirectory(home);
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  process.exitCode = 0;
});

function logger() {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, log: (line: string) => lines.push(line), error: (line: string) => errors.push(line) };
}

function install(code?: string) {
  mkdirSync(join(server, "data"), { recursive: true });
  writeFileSync(join(server, "package.json"), "{}");
  if (code) writeFileSync(join(server, "data", "pairing-code"), code);
}

const interfaces = {
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  en0: [{ address: "fe80::1", family: "IPv6", internal: false }, { address: "192.168.1.5", family: "IPv4", internal: false }],
} as unknown as Parameters<typeof lanAddress>[1];

test("builds hub://pair links", () => {
  expect(pairingLink("192.168.1.5:1997", "K7Q-2MX")).toBe("hub://pair?a=192.168.1.5:1997&c=K7Q-2MX");
  expect(pairingLink("hub.example.com:443/x?y", "K7Q-2MX")).toBe("hub://pair?a=hub.example.com:443%2Fx%3Fy&c=K7Q-2MX");
});

test("formats codes and picks the first LAN IPv4 address", () => {
  expect(formatPairingCode("k7q2mx\n")).toBe("K7Q-2MX");
  expect(formatPairingCode("\n")).toBeUndefined();
  expect(lanAddress(1997, interfaces)).toBe("192.168.1.5:1997");
  expect(lanAddress(1997, {})).toBe("localhost:1997");
  const mac = {
    bridge0: [{ address: "192.168.2.1", family: "IPv4", internal: false }],
    en9: [{ address: "169.254.108.35", family: "IPv4", internal: false }],
    en0: [{ address: "192.168.1.21", family: "IPv4", internal: false }],
  } as unknown as Parameters<typeof lanAddress>[1];
  expect(lanAddress(1997, mac)).toBe("192.168.1.21:1997");
});

test("reads the code from hub-server's data folder and prints it with the address and link", async () => {
  install("K7Q2MX\n");
  const output = logger();
  await pair({ args: [], env: {}, homeDirectory: home, logger: output, interfaces });
  expect(output.lines).toEqual([
    "Pairing code: K7Q-2MX (works once, for one hour)",
    "Hub address:  192.168.1.5:1997",
    "Link:         hub://pair?a=192.168.1.5:1997&c=K7Q-2MX",
    "In the Hub app, choose Connect to a Hub and enter the address and the code.",
  ]);
});

test("--new runs hub-server --pair in its folder; --address and HUB set the address", async () => {
  install("OLD111");
  const runs: string[] = [];
  const runPair: RunPair = async directory => {
    runs.push(directory);
    writeFileSync(join(directory, "data", "pairing-code"), "NEW123");
    return { exitCode: 0, stderr: "" };
  };
  const output = logger();
  await pair({ args: ["--new", "--address", "mac.local:2000"], env: {}, homeDirectory: home, logger: output, run: runPair, interfaces });
  expect(runs).toEqual([server]);
  expect(output.lines[0]).toBe("Pairing code: NEW-123 (works once, for one hour)");
  expect(output.lines[2]).toBe("Link:         hub://pair?a=mac.local:2000&c=NEW-123");

  const lan = logger();
  await pair({ args: [], env: { HUB: "ws://localhost:2000" }, homeDirectory: home, logger: lan, interfaces });
  expect(lan.lines[1]).toBe("Hub address:  192.168.1.5:2000");
});

test("reports a failed --pair", async () => {
  install();
  const output = logger();
  await pair({ args: ["--new"], env: {}, homeDirectory: home, logger: output, run: async () => ({ exitCode: 1, stderr: "boom\n" }) });
  expect(output.errors).toEqual(["hub-server --pair failed: boom"]);
  expect(process.exitCode).toBe(1);
});

test("says when there is no code", async () => {
  install();
  const output = logger();
  await pair({ args: [], env: {}, homeDirectory: home, logger: output, interfaces });
  expect(output.lines[0]).toContain("No pairing code");
});

test("needs hub-server installed by the launcher", async () => {
  const output = logger();
  await pair({ args: [], env: {}, homeDirectory: home, logger: output });
  expect(output.errors[0]).toContain("hub-server isn't installed");
  expect(process.exitCode).toBe(1);
});

test("hub pair runs without bootstrapping", async () => {
  const calls: unknown[] = [];
  await run({
    args: ["pair", "--new"],
    env: { npm_lifecycle_event: "bunx" },
    bootstrap: () => Promise.reject(new Error("bootstrapped")),
    pair: async options => {
      calls.push(options.args);
    },
  });
  expect(calls).toEqual([["--new"]]);
});
