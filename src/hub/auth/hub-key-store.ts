import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { normalizeHubAddress } from '../connections/connection-store'
import { resolveHubLibHome } from '../connections/bun-connection-store'
import type { HubAddress } from '../types/common'

export const defaultHubKeyStoreFileName = 'hubs.json'

/** Hub keys pinned per hub address, learned from `hub/info` or supplied up front. */
export interface HubKeyStore {
  get(address: HubAddress): Promise<string | undefined>
  pin(address: HubAddress, hubKey: string): Promise<void>
  forget(address: HubAddress): Promise<boolean>
  list(): Promise<Record<string, string>>
}

export abstract class BaseHubKeyStore implements HubKeyStore {
  async get(address: HubAddress): Promise<string | undefined> {
    return (await this.load())[normalizeHubAddress(address)]
  }

  async pin(address: HubAddress, hubKey: string): Promise<void> {
    const pins = await this.load()
    pins[normalizeHubAddress(address)] = hubKey
    await this.save(pins)
  }

  async forget(address: HubAddress): Promise<boolean> {
    const pins = await this.load()
    const normalized = normalizeHubAddress(address)
    if (!(normalized in pins)) return false
    delete pins[normalized]
    await this.save(pins)
    return true
  }

  async list(): Promise<Record<string, string>> {
    return this.load()
  }

  protected abstract load(): Promise<Record<string, string>>
  protected abstract save(pins: Record<string, string>): Promise<void>
}

export class MemoryHubKeyStore extends BaseHubKeyStore {
  private pins: Record<string, string>

  constructor(pins: Record<string, string> = {}) {
    super()
    this.pins = { ...pins }
  }

  protected async load(): Promise<Record<string, string>> {
    return { ...this.pins }
  }

  protected async save(pins: Record<string, string>): Promise<void> {
    this.pins = { ...pins }
  }
}

export interface BunFileHubKeyStoreOptions {
  path?: string
  home?: string
}

/** `hubs.json` (`{ "<address>": "<hub SPKI>" }`) next to `connections.json`, written to a temp file then renamed. */
export class BunFileHubKeyStore extends BaseHubKeyStore {
  path: string

  constructor(options: BunFileHubKeyStoreOptions = {}) {
    super()
    this.path = options.path ?? join(resolveHubLibHome(options.home), defaultHubKeyStoreFileName)
  }

  protected async load(): Promise<Record<string, string>> {
    try {
      const data = await Bun.file(this.path).json()
      if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
      const pins: Record<string, string> = {}
      for (const [address, key] of Object.entries(data)) if (typeof key === 'string') pins[address] = key
      return pins
    } catch {
      return {}
    }
  }

  protected async save(pins: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.tmp`
    await Bun.write(temp, `${JSON.stringify(pins, null, 2)}\n`)
    await rename(temp, this.path)
  }
}
