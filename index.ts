#!/usr/bin/env bun

import { run } from './src/launcher/index.ts'

if (import.meta.main) {
  await run()
}
