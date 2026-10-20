import { chmod, link, mkdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir, hostname } from 'node:os'
import { generateHubKeyMaterial, getHubPublicKey, signHubData } from './key-material'

export const defaultCertificateLifetime = 7 * 24 * 60 * 60
const certificateRenewWindow = 24 * 60 * 60

/** Fields of a service certificate (`device` header), in wire order. */
export interface ServiceCertificate {
  v: 1
  device: string
  service: string
  instance: string
  deviceName?: string
  platform?: string
  parent?: string
  hub?: string
  iat: number
  exp: number
}

export interface ServiceCertificateOptions {
  instance: string
  deviceName?: string
  platform?: string
  parent?: string
  /** Unix seconds; defaults to now. */
  now?: number
  lifetime?: number
}

/** Signs `<base64url(JSON)>.<signature>` for `service` with the device key material. */
export async function createServiceCertificate(
  deviceKey: string,
  service: string,
  options: ServiceCertificateOptions,
): Promise<string> {
  const iat = options.now ?? Math.floor(Date.now() / 1000)
  const certificate: ServiceCertificate = {
    v: 1,
    device: getHubPublicKey(deviceKey),
    service,
    instance: options.instance,
    deviceName: options.deviceName,
    platform: options.platform,
    parent: options.parent,
    iat,
    exp: iat + (options.lifetime ?? defaultCertificateLifetime),
  }
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(certificate)))
  return `${payload}.${await signHubData(deviceKey, payload)}`
}

export function decodeServiceCertificate(header: string): ServiceCertificate | undefined {
  const [payload] = header.split('.')
  if (!payload) return undefined
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ServiceCertificate
  } catch {
    return undefined
  }
}

/** `HUB_DEVICE_KEY`, `/var/lib/hub/device.key` for root on Linux, otherwise `~/.hub/device.key`. */
export function resolveDeviceKeyPath(env: Record<string, string | undefined> = process.env): string {
  if (env.HUB_DEVICE_KEY) return env.HUB_DEVICE_KEY
  if (process.platform === 'linux' && process.getuid?.() === 0) return '/var/lib/hub/device.key'
  return join(homedir(), '.hub', 'device.key')
}

export function devicePlatform(platform: string = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'macos'
    case 'linux':
      return 'linux'
    case 'win32':
      return 'windows'
    case 'android':
      return 'android'
    default:
      return 'other'
  }
}

/** The computer name on macOS (`scutil --get ComputerName`), otherwise the hostname. */
export function suggestedDeviceName(): string {
  if (process.platform === 'darwin') {
    try {
      const result = Bun.spawnSync(['scutil', '--get', 'ComputerName'])
      const name = result.stdout.toString().trim()
      if (result.exitCode === 0 && name) return truncateUtf8(name, 64)
    } catch {}
  }
  return truncateUtf8(hostname().replace(/\.local$/, ''), 64)
}

function truncateUtf8(value: string, bytes: number): string {
  let output = ''
  for (const char of value) {
    if (Buffer.byteLength(output + char) > bytes) break
    output += char
  }
  return output
}

export interface DeviceIdentityOptions {
  path?: string
  instance?: string
  deviceName?: string
  parent?: string
}

/**
 * The device key shared by every Hub process of this OS user. The CLI only uses it with `--device`; it creates the key
 * file (atomically, mode 0600) when it doesn't exist yet, as any SDK would.
 */
export class DeviceIdentity {
  readonly path: string
  readonly instance: string
  private readonly deviceName: string
  private readonly parent?: string
  private key?: string
  private cached?: { service: string; header: string; exp: number }

  constructor(options: DeviceIdentityOptions = {}) {
    this.path = options.path ?? resolveDeviceKeyPath()
    this.instance = options.instance ?? 'hub-cli'
    this.deviceName = options.deviceName ?? suggestedDeviceName()
    this.parent = options.parent
  }

  async publicKey(): Promise<string> {
    return getHubPublicKey(await this.loadKey())
  }

  /** A certificate for `service`, reused until it has less than a day left. */
  async certificate(service: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
    const cached = this.cached
    if (cached && cached.service === service && cached.exp - now > certificateRenewWindow) return cached.header
    const header = await createServiceCertificate(await this.loadKey(), service, {
      instance: this.instance,
      deviceName: this.deviceName,
      platform: devicePlatform(),
      parent: this.parent,
      now,
    })
    this.cached = { service, header, exp: now + defaultCertificateLifetime }
    return header
  }

  private async loadKey(): Promise<string> {
    if (this.key) return this.key
    const file = Bun.file(this.path)
    if (await file.exists()) {
      this.key = (await file.text()).trim()
      return this.key
    }
    const key = await generateHubKeyMaterial()
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.tmp`
    await Bun.write(temp, key)
    await chmod(temp, 0o600)
    try {
      // link refuses to replace a key another process created meanwhile, unlike rename.
      await link(temp, this.path)
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
    } finally {
      await unlink(temp).catch(() => {})
    }
    this.key = (await Bun.file(this.path).text()).trim()
    return this.key
  }
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}
