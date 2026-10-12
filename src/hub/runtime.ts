import { HubClient, type HubClientOptions } from './client'
import type { ConnectionStore } from './connections/connection-store'
import { HubError } from './errors'
import type { KeyStore } from './auth/key-store'
import type { HubAddress, HubContext, HubProfile } from './types/common'
import type { AppInterface } from './types/app-interface'
import type {
  AppHeader,
  HubMergeStatus,
  HubRuntimeWatchOptions,
  HubServiceStatus,
  HubSnapshot,
  HubStatus,
  HubStorageList,
  HubUser,
  HubWhitelistStatus,
  LauncherInfo,
  LauncherStatus,
  PendingPermission,
  ServiceProvider,
} from './types/runtime'
import { normalizeLauncherInfo, normalizeLauncherStatus } from './api/launcher-control'
import { normalizeStorageList } from './api/storage-control'
import { normalizeAppHeaders, normalizeAppInterface } from './api/app-control'

export interface HubRuntimeClient {
  connected: boolean
  send<T = unknown>(path: string, body?: unknown, context?: HubContext): Promise<T>
  values<T = unknown>(path: string, body?: unknown, context?: HubContext): AsyncIterable<T>
  require?(...paths: string[]): Promise<void>
  stop(): void
}

export interface HubRuntimeFromSelectedOptions {
  connections: ConnectionStore
  keyStore?: KeyStore
  profile?: HubProfile
  clientOptions?: Omit<HubClientOptions, 'address' | 'keyStore' | 'profile'>
}

export type HubRuntimeListener = (snapshot: HubSnapshot) => void

type StreamHandler = (value: unknown) => void | Promise<void>

interface ActiveStream {
  key: string
  path: string
  iterator: AsyncIterator<unknown>
}

const optionalStateStreams = [
  'hub/status',
  'hub/status/badges',
  'launcher/info',
  'launcher/status',
  'hub/connections',
  'hub/group/list',
  'hub/group/users',
  'hub/group/names',
  'hub/host/pending',
  'hub/call/pending',
  'hub/whitelist/status',
  'hub/merge/status',
] as const

export class HubRuntime {
  readonly client: HubRuntimeClient
  snapshot: HubSnapshot = createDefaultSnapshot()
  private streams = new Map<string, ActiveStream>()
  private autoAppStreamKeys = new Set<string>()
  private listeners = new Set<HubRuntimeListener>()
  private running = false

  constructor(client: HubRuntimeClient) {
    this.client = client
    this.snapshot.connected = client.connected
  }

  static async fromSelected(options: HubRuntimeFromSelectedOptions): Promise<HubRuntime> {
    const selected = await options.connections.selected()
    if (!selected) {
      throw new HubError('No selected Hub connection', {
        kind: 'validation',
        hint: 'Add and select a Hub connection before creating runtime.',
      })
    }
    const client = new HubClient({
      ...options.clientOptions,
      address: selected.address as HubAddress,
      keyStore: options.keyStore,
      profile: options.profile,
    })
    return new HubRuntime(client)
  }

  start(): this {
    if (this.running) return this
    this.running = true
    this.patch({ loading: true, connected: this.client.connected, connectionError: undefined })
    this.bindStream('hub/api', undefined, undefined, value => {
      const api = normalizeApi(value)
      this.patch({ api, loading: false, connected: this.client.connected })
      this.rebindForApi(api)
    })
    return this
  }

