import { HubError } from '../errors'
import { BaseConnectionStore, type ConnectionStoreData } from './connection-store'

export const defaultBrowserConnectionsKey = 'hub-lib/connections'
export const defaultBrowserSelectedConnectionKey = 'hub-lib/selected'

export interface BrowserConnectionStoreOptions {
  storage?: BrowserStorage
  connectionsKey?: string
  selectedKey?: string
}

export interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type BrowserRuntime = typeof globalThis & {
  localStorage?: BrowserStorage
}

export class BrowserConnectionStore extends BaseConnectionStore {
  private storage?: BrowserStorage
  private connectionsKey: string
  private selectedKey: string

  constructor(options: BrowserConnectionStoreOptions = {}) {
    super()
    this.storage = options.storage
    this.connectionsKey = options.connectionsKey ?? defaultBrowserConnectionsKey
    this.selectedKey = options.selectedKey ?? defaultBrowserSelectedConnectionKey
  }

  protected async load(): Promise<ConnectionStoreData> {
    const storage = this.getStorage()
    const rawConnections = storage.getItem(this.connectionsKey)
    const selectedId = storage.getItem(this.selectedKey) ?? undefined
    if (!rawConnections) return { connections: [], selectedId }
    try {
      const connections = JSON.parse(rawConnections)
      return { connections: Array.isArray(connections) ? connections : [], selectedId }
    } catch {
      return { connections: [], selectedId }
    }
  }

  protected async save(data: ConnectionStoreData): Promise<void> {
    const storage = this.getStorage()
    storage.setItem(this.connectionsKey, JSON.stringify(data.connections))
    if (data.selectedId) {
      storage.setItem(this.selectedKey, data.selectedId)
    } else {
      storage.removeItem(this.selectedKey)
    }
  }

  private getStorage(): BrowserStorage {
    const storage = this.storage ?? (globalThis as BrowserRuntime).localStorage
    if (!storage) {
      throw new HubError('localStorage unavailable', {
        kind: 'validation',
        hint: 'Pass a storage adapter or use MemoryConnectionStore in non-browser runtimes.',
      })
    }
    return storage
  }
}
