import { HubError } from '../errors'
import { StoredKeyStore } from './key-store'

export const defaultBunSecretsService = 'dev.v57.hub-lib'
export const defaultBunSecretsName = 'ed25519-key'

export interface BunSecretsKeyStoreOptions {
  service?: string
  name?: string
  allowUnrestrictedAccess?: boolean
}

interface BunSecretsRuntime {
  Bun?: {
    secrets?: {
      get(options: { service: string; name: string }): Promise<string | null>
      set(options: { service: string; name: string; value: string; allowUnrestrictedAccess?: boolean }): Promise<void>
      delete(options: { service: string; name: string }): Promise<boolean>
    }
  }
}

export class BunSecretsKeyStore extends StoredKeyStore {
  service: string
  name: string
  allowUnrestrictedAccess?: boolean

  constructor(options: BunSecretsKeyStoreOptions = {}) {
    super()
    this.service = options.service ?? defaultBunSecretsService
    this.name = options.name ?? defaultBunSecretsName
    this.allowUnrestrictedAccess = options.allowUnrestrictedAccess
  }

  protected async readStoredKey(): Promise<string | undefined> {
    return (await this.secrets().get({ service: this.service, name: this.name })) ?? undefined
  }

  protected async writeStoredKey(key: string): Promise<void> {
    await this.secrets().set({
      service: this.service,
      name: this.name,
      value: key,
      allowUnrestrictedAccess: this.allowUnrestrictedAccess,
    })
  }

  protected async deleteStoredKey(): Promise<void> {
    await this.secrets().delete({ service: this.service, name: this.name })
  }

  private secrets() {
    const secrets = (globalThis as BunSecretsRuntime).Bun?.secrets
    if (!secrets) {
      throw new HubError('Bun.secrets unavailable', {
        kind: 'validation',
        hint: 'Use MemoryKeyStore or BrowserKeyStore outside Bun.',
      })
    }
    return secrets
  }
}
