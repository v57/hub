import { bootstrapEnvironmentVariable, bootstrapHub } from './bootstrap'
import { main } from './launcher'

export async function run(): Promise<void> {
  const args = process.argv.slice(2)

  if (process.env[bootstrapEnvironmentVariable] === '1') {
    await main()
  } else {
    await bootstrapHub({ args })
  }
}
