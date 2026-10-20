const privateDerLength = 48
const publicDerLength = 44
const textEncoder = new TextEncoder()

type SubtleRuntime = typeof globalThis & {
  crypto?: {
    subtle?: {
      generateKey(algorithm: unknown, extractable: boolean, keyUsages: string[]): Promise<CryptoKeyPairLike>
      exportKey(format: string, key: unknown): Promise<ArrayBuffer>
      importKey(format: string, keyData: Uint8Array, algorithm: unknown, extractable: boolean, keyUsages: string[]): Promise<unknown>
      sign(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>
    }
  }
  Bun?: unknown
  process?: { versions?: { node?: string } }
  atob?: (value: string) => string
  btoa?: (value: string) => string
}

interface CryptoKeyPairLike {
  privateKey: unknown
  publicKey: unknown
}

export async function generateHubKeyMaterial(): Promise<string> {
  if (hasNodeCrypto()) return generateNodeKeyMaterial()
  return generateWebKeyMaterial()
}

export function getHubPublicKey(key: string): string {
  const keyBuffer = decodeBase64(key)
  if (keyBuffer.length < publicDerLength) throw new Error('invalid Hub key material')
  return encodeBase64(keyBuffer.subarray(keyBuffer.length - publicDerLength))
}

/** Signs `auth` for one hub (`v: 1`) when `hubKey` is given, otherwise the hub-agnostic `v: 0` token. */
export async function signHubAuth(key: string, expiresSeconds = 10, hubKey?: string): Promise<string> {
  return signHubAuthAt(key, Math.round(Date.now() / 1000) + expiresSeconds, hubKey)
}

export async function signHubAuthAt(key: string, expiry: number, hubKey?: string): Promise<string> {
  const signature = await signHubData(key, hubAuthSignedData(expiry, hubKey))
  return `key.${getHubPublicKey(key)}.${signature}.${expiry}`
}

export function hubAuthSignedData(expiry: number, hubKey?: string): string {
  return hubKey ? `hub1:${hubKey}:${expiry}` : `${expiry}`
}

export async function hubAuthHeaders(key: string, expiresSeconds = 10, hubKey?: string): Promise<Record<'auth' | 'v', string>> {
  return {
    auth: await signHubAuth(key, expiresSeconds, hubKey),
    v: hubKey ? '1' : '0',
  }
}

/** Ed25519 signature of `data` with the key material, base64. */
export async function signHubData(key: string, data: string): Promise<string> {
  return hasNodeCrypto() ? signNode(key, data) : signWeb(key, data)
}

/** Device id: the first 16 bytes of SHA-256 over the device's SPKI DER, hex. */
export async function hubDeviceId(publicKey: string): Promise<string> {
  const hash = await sha256(decodeBase64(publicKey))
  return Array.from(hash.subarray(0, 16), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Safety code shown on both sides of a device approval: the same hash's first 4 bytes mod 10^6, as `ddd ddd`. */
export async function hubSafetyCode(publicKey: string): Promise<string> {
  const hash = await sha256(decodeBase64(publicKey))
  const value = (((hash[0]! << 24) >>> 0) + (hash[1]! << 16) + (hash[2]! << 8) + hash[3]!) % 1_000_000
  const digits = `${value}`.padStart(6, '0')
  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  if (hasNodeCrypto()) {
    const { createHash } = await import('crypto')
    return new Uint8Array(createHash('sha256').update(data).digest())
  }
  const subtle = getSubtleCrypto() as unknown as { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> }
  return new Uint8Array(await subtle.digest('SHA-256', data))
}

async function generateNodeKeyMaterial(): Promise<string> {
  const { generateKeyPairSync } = await import('crypto')
  const keys = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { format: 'der', type: 'pkcs8' },
    publicKeyEncoding: { format: 'der', type: 'spki' },
  })
  return encodeBase64(concatBytes(new Uint8Array(keys.privateKey), new Uint8Array(keys.publicKey)))
}

async function generateWebKeyMaterial(): Promise<string> {
  const subtle = getSubtleCrypto()
  const keyPair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as unknown as CryptoKeyPairLike
  const privateKey = new Uint8Array(await subtle.exportKey('pkcs8', keyPair.privateKey))
  const publicKey = new Uint8Array(await subtle.exportKey('spki', keyPair.publicKey))
  return encodeBase64(concatBytes(privateKey, publicKey))
}

async function signNode(key: string, data: string): Promise<string> {
  const { createPrivateKey, sign } = await import('crypto')
  const keyBuffer = decodeBase64(key)
  const privateKey = createPrivateKey({
    key: Buffer.from(keyBuffer.subarray(0, privateDerLength)),
    format: 'der',
    type: 'pkcs8',
  })
  return sign(null, Buffer.from(data), privateKey).toString('base64')
}

async function signWeb(key: string, data: string): Promise<string> {
  const keyBuffer = decodeBase64(key)
  const privateKeyBytes = keyBuffer.subarray(0, keyBuffer.length - publicDerLength)
  const subtle = getSubtleCrypto()
  const privateKey = await subtle.importKey('pkcs8', privateKeyBytes, { name: 'Ed25519' }, false, ['sign'])
  const signature = await subtle.sign({ name: 'Ed25519' }, privateKey, textEncoder.encode(data))
  return encodeBase64(new Uint8Array(signature))
}

function hasNodeCrypto(): boolean {
  const runtime = globalThis as SubtleRuntime
  return Boolean(runtime.Bun || runtime.process?.versions?.node)
}

function getSubtleCrypto() {
  const subtle = (globalThis as SubtleRuntime).crypto?.subtle
  if (!subtle) throw new Error('Web Crypto unavailable')
  return subtle
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const output = new Uint8Array(a.byteLength + b.byteLength)
  output.set(a, 0)
  output.set(b, a.byteLength)
  return output
}

export function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'))
  const atob = (globalThis as SubtleRuntime).atob
  if (!atob) throw new Error('Base64 decode unavailable')
  const decoded = atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
  return bytes
}

export function encodeBase64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64')
  const btoa = (globalThis as SubtleRuntime).btoa
  if (!btoa) throw new Error('Base64 encode unavailable')
  let output = ''
  for (const byte of value) output += String.fromCharCode(byte)
  return btoa(output)
}
