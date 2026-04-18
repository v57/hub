import { expect, test } from "bun:test";

import { bootstrapEnvironmentVariable, bootstrapHub } from "./bootstrap";

test("bootstraps the package and then runs hub with forwarded args", async () => {
  const commands: string[][] = [];
  const envs: Array<Record<string, string | undefined> | undefined> = [];
  const spawnOptions: Array<Record<string, unknown> | undefined> = [];

  await bootstrapHub({
    args: ["launch", "--port", "1997"],
    env: { PATH: "/usr/bin" },
    globalBinDir: "/Users/dimas/.bun/bin",
    which: () => "/Users/dimas/.bun/bin/hub",
    spawn: (cmd, options) => {
      commands.push(cmd);
      envs.push(options?.env as Record<string, string | undefined> | undefined);
      spawnOptions.push(options as Record<string, unknown> | undefined);

      return {
        exited: Promise.resolve(0),
      };
    },
  });

  expect(commands).toEqual([
    ["bun", "i", "-g", "v57/hub"],
    ["bun", "update", "-g", "v57/hub"],
    ["/Users/dimas/.bun/bin/hub", "launch", "--port", "1997"],
  ]);
  expect(spawnOptions[0]).toMatchObject({
    stdout: "ignore",
    stderr: "ignore",
  });
  expect(spawnOptions[1]).toMatchObject({
    stdout: "ignore",
    stderr: "ignore",
  });
  expect(spawnOptions[2]).toMatchObject({
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  expect(envs[2]?.PATH).toBe("/Users/dimas/.bun/bin:/usr/bin");
  expect(envs[2]?.[bootstrapEnvironmentVariable]).toBe("1");
});
