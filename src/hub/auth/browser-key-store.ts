import { HubError } from '../errors'
import { StoredKeyStore } from './key-store'

export const defaultBrowserKeyStorageKey = 'hub-lib/auth'

export interface BrowserKeyStoreOptions {
  storage?: BrowserStorage
  key?: string
}

export interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type BrowserRuntime = typeof globalThis & {
  localStorage?: BrowserStorage
}

export class BrowserKeyStore extends StoredKeyStore {
  private storage?: BrowserStorage
  private key: string

  constructor(options: BrowserKeyStoreOptions = {}) {
    super()
    this.storage = options.storage
    this.key = options.key ?? defaultBrowserKeyStorageKey
  }

  protected async readStoredKey(): Promise<string | undefined> {
    return this.getStorage().getItem(this.key) ?? undefined
  }

  protected async writeStoredKey(key: string): Promise<void> {
    this.getStorage().setItem(this.key, key)
  }

  protected async deleteStoredKey(): Promise<void> {
    this.getStorage().removeItem(this.key)
  }

  private getStorage(): BrowserStorage {
    const storage = this.storage ?? (globalThis as BrowserRuntime).localStorage
    if (!storage) {
      throw new HubError('localStorage unavailable', {
        kind: 'validation',
        hint: 'Pass a storage adapter or use MemoryKeyStore in non-browser runtimes.',
      })
    }
    return storage
  }
}
