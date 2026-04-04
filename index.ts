#!/usr/bin/env bun

import { bootstrapEnvironmentVariable, bootstrapHub } from "./bootstrap";
import { main } from "./launcher";

if (import.meta.main) {
  const args = process.argv.slice(2);

  if (process.env[bootstrapEnvironmentVariable] === "1") {
    await main();
  } else {
    await bootstrapHub({ args });
  }
}
