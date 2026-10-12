import { generateHubKeyMaterial, getHubPublicKey, hubAuthHeaders, signHubAuth } from './key-material'

export interface KeyStore {
  getOrCreatePrivateKey(): Promise<string>
  publicKey(): Promise<string>
  sign(expiresSeconds?: number): Promise<string>
  authHeaders(expiresSeconds?: number): Promise<Record<'auth' | 'v', string>>
  reset?(): Promise<void>
}

export abstract class StoredKeyStore implements KeyStore {
  protected cachedKey?: string

  async getOrCreatePrivateKey(): Promise<string> {
    if (this.cachedKey) return this.cachedKey
    const stored = await this.readStoredKey()
    if (stored) {
      this.cachedKey = stored
      return stored
    }
    const generated = await generateHubKeyMaterial()
    await this.writeStoredKey(generated)
    this.cachedKey = generated
    return generated
  }

  async publicKey(): Promise<string> {
    return getHubPublicKey(await this.getOrCreatePrivateKey())
  }

  async sign(expiresSeconds = 10): Promise<string> {
    return signHubAuth(await this.getOrCreatePrivateKey(), expiresSeconds)
  }

  async authHeaders(expiresSeconds = 10): Promise<Record<'auth' | 'v', string>> {
    return hubAuthHeaders(await this.getOrCreatePrivateKey(), expiresSeconds)
  }

  async reset(): Promise<void> {
    this.cachedKey = undefined
    await this.deleteStoredKey()
  }

  protected abstract readStoredKey(): Promise<string | undefined>
  protected abstract writeStoredKey(key: string): Promise<void>
  protected abstract deleteStoredKey(): Promise<void>
}
