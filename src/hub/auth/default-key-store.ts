import { BunSecretsKeyStore } from './bun-secrets-key-store'
import type { KeyStore } from './key-store'
import { MemoryKeyStore } from './memory-key-store'

export function createDefaultKeyStore(): KeyStore {
  return new FallbackKeyStore(new BunSecretsKeyStore(), new MemoryKeyStore())
}

class FallbackKeyStore implements KeyStore {
  private primaryDisabled = false

  constructor(
    private primary: KeyStore,
    private fallback: KeyStore,
  ) {}

  getOrCreatePrivateKey(): Promise<string> {
    return this.use(keyStore => keyStore.getOrCreatePrivateKey())
  }

  publicKey(): Promise<string> {
    return this.use(keyStore => keyStore.publicKey())
  }

  sign(expiresSeconds?: number): Promise<string> {
    return this.use(keyStore => keyStore.sign(expiresSeconds))
  }

  authHeaders(expiresSeconds?: number): Promise<Record<'auth' | 'v', string>> {
    return this.use(keyStore => keyStore.authHeaders(expiresSeconds))
  }

  async reset(): Promise<void> {
    const errors: unknown[] = []
    for (const keyStore of [this.primary, this.fallback]) {
      if (!keyStore.reset) continue
      try {
        await keyStore.reset()
      } catch (error) {
        errors.push(error)
      }
    }
    this.primaryDisabled = false
    if (errors.length === 2) throw errors[0]
  }

  private async use<T>(operation: (keyStore: KeyStore) => Promise<T>): Promise<T> {
    if (!this.primaryDisabled) {
      try {
        return await operation(this.primary)
      } catch {
        this.primaryDisabled = true
      }
    }
    return operation(this.fallback)
  }
}
