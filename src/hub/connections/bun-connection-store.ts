import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { BaseConnectionStore, type ConnectionStoreData } from './connection-store'

export const defaultConnectionStoreFileName = 'connections.json'

type BunRuntime = typeof globalThis & {
  Bun?: {
    env?: Record<string, string | undefined>
    file(path: string): { json(): Promise<unknown> }
    write(path: string, data: string): Promise<number>
  }
}

export interface BunFileConnectionStoreOptions {
  path?: string
  home?: string
}

export class BunFileConnectionStore extends BaseConnectionStore {
  path: string

  constructor(options: BunFileConnectionStoreOptions = {}) {
    super()
    this.path = options.path ?? join(resolveHubLibHome(options.home), defaultConnectionStoreFileName)
  }

  protected async load(): Promise<ConnectionStoreData> {
    try {
      const data = await this.bun().file(this.path).json()
      if (isConnectionStoreData(data)) return data
      return { connections: [] }
    } catch {
      return { connections: [] }
    }
  }

  protected async save(data: ConnectionStoreData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await this.bun().write(this.path, `${JSON.stringify(data, null, 2)}\n`)
  }

  private bun() {
    const bun = (globalThis as BunRuntime).Bun
    if (!bun) throw new Error('Bun runtime unavailable')
    return bun
  }
}

export function resolveHubLibHome(home?: string): string {
  const runtimeHome = (globalThis as BunRuntime).Bun?.env?.HUB_LIB_HOME
  return home ?? runtimeHome ?? join(homedir(), '.hub-lib')
}

function isConnectionStoreData(value: unknown): value is ConnectionStoreData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<ConnectionStoreData>
  return Array.isArray(data.connections)
}
