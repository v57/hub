import { expect, test } from "bun:test";

import { bootstrapEnvironmentVariable } from "./bootstrap";
import { run } from "./index";

test("runs the launcher directly when invoked as hub", async () => {
  const bootstrapCalls: Array<{ args?: string[]; env?: Record<string, string | undefined> }> = [];
  const launchCalls: Array<{ args?: string[] }> = [];

  await run({
    args: ["status"],
    env: {},
    bootstrap: options => {
      bootstrapCalls.push(options ?? {});
      return Promise.resolve();
    },
    launch: options => {
      launchCalls.push(options ?? {});
      return Promise.resolve();
    },
  });

  expect(bootstrapCalls).toEqual([]);
  expect(launchCalls).toEqual([
    { args: ["status"] },
  ]);
});

test("prints help without bootstrapping", async () => {
  const bootstrapCalls: Array<{ args?: string[]; env?: Record<string, string | undefined> }> = [];
  const launchCalls: Array<{ args?: string[] }> = [];
  const messages: string[] = [];

  await run({
    args: ["--help"],
    env: {
      npm_lifecycle_event: "bunx",
    },
    bootstrap: options => {
      bootstrapCalls.push(options ?? {});
      return Promise.resolve();
    },
    launch: options => {
      launchCalls.push(options ?? {});
      return Promise.resolve();
    },
    logger: {
      log: message => messages.push(message),
    },
  });

  expect(bootstrapCalls).toEqual([]);
  expect(launchCalls).toEqual([]);
  expect(messages[0]).toContain("Usage: hub [command] [options]");
  expect(messages[0]).toContain("autostart   Manage login or startup launch");
  expect(messages[0]).toContain("client      Start the terminal client");
});

test("bootstraps when invoked through bunx", async () => {
  const bootstrapCalls: Array<{ args?: string[]; env?: Record<string, string | undefined> }> = [];
  const launchCalls: Array<{ args?: string[] }> = [];

  await run({
    args: ["status"],
    env: {
      npm_lifecycle_event: "bunx",
    },
    bootstrap: options => {
      bootstrapCalls.push(options ?? {});
      return Promise.resolve();
    },
    launch: options => {
      launchCalls.push(options ?? {});
      return Promise.resolve();
    },
  });

  expect(bootstrapCalls).toEqual([
    {
      args: ["status"],
      env: {
        npm_lifecycle_event: "bunx",
      },
    },
  ]);
  expect(launchCalls).toEqual([]);
});

test("runs client before launcher bootstrap", async () => {
  const bootstrapCalls: Array<{ args?: string[]; env?: Record<string, string | undefined> }> = [];
  const launchCalls: Array<{ args?: string[] }> = [];
  const clientCalls: Array<{ args?: string[]; connectionStore?: unknown }> = [];

  await run({
    args: ["client", "--smoke"],
    env: {
      npm_lifecycle_event: "bunx",
    },
    bootstrap: options => {
      bootstrapCalls.push(options ?? {});
      return Promise.resolve();
    },
    launch: options => {
      launchCalls.push(options ?? {});
      return Promise.resolve();
    },
    client: (options = {}) => {
      clientCalls.push({ args: options.args, connectionStore: options.connectionStore });
      return Promise.resolve();
    },
  });

  expect(bootstrapCalls).toEqual([]);
  expect(launchCalls).toEqual([]);
  expect(clientCalls).toEqual([
    { args: ["--smoke"], connectionStore: expect.any(Object) },
  ]);
});

test("passes a persistent connection store to the client command", async () => {
  const clientCalls: Array<{ connectionStore?: unknown }> = [];

  await run({
    args: ["client"],
    env: {},
    client: (options = {}) => {
      clientCalls.push({ connectionStore: options.connectionStore });
      return Promise.resolve();
    },
    launch: () => Promise.resolve(),
  });

  expect(clientCalls).toHaveLength(1);
  expect(clientCalls[0]?.connectionStore).toBeDefined();
});

test("keeps the bootstrapped launcher on the direct path", async () => {
  const bootstrapCalls: Array<{ args?: string[]; env?: Record<string, string | undefined> }> = [];
  const launchCalls: Array<{ args?: string[] }> = [];

  await run({
    args: ["status"],
    env: {
      npm_lifecycle_event: "bunx",
      [bootstrapEnvironmentVariable]: "1",
    },
    bootstrap: options => {
      bootstrapCalls.push(options ?? {});
      return Promise.resolve();
    },
    launch: options => {
      launchCalls.push(options ?? {});
      return Promise.resolve();
    },
  });

  expect(bootstrapCalls).toEqual([]);
  expect(launchCalls).toEqual([
    { args: ["status"] },
  ]);
});
