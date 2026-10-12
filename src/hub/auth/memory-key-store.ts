import { StoredKeyStore } from './key-store'

export class MemoryKeyStore extends StoredKeyStore {
  constructor(private key?: string) {
    super()
  }

  protected async readStoredKey(): Promise<string | undefined> {
    return this.key
  }

  protected async writeStoredKey(key: string): Promise<void> {
    this.key = key
  }

  protected async deleteStoredKey(): Promise<void> {
    this.key = undefined
  }
}