  subscribe(listener: HubRuntimeListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async require(...paths: string[]): Promise<void> {
    const missing = paths.filter(path => !this.snapshot.api.has(path))
    if (missing.length) {
      if (this.client.require) return this.client.require(...paths)
      throw new HubError(`Missing Hub API: ${missing.join(', ')}`, {
        kind: 'not-found',
        path: missing[0],
      })
    }
  }

  watchProviders(path: string, options: HubRuntimeWatchOptions = {}): void {
    if (!this.snapshot.api.has('hub/api/services')) {
      this.setServiceProviders(path, options.context, [])
      return
    }
    this.bindStream('hub/api/services', path, options.context, value => {
      this.setServiceProviders(path, options.context, normalizeServiceProviders(value))
    })
  }

  watchStorageList(path = '/', options: HubRuntimeWatchOptions = {}): void {
    if (!this.snapshot.api.has('s3/list')) {
      this.setStorageList(path, options.context, defaultStorageList())
      return
    }
    this.bindStream('s3/list', path, options.context, value => {
      this.setStorageList(path, options.context, normalizeStorageList(value, path))
    })
  }

  watchAppInterface(path: string, options: HubRuntimeWatchOptions = {}): void {
    if (!path) return
    this.bindAppInterface(path, options.context)
  }

  stop(): void {
    this.running = false
    for (const stream of this.streams.values()) {
      try {
        stream.iterator.return?.()
      } catch {}
    }
    this.streams.clear()
    this.client.stop()
    this.patch({ connected: false, loading: false })
  }

  private rebindForApi(api: Set<string>): void {
    for (const path of optionalStateStreams) {
      if (api.has(path)) {
        this.bindOptionalStateStream(path)
      } else {
        this.cancelStream(path)
        if (path === 'hub/status/badges') this.syncAppInterfaceStreams([])
      }
    }
  }

  private bindOptionalStateStream(path: (typeof optionalStateStreams)[number]): void {
    switch (path) {
      case 'hub/status':
        this.bindStream(path, undefined, undefined, value => this.patch({ status: normalizeHubStatus(value) }))
        break
      case 'hub/status/badges':
        this.bindStream(path, undefined, undefined, value => {
          const statusBadges = normalizeRecord(value)
          this.patch({ statusBadges })
          this.syncAppInterfaceStreams(normalizeAppHeaders(statusBadges.apps))
        })
        break
      case 'launcher/info':
        this.bindStream(path, undefined, undefined, value => this.patch({ launcherInfo: normalizeLauncherInfo(value) }))
        break
      case 'launcher/status':
        this.bindStream(path, undefined, undefined, value => this.patch({ launcherStatus: normalizeLauncherStatus(value) }))
        break
      case 'hub/connections':
        this.bindStream(path, undefined, undefined, value => this.patch({ users: normalizeUsers(value) }))
        break
      case 'hub/group/list':
        this.bindStream(path, undefined, undefined, value => this.patch({ groupList: normalizeStringArrayMap(value) }))
        break
      case 'hub/group/users':
        this.bindStream(path, undefined, undefined, value => this.patch({ groupUsers: normalizeStringArrayMap(value) }))
        break
      case 'hub/group/names':
        this.bindStream(path, undefined, undefined, value => this.patch({ groupNames: normalizeStringMap(value) }))
        break
      case 'hub/host/pending':
        this.bindStream(path, undefined, undefined, value => this.patch({ hostPending: normalizePending(value) }))
        break
      case 'hub/call/pending':
        this.bindStream(path, undefined, undefined, value => this.patch({ callPending: normalizePending(value) }))
        break
      case 'hub/whitelist/status':
        this.bindStream(path, undefined, undefined, value => this.patch({ whitelist: normalizeWhitelist(value) }))
        break
      case 'hub/merge/status':
        this.bindStream(path, undefined, undefined, value => this.patch({ mergeStatus: normalizeMergeStatus(value) }))
        break
    }
  }

  private bindStream(path: string, body: unknown, context: HubContext | undefined, handler: StreamHandler): void {
    const key = streamKey(path, body, context)
    if (this.streams.has(key)) return
    let iterator: AsyncIterator<unknown>
    try {
      iterator = this.client.values(path, body, context)[Symbol.asyncIterator]()
    } catch (error) {
      this.patch({ connectionError: `${HubError.from(error, { path }).message}` })
      return
    }
    const active: ActiveStream = { key, path, iterator }
    this.streams.set(key, active)
    void this.consumeStream(active, handler)
  }

  private async consumeStream(stream: ActiveStream, handler: StreamHandler): Promise<void> {
    try {
      while (this.running) {
        const next = await stream.iterator.next()
        if (next.done) break
        await handler(next.value)
      }
    } catch (error) {
      if (this.running) {
        this.patch({
          connectionError: HubError.from(error, { path: stream.path }).message,
          loading: false,
        })
      }
    } finally {
      this.streams.delete(stream.key)
    }
  }

  private cancelStream(path: string): void {
    for (const [key, stream] of this.streams) {
      if (stream.path !== path) continue
      try {
        stream.iterator.return?.()
      } catch {}
      this.streams.delete(key)
    }
  }

  private cancelStreamKey(key: string): void {
    const stream = this.streams.get(key)
    if (!stream) return
    try {
      stream.iterator.return?.()
    } catch {}
    this.streams.delete(key)
  }

  private setServiceProviders(path: string, context: HubContext | undefined, providers: ServiceProvider[]): void {
    const key = providerCacheKey(path, context)
    this.patch({ serviceProviders: { ...this.snapshot.serviceProviders, [key]: providers } })
  }

  private setStorageList(path: string, context: HubContext | undefined, list: HubStorageList): void {
    const key = providerCacheKey(path, context)
    this.patch({ storageLists: { ...this.snapshot.storageLists, [key]: list } })
  }

  private bindAppInterface(path: string, context?: HubContext): void {
    this.bindStream(path, undefined, context, value => this.setServiceInterface(path, context, normalizeAppInterface(value)))
  }

  private setServiceInterface(path: string, context: HubContext | undefined, appInterface: AppInterface): void {
    const key = providerCacheKey(path, context)
    this.patch({ serviceInterfaces: { ...this.snapshot.serviceInterfaces, [key]: appInterface } })
  }

  private syncAppInterfaceStreams(apps: Array<{ path: string }>): void {
    const nextKeys = new Set<string>()
    for (const app of apps) {
      if (!app.path) continue
      const key = streamKey(app.path, undefined, undefined)
      nextKeys.add(key)
      if (this.autoAppStreamKeys.has(key)) continue
      this.autoAppStreamKeys.add(key)
      this.bindAppInterface(app.path)
    }
    for (const key of [...this.autoAppStreamKeys]) {
      if (nextKeys.has(key)) continue
      this.autoAppStreamKeys.delete(key)
      this.cancelStreamKey(key)
      const path = streamPathFromKey(key)
      const cacheKey = providerCacheKey(path)
      const serviceInterfaces = { ...this.snapshot.serviceInterfaces }
      delete serviceInterfaces[cacheKey]
      this.patch({ serviceInterfaces })
    }
  }

  private patch(update: Partial<HubSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update }
    for (const listener of this.listeners) listener(this.snapshot)
  }
}

