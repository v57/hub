import { Channel } from 'channel/client'
import { hubTransport, makeClientNonce, verifyHubProof } from 'hub-service/hub-proof'
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
  /** Pinned hub keys; the client pins the key a hub proves in `hub/info` on its first connection. */
  hubKeys?: HubKeyStore
  /** A hub key known up front (from an invitation or config); pinned on first use. */
  hubKey?: string
  /** Allows plain `ws://` beyond loopback, the overlay and the LAN, for a private network; also `HUB_ALLOW_PLAINTEXT=1`. */
  allowPlaintext?: boolean
  /** Asks `hub/info` before any credentials are sent; by default over a connection of its own. */
  askHubInfo?: HubInfoAsker
  /** Sends a certificate from this device key; without it the client is a key-only client without a device. */
  device?: DeviceIdentity
}

export interface HubServiceOptions extends ServiceOptions {
  onConnect?(sender: HubSenderLike): Promise<void>
  /** Whether a refused connect can try once more with a new challenge. */
  mayRetry?(): boolean
}

export type HubConnectionHeaders = Record<string, string>
export type HubServiceFactory = (headers: () => Promise<HubConnectionHeaders>, options: HubServiceOptions) => HubServiceLike
export type HubInfoAsker = (address: string, nonce: string) => Promise<unknown>

/** `hub/info`, answered by every hub to anyone. */
export interface HubInfo {
  key: string
  protocol: number
  pro?: boolean
  mode?: 'default-allow' | 'default-deny'
}

/** Token lifetime for connect headers (the hub accepts up to 60 s). */
const authExpiresSeconds = 30

