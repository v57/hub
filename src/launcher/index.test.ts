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
