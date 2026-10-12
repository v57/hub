import { MultiplatformService, type ServiceOptions } from 'hub-service/service'
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
}

export type HubServiceFactory = (sign: () => Promise<string>, options: ServiceOptions) => HubServiceLike

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
    stop?(): void
  }
}

export class HubClient {
  readonly address: string
  readonly keyStore: KeyStore
  readonly profile?: HubProfile
  private readonly serviceFactory: HubServiceFactory
  private service?: HubServiceLike
  private hasStarted = false
  private hasStopped = false

  constructor(options: HubClientOptions = {}) {
    this.address = normalizeHubAddress(options.address ?? defaultHubAddress())
    this.keyStore = options.keyStore ?? new MemoryKeyStore()
    this.profile = options.profile
    this.serviceFactory = options.serviceFactory ?? defaultServiceFactory
    if (options.autoStart) this.start()
  }

  start(): this {
    if (this.hasStarted) return this
    this.hasStopped = false
    this.service = this.serviceFactory(() => this.keyStore.sign(), {
      address: this.address,
      name: this.profile?.name,
      icon: typeof this.profile?.icon === 'string' ? undefined : this.profile?.icon,
    })
    if (this.profile && this.service) this.service.profile = this.profile
    this.service.start()
    this.hasStarted = true
    return this
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
      if (sender) return (await sender.send(path, body, { context })) as T
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
      if (sender) return sender.values(path, body, { context }) as AsyncIterable<T>
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

const defaultServiceFactory: HubServiceFactory = (sign, options) => new MultiplatformService(sign, options)