/** The address answered the upgrade without a WebSocket: it is not a Hub. */
class NotAHub extends Error {}

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
  private readonly allowsPlaintext: boolean
  private readonly askHubInfo: HubInfoAsker
  private lastConnectVersion?: string
  /** Set when the hub at the address can't prove the key pinned for it. */
  private keyMismatch = false
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
    this.allowsPlaintext = options.allowPlaintext ?? globalThis.Bun?.env?.HUB_ALLOW_PLAINTEXT === '1'
    this.askHubInfo = options.askHubInfo ?? askHubInfoAnonymously
    if (options.autoStart) this.start()
  }

  start(): this {
    if (this.hasStarted || this.plaintextRefusal()) return this
    this.hasStopped = false
    this.keyMismatch = false
    this.service = this.serviceFactory(() => this.connectHeaders(), {
      address: this.address,
      name: this.profile?.name,
      icon: typeof this.profile?.icon === 'string' ? undefined : this.profile?.icon,
      mayRetry: () => !this.keyMismatch && !this.hasStopped,
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

  /** Clears the pin; the next connect pins what the hub proves. */
  forgetHubKey(): Promise<boolean> {
    return this.hubKeys.forget(this.address)
  }

  /**
   * Headers for each connect, after the hub proves its key (protocol.md section 2): a `v: 1` token over the challenge
   * it gave, plus the `device` certificate in device mode. Waits while the hub doesn't answer with a proof, and sends
   * nothing to a hub that can't prove the pinned key.
   */
  async connectHeaders(): Promise<HubConnectionHeaders> {
    const pinned = await this.hubKey()
    let delay = 500
    while (!this.hasStopped) {
      const nonce = makeClientNonce()
      let answer: unknown
      try {
        answer = await this.askHubInfo(this.address, nonce)
      } catch (error) {
        if (error instanceof NotAHub) return this.stopConnecting()
      }
      if (await verifyHubProof(answer, nonce)) {
        const info = normalizeHubInfo(answer)!
        this.info = info
        if (pinned && info.key !== pinned) {
          this.keyMismatch = true
          return this.stopConnecting()
        }
        if (!pinned) await this.hubKeys.pin(this.address, info.key)
        const headers: HubConnectionHeaders = await this.keyStore.authHeaders(authExpiresSeconds, info.key, (answer as { challenge: string }).challenge)
        this.lastConnectVersion = headers.v
        if (this.device) headers.device = await this.device.certificate(await this.keyStore.publicKey())
        return headers
      }
      await new Promise(resolve => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, 5000)
    }
    return {}
  }

  /** Channel treats this as refused, and connects anonymously only until it sees that. */
  private stopConnecting(): HubConnectionHeaders {
    const ws = this.service?.sender?.ws
    if (ws) ws.isRunning = false
    return {}
  }

  private plaintextRefusal(): HubError | undefined {
    if (this.allowsPlaintext || hubTransport(this.address) !== 'refused') return undefined
    return new HubError(`${this.address} would carry this client's key unencrypted`, {
      kind: 'connection',
      hint: 'Use wss://, or HUB_ALLOW_PLAINTEXT=1 if this is a private network.',
    })
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
    this.hasStopped = true
    this.service?.sender?.stop?.()
    this.service?.sender?.ws?.stop?.()
    this.hasStarted = false
  }

  /**
   * The hub refused the connection: channel stops reconnecting after an upgrade without a WebSocket, so requests would
   * wait forever. That is how a refused token shows, and how this client stops when a hub can't prove the pinned key.
   */
  refusal(): HubError | undefined {
    const ws = this.service?.sender?.ws
    if (!this.hasStarted || this.hasStopped || !ws || ws.isRunning !== false) return undefined
    if (this.keyMismatch) {
      return new HubError(`${this.address} can't prove the pinned hub key`, {
        kind: 'auth',
        hint: 'The hub key changed or another server answers at this address. Nothing was sent to it. If that is expected, forget the pinned key (hubkey forget) and connect again.',
      })
    }
    const refused = this.lastConnectVersion === '1'
    return new HubError(`${this.address} refused the connection`, {
      kind: refused ? 'auth' : 'connection',
      hint: refused ? 'The hub refused the signed token: this key may not be allowed on it.' : 'The address answered without a Hub WebSocket.',
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
          // Channel fails what's waiting when it stops
          const refusal = this.refusal()
          if (refusal) refusal.path = path
          reject(refusal ?? error)
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
    const refusal = this.plaintextRefusal()
    if (refusal) throw refusal
    if (!this.service) throw new HubError('Hub service not started', { kind: 'connection' })
    return this.service
  }
}

/** `hub/info` on a connection of its own, without credentials. */
async function askHubInfoAnonymously(address: string, nonce: string): Promise<unknown> {
  const probe = new Channel().connect(address) as unknown as HubSenderLike & { stop(): void }
  try {
    return await probe.send('hub/info', { nonce }, { timeout: 5 } as never)
  } catch (error) {
    // Channel stops when the upgrade is answered without a WebSocket
    throw probe.ws?.isRunning === false ? new NotAHub() : error
  } finally {
    probe.stop()
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
    private readonly hubHeaders: () => Promise<HubConnectionHeaders>,
    private readonly hubOptions: HubServiceOptions,
  ) {
    super(async () => '', hubOptions)
  }

  override start(): this {
    const getProfile = () => this.profile
    const onConnect = this.hubOptions.onConnect
    let retried = false
    this.sender = this.channel.connect(this.address, {
      headers: this.hubHeaders,
      async onConnect(sender) {
        retried = false
        try {
          const profile = getProfile()
          if (profile) await sender.send('hub/profile/update', profile)
        } catch {}
        await sender.send('hub/service/update', { services: [], apps: [] })
        await onConnect?.(sender)
      },
    })
    // Channel stops on a refused upgrade. The challenge can be gone by then (the hub restarted, or its nonce store turned
    // over), so one refusal just reconnects with a new one, keeping what's waiting.
    const ws = this.sender!.ws as unknown as { isConnected: boolean; stop(): void }
    const stop = ws.stop.bind(ws)
    ws.stop = () => {
      if (ws.isConnected || retried || !this.hubOptions.mayRetry?.()) return stop()
      retried = true
    }
    return this
  }
}

const defaultServiceFactory: HubServiceFactory = (headers, options) => new HubClientService(headers, options)
