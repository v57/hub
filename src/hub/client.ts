import { MultiplatformService, type ServiceOptions } from 'hub-service/service'
import type { DeviceIdentity } from './auth/device-key'
import { MemoryHubKeyStore, type HubKeyStore } from './auth/hub-key-store'
import { MemoryKeyStore } from './auth/memory-key-store'
import type { KeyStore } from './auth/key-store'
import { normalizeHubAddress } from './connections/connection-store'
import { HubError } from './errors'
import type { HubAddress, HubConnectionStatus, HubContext, HubProfile } from './types/common'

export interface HubClientOptions {
  address?: HubAddress
  keyStore?: KeyStore
  profile?: HubProfile
  serviceFactory?: HubServiceFactory
  autoStart?: boolean
  /** Pinned hub keys; the client learns and pins the key from `hub/info` on its first connection. */
  hubKeys?: HubKeyStore
  /** A hub key known up front (from an invitation or config); pinned on first use. */
  hubKey?: string
  /** Sends a certificate from this device key; without it the client is a key-only client without a device. */
  device?: DeviceIdentity
}

export interface HubServiceOptions extends ServiceOptions {
  onConnect?(sender: HubSenderLike): Promise<void>
}

export type HubConnectionHeaders = Record<string, string>
export type HubServiceFactory = (headers: () => Promise<HubConnectionHeaders>, options: HubServiceOptions) => HubServiceLike

/** `hub/info`, answered by hubs that speak protocol 1. */
export interface HubInfo {
  key: string
  protocol: number
  pro?: boolean
  mode?: 'default-allow' | 'default-deny'
}

/** Token lifetime for connect headers (the hub accepts up to 300 s). */
const authExpiresSeconds = 60

export interface HubServiceLike {
  address?: HubAddress
  profile?: HubProfile
  sender?: HubSenderLike
  start(): unknown
  send?(path: string, body?: unknown, context?: HubContext): Promise<unknown>
  values?(path: string, body?: unknown, context?: HubContext): AsyncIterable<unknown>
}

export interface HubSenderLike {
  send(path: string, body?: unknown, options?: { context?: HubContext }): Promise<unknown>
  values(path: string, body?: unknown, options?: { context?: HubContext }): AsyncIterable<unknown>
  stop?(): void
  ws?: {
    isConnected?: boolean
    /** Channel sets it to false when the server answers the upgrade without a WebSocket (refused, or not a hub). */
    isRunning?: boolean
    stop?(): void
  }
}

export class HubClient {
  readonly address: string
  readonly keyStore: KeyStore
  readonly hubKeys: HubKeyStore
  readonly device?: DeviceIdentity
  readonly profile?: HubProfile
  /** The latest `hub/info` answer, if the hub sent one. */
  info?: HubInfo
  private readonly serviceFactory: HubServiceFactory
  private readonly suppliedHubKey?: string
  private lastConnectVersion?: string
  private service?: HubServiceLike
  private hasStarted = false
  private hasStopped = false

  constructor(options: HubClientOptions = {}) {
    this.address = normalizeHubAddress(options.address ?? defaultHubAddress())
    this.keyStore = options.keyStore ?? new MemoryKeyStore()
    this.hubKeys = options.hubKeys ?? new MemoryHubKeyStore()
    this.suppliedHubKey = options.hubKey
    this.device = options.device
    this.profile = options.profile
    this.serviceFactory = options.serviceFactory ?? defaultServiceFactory
    if (options.autoStart) this.start()
  }

  start(): this {
    if (this.hasStarted) return this
    this.hasStopped = false
    this.service = this.serviceFactory(() => this.connectHeaders(), {
      address: this.address,
      name: this.profile?.name,
      icon: typeof this.profile?.icon === 'string' ? undefined : this.profile?.icon,
      onConnect: sender => this.learnHubKey(sender),
    })
    if (this.profile && this.service) this.service.profile = this.profile
    this.service.start()
    this.hasStarted = true
    return this
  }

  /** The pinned key of this hub; set once the client signs `v: 1` tokens for it. */
  async hubKey(): Promise<string | undefined> {
    const pinned = await this.hubKeys.get(this.address)
    if (pinned) return pinned
    if (!this.suppliedHubKey) return undefined
    await this.hubKeys.pin(this.address, this.suppliedHubKey)
    return this.suppliedHubKey
  }

  /** Clears the pin; the next connect uses `v: 0` and learns the key again. */
  forgetHubKey(): Promise<boolean> {
    return this.hubKeys.forget(this.address)
  }

  /**
   * Headers for each connect: a `v: 1` token bound to the pinned hub key, or `v: 0` until one is known, plus the
   * `device` certificate in device mode. A refused `v: 1` token is not retried as `v: 0`.
   */
  async connectHeaders(): Promise<HubConnectionHeaders> {
    const headers: HubConnectionHeaders = await this.keyStore.authHeaders(authExpiresSeconds, await this.hubKey())
    this.lastConnectVersion = headers.v
    if (this.device) headers.device = await this.device.certificate(await this.keyStore.publicKey())
    return headers
  }

  private async learnHubKey(sender: HubSenderLike): Promise<void> {
    try {
      const info = normalizeHubInfo(await sender.send('hub/info'))
      if (!info) return
      this.info = info
      if (!(await this.hubKeys.get(this.address))) await this.hubKeys.pin(this.address, info.key)
    } catch {
      // Hubs without `hub/info` (hub-lite, older hub-pro) keep v0.
    }
  }

