import { expect, test } from "bun:test";

import { bootstrapEnvironmentVariable, bootstrapHub } from "./bootstrap";

test("bootstraps the package and then runs hub with forwarded args", async () => {
  const commands: string[][] = [];
  const envs: Array<Record<string, string | undefined> | undefined> = [];

  await bootstrapHub({
    args: ["launch", "--port", "1997"],
    env: { PATH: "/usr/bin" },
    globalBinDir: "/Users/dimas/.bun/bin",
    which: () => "/Users/dimas/.bun/bin/hub",
    spawn: (cmd, options) => {
      commands.push(cmd);
      envs.push(options?.env as Record<string, string | undefined> | undefined);

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
  expect(envs[2]?.PATH).toBe("/Users/dimas/.bun/bin:/usr/bin");
  expect(envs[2]?.[bootstrapEnvironmentVariable]).toBe("1");
});