export function createDefaultSnapshot(): HubSnapshot {
  return {
    connected: false,
    loading: false,
    api: new Set(),
    status: defaultHubStatus(),
    statusBadges: {},
    launcherInfo: { apps: [] },
    launcherStatus: { apps: {} },
    users: [],
    groupList: {},
    groupUsers: {},
    groupNames: {},
    hostPending: [],
    callPending: [],
    whitelist: { enabled: false, users: [] },
    mergeStatus: [],
    storageLists: {},
    serviceProviders: {},
    serviceInterfaces: {},
  }
}

export function providerCacheKey(path: string, context?: HubContext): string {
  return `${path}::${context?.service ?? ''}`
}

function streamKey(path: string, body: unknown, context?: HubContext): string {
  const bodyKey = body === undefined ? '' : JSON.stringify(body)
  return `${path}::${context?.service ?? ''}::${bodyKey}`
}

function streamPathFromKey(key: string): string {
  return key.split('::')[0] ?? ''
}

function normalizeApi(value: unknown): Set<string> {
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === 'string'))
  if (value && typeof value === 'object') return new Set(Object.keys(value))
  return new Set()
}

function defaultHubStatus(): HubStatus {
  return { requests: 0, connections: 0, services: [], apps: [] }
}

function normalizeHubStatus(value: unknown): HubStatus {
  const item = asRecord(value)
  if (!item) return defaultHubStatus()
  return {
    requests: numberValue(item.requests),
    connections: numberValue(item.connections),
    services: arrayValues(item.services).map(normalizeServiceStatus),
    apps: arrayValues(item.apps).map(normalizeAppHeader).filter((app): app is AppHeader => Boolean(app)),
    raw: value,
  }
}

function normalizeServiceStatus(value: unknown): HubServiceStatus {
  const item = asRecord(value)
  return {
    name: stringValue(item?.name),
    services: numberValue(item?.services),
    requests: numberValue(item?.requests),
    balancer: optionalString(item?.balancer),
    raw: value,
  }
}

function normalizeAppHeader(value: unknown): AppHeader | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const name = optionalString(item.name)
  const path = optionalString(item.path)
  if (!name || !path) return undefined
  return {
    type: 'app',
    name,
    path,
    services: optionalNumber(item.services),
    raw: value,
  }
}

function normalizeUsers(value: unknown): HubUser[] {
  return arrayValues(value).map(normalizeUser).filter((user): user is HubUser => Boolean(user))
}

function normalizeUser(value: unknown): HubUser | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const id = optionalString(item.id ?? item.key)
  if (!id) return undefined
  return {
    id,
    key: optionalString(item.key),
    name: stringValue(item.name || id.slice(-8)),
    services: numberValue(item.services),
    apps: numberValue(item.apps),
    raw: value,
  }
}

function normalizePending(value: unknown): PendingPermission[] {
  return arrayValues(value).map(item => {
    const record = asRecord(item)
    return {
      key: stringValue(record?.key ?? record?.id),
      path: optionalString(record?.path),
      name: optionalString(record?.name),
      raw: item,
    }
  })
}

function normalizeWhitelist(value: unknown): HubWhitelistStatus {
  const item = asRecord(value)
  return {
    enabled: booleanValue(item?.enabled),
    users: arrayValues(item?.users).filter((entry): entry is string => typeof entry === 'string'),
    raw: value,
  }
}

function normalizeMergeStatus(value: unknown): HubMergeStatus[] {
  return arrayValues(value).map(item => {
    const record = asRecord(item)
    return {
      address: stringValue(record?.address),
      isConnected: booleanValue(record?.isConnected ?? record?.connected),
      error: optionalString(record?.error),
      raw: item,
    }
  })
}

function normalizeServiceProviders(value: unknown): ServiceProvider[] {
  return arrayValues(value).map(item => {
    const record = asRecord(item)
    return {
      id: stringValue(record?.id ?? record?.key),
      name: optionalString(record?.name),
      raw: item,
    }
  })
}

function defaultStorageList(): HubStorageList {
  return { count: 0, files: [], directories: [] }
}

function normalizeStringArrayMap(value: unknown): Record<string, string[]> {
  const item = asRecord(value)
  if (!item) return {}
  const output: Record<string, string[]> = {}
  for (const [key, raw] of Object.entries(item)) {
    output[key] = arrayValues(raw).filter((entry): entry is string => typeof entry === 'string')
  }
  return output
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const item = asRecord(value)
  if (!item) return {}
  const output: Record<string, string> = {}
  for (const [key, raw] of Object.entries(item)) {
    if (typeof raw === 'string') output[key] = raw
  }
  return output
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {}
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return record ? Object.values(record) : []
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}