  get connected(): boolean {
    return Boolean(this.service?.sender?.ws?.isConnected)
  }

  get status(): HubConnectionStatus {
    if (this.hasStopped) return 'stopped'
    if (!this.hasStarted) return 'idle'
    return this.connected ? 'connected' : 'connecting'
  }

  async send<T = unknown>(path: string, body?: unknown, context?: HubContext): Promise<T> {
    try {
      const service = this.ensureStarted()
      const sender = service.sender
      if (sender) return (await this.untilRefused(sender.send(path, body, { context }), path)) as T
      if (service.send) return (await service.send(path, body, context)) as T
      throw new HubError('Hub service sender unavailable', { kind: 'connection', path })
    } catch (error) {
      throw HubError.from(error, { path })
    }
  }

  values<T = unknown>(path: string, body?: unknown, context?: HubContext): AsyncIterable<T> {
    try {
      const service = this.ensureStarted()
      const sender = service.sender
      if (sender) return this.valuesUntilRefused(sender.values(path, body, { context }) as AsyncIterable<T>, path)
      if (service.values) return service.values(path, body, context) as AsyncIterable<T>
      throw new HubError('Hub service sender unavailable', { kind: 'connection', path })
    } catch (error) {
      throw HubError.from(error, { path })
    }
  }

  async api(): Promise<Set<string>> {
    const api = await this.send<string[]>('hub/api')
    return new Set(api)
  }

  async require(...paths: string[]): Promise<void> {
    const api = await this.api()
    const missing = paths.filter(path => !api.has(path))
    if (missing.length) {
      throw new HubError(`Missing Hub API: ${missing.join(', ')}`, {
        kind: 'not-found',
        path: missing[0],
      })
    }
  }

  stop(): void {
    this.service?.sender?.stop?.()
    this.service?.sender?.ws?.stop?.()
    this.hasStopped = true
    this.hasStarted = false
  }

  /**
   * The hub refused the connection: channel stops reconnecting after an upgrade without a WebSocket, so requests would
   * wait forever. With a pinned hub key that is how a refused `v: 1` token shows.
   */
  refusal(): HubError | undefined {
    const ws = this.service?.sender?.ws
    if (!this.hasStarted || this.hasStopped || !ws || ws.isRunning !== false) return undefined
    const pinned = this.lastConnectVersion === '1'
    return new HubError(`${this.address} refused the connection`, {
      kind: pinned ? 'auth' : 'connection',
      hint: pinned
        ? 'The hub refused the token bound to its pinned key: the hub key changed or another server answers at this address. If that is expected, forget the pinned key (hubkey forget) and connect again.'
        : 'The address answered without a Hub WebSocket.',
    })
  }

  private untilRefused<T>(promise: Promise<T>, path: string): Promise<T> {
    if (this.connected) return promise
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const refusal = this.refusal()
        if (refusal) {
          refusal.path = path
          reject(refusal)
        }
        if (refusal || this.connected) clearInterval(timer)
      }, 100)
      promise.then(
        value => {
          clearInterval(timer)
          resolve(value)
        },
        error => {
          clearInterval(timer)
          reject(error)
        },
      )
    })
  }

  private valuesUntilRefused<T>(values: AsyncIterable<T>, path: string): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: () => {
        const iterator = values[Symbol.asyncIterator]()
        return {
          next: () => this.untilRefused(iterator.next(), path),
          return: value => iterator.return?.(value) ?? Promise.resolve({ done: true as const, value }),
        }
      },
    }
  }

  private ensureStarted(): HubServiceLike {
    if (!this.hasStarted) this.start()
    if (!this.service) throw new HubError('Hub service not started', { kind: 'connection' })
    return this.service
  }
}

function defaultHubAddress(): HubAddress {
  const runtime = globalThis as typeof globalThis & { Bun?: { env?: Record<string, string | undefined> } }
  return runtime.Bun?.env?.HUB ?? 1997
}

export function normalizeHubInfo(value: unknown): HubInfo | undefined {
  if (!value || typeof value !== 'object') return undefined
  const info = value as Record<string, unknown>
  if (typeof info.key !== 'string' || !info.key) return undefined
  return {
    key: info.key,
    protocol: typeof info.protocol === 'number' ? info.protocol : 1,
    pro: typeof info.pro === 'boolean' ? info.pro : undefined,
    mode: info.mode === 'default-deny' || info.mode === 'default-allow' ? info.mode : undefined,
  }
}

/** A key-only client connection: `MultiplatformService` with our own headers (it hard-codes `v: 0`). */
class HubClientService extends MultiplatformService {
  constructor(
    private readonly headers: () => Promise<HubConnectionHeaders>,
    private readonly options: HubServiceOptions,
  ) {
    super(async () => '', options)
  }

  override start(): this {
    const getProfile = () => this.profile
    const onConnect = this.options.onConnect
    this.sender = this.channel.connect(this.address, {
      headers: this.headers,
      async onConnect(sender) {
        try {
          const profile = getProfile()
          if (profile) await sender.send('hub/profile/update', profile)
        } catch {}
        await sender.send('hub/service/update', { services: [], apps: [] })
        await onConnect?.(sender)
      },
    })
    return this
  }
}

const defaultServiceFactory: HubServiceFactory = (headers, options) => new HubClientService(headers, options)
