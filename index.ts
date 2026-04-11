#!/usr/bin/env bun

import { run } from './src/index.ts'

if (import.meta.main) {
  await run()
}
