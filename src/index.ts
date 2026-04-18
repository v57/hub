import { bootstrapEnvironmentVariable, bootstrapHub } from './bootstrap'
import { main, printHelp } from './launcher'

type RunOptions = {
  args?: string[]
  env?: Record<string, string | undefined>
  bootstrap?: typeof bootstrapHub
  launch?: typeof main
  logger?: Pick<Console, 'log'>
}

function shouldBootstrap(env: Record<string, string | undefined>): boolean {
  return env.npm_lifecycle_event === 'bunx'
}

export async function run(options?: RunOptions): Promise<void> {
  const args = options?.args ?? process.argv.slice(2)
  const env = options?.env ?? process.env
  const bootstrap = options?.bootstrap ?? bootstrapHub
  const launch = options?.launch ?? main
  const logger = options?.logger ?? console

  if (args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    printHelp(logger)
    return
  }

  if (env[bootstrapEnvironmentVariable] === '1') {
    await launch({ args })
    return
  }

  if (shouldBootstrap(env)) {
    await bootstrap({ args, env })
    return
  }

  await launch({ args })
}
