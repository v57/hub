import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lanAddress, pair, pairingLink, type ConnectLauncher } from "./pair";
import { run } from "./index";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hub-pair-"));
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

function launcherKey(text = "launcher-key-material") {
  mkdirSync(join(home, "Hub", "Launcher"), { recursive: true });
  writeFileSync(join(home, "Hub", "Launcher", "auth"), `${text}\n`);
}

const interfaces = {
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  en0: [{ address: "fe80::1", family: "IPv6", internal: false }, { address: "192.168.1.5", family: "IPv4", internal: false }],
} as unknown as Parameters<typeof lanAddress>[1];

function fakeLauncher(code: string | undefined, calls: string[] = []): ConnectLauncher {
  return options => {
    calls.push(`connect ${options.address} ${options.launcherKey}`);
    return {
      pairingCode: async () => {
        calls.push("info");
        return code;
      },
      newPairingCode: async () => {
        calls.push("new");
        return "NEW-123";
      },
      stop: () => calls.push("stop"),
    };
  };
}

test("builds hub://pair links", () => {
  expect(pairingLink("192.168.1.5:1997", "K7Q-2MX")).toBe("hub://pair?a=192.168.1.5:1997&c=K7Q-2MX");
  expect(pairingLink("hub.example.com:443/x?y", "K7Q-2MX")).toBe("hub://pair?a=hub.example.com:443%2Fx%3Fy&c=K7Q-2MX");
});

test("picks the first LAN IPv4 address", () => {
  expect(lanAddress(1997, interfaces)).toBe("192.168.1.5:1997");
  expect(lanAddress(1997, {})).toBe("localhost:1997");
});

test("shows the launcher's pairing code with the hub address and link, using the launcher key", async () => {
  launcherKey();
  const calls: string[] = [];
  const output = logger();
  await pair({ args: [], env: {}, homeDirectory: home, logger: output, connect: fakeLauncher("K7Q-2MX", calls), interfaces });
  expect(calls).toEqual(["connect 1997 launcher-key-material", "info", "stop"]);
  expect(output.lines).toEqual([
    "Pairing code: K7Q-2MX (works once, for one hour)",
    "Hub address:  192.168.1.5:1997",
    "Link:         hub://pair?a=192.168.1.5:1997&c=K7Q-2MX",
    "In the Hub app, choose Connect to a Hub and enter the address and the code.",
  ]);
});

test("--new asks the launcher for a new code; --address and HUB override the address", async () => {
  launcherKey();
  const calls: string[] = [];
  const output = logger();
  await pair({ args: ["--new", "--address", "mac.local:2000"], env: { HUB: "ws://localhost:2000" }, homeDirectory: home, logger: output, connect: fakeLauncher(undefined, calls), interfaces });
  expect(calls).toEqual(["connect ws://localhost:2000 launcher-key-material", "new", "stop"]);
  expect(output.lines[0]).toBe("Pairing code: NEW-123 (works once, for one hour)");
  expect(output.lines[2]).toBe("Link:         hub://pair?a=mac.local:2000&c=NEW-123");

  const lan = logger();
  await pair({ args: [], env: { HUB: "ws://localhost:2000" }, homeDirectory: home, logger: lan, connect: fakeLauncher("K7Q-2MX"), interfaces });
  expect(lan.lines[1]).toBe("Hub address:  192.168.1.5:2000");
});

test("says when there is no code", async () => {
  launcherKey();
  const output = logger();
  await pair({ args: [], env: {}, homeDirectory: home, logger: output, connect: fakeLauncher(undefined), interfaces });
  expect(output.lines[0]).toContain("No pairing code");
});

test("needs the launcher's key", async () => {
  const output = logger();
  await pair({ args: [], env: {}, homeDirectory: home, logger: output, connect: fakeLauncher("K7Q-2MX") });
  expect(output.errors[0]).toContain("has no key");
  expect(process.exitCode).toBe(1);
});

test("reports an unreachable hub instead of waiting", async () => {
  launcherKey();
  const output = logger();
  const hanging: ConnectLauncher = () => ({ pairingCode: () => new Promise(() => {}), newPairingCode: () => new Promise(() => {}), stop: () => {} });
  await expect(pair({ args: [], env: {}, homeDirectory: home, logger: output, connect: hanging, timeout: 20 })).rejects.toThrow("Can't reach the hub at 1997");
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
