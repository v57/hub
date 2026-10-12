import type { HubRuntimeClient } from '../runtime'
import type { HubContext, HubProfile } from '../types/common'
import type {
  HubMergeStatus,
  HubStatus,
  HubStatusBadges,
  HubUser,
  ServiceProvider,
} from '../types/runtime'

export type HubBalancerType = 'counter' | 'random' | 'first' | 'available'

export interface HubProxyRequest {
  name: string
  path: string
  body?: unknown
}

export class HubControl {
  constructor(private client: HubRuntimeClient) {}

  async api(): Promise<Set<string>> {
    const api = await this.client.send<string[]>('hub/api')
    return new Set(Array.isArray(api) ? api : [])
  }

  watchApi(): AsyncIterable<Set<string>> {
    return mapValues(this.client.values<string[]>('hub/api'), value => new Set(Array.isArray(value) ? value : []))
  }

  providers(path: string, context?: HubContext): AsyncIterable<ServiceProvider[]> {
    return this.client.values<ServiceProvider[]>('hub/api/services', path, context)
  }

  async updateProfile(profile: HubProfile): Promise<void> {
    await this.client.send('hub/profile/update', profile)
  }

  status(): Promise<HubStatus> {
    return firstValue(this.watchStatus())
  }

  watchStatus(): AsyncIterable<HubStatus> {
    return this.client.values<HubStatus>('hub/status')
  }

  badges(): Promise<HubStatusBadges> {
    return firstValue(this.watchBadges())
  }

  watchBadges(): AsyncIterable<HubStatusBadges> {
    return this.client.values<HubStatusBadges>('hub/status/badges')
  }

  publicKey(): Promise<string> {
    return this.client.send<string>('hub/key')
  }

  connections(): Promise<HubUser[]> {
    return firstValue(this.watchConnections())
  }

  watchConnections(): AsyncIterable<HubUser[]> {
    return this.client.values<HubUser[]>('hub/connections')
  }

  async mergeAdd(address: string): Promise<void> {
    await this.client.send('hub/merge/add', address)
  }

  async mergeRemove(address: string): Promise<void> {
    await this.client.send('hub/merge/remove', address)
  }

  mergeStatus(): Promise<HubMergeStatus[]> {
    return firstValue(this.watchMergeStatus())
  }

  watchMergeStatus(): AsyncIterable<HubMergeStatus[]> {
    return this.client.values<HubMergeStatus[]>('hub/merge/status')
  }

  async proxyAdd(address: string): Promise<void> {
    await this.client.send('hub/proxy/add', address)
  }

  async proxyRemove(address: string): Promise<void> {
    await this.client.send('hub/proxy/remove', address)
  }

  proxyJoin(): Promise<string> {
    return this.client.send<string>('hub/proxy/join')
  }

  proxyCall<T = unknown>(name: string, path: string, body?: unknown): Promise<T> {
    return this.client.send<T>('hub/proxy', proxyBody(name, path, body))
  }

  proxyStream<T = unknown>(name: string, path: string, body?: unknown): AsyncIterable<T> {
    return this.client.values<T>('hub/proxy', proxyBody(name, path, body))
  }

  async setBalancer(path: string, type: HubBalancerType): Promise<void> {
    await this.client.send('hub/balancer/set', { path, type })
  }

  async setBalancerLimit(limit: number): Promise<void> {
    await this.client.send('hub/balancer/limit', { limit })
  }
}

function proxyBody(name: string, path: string, body?: unknown): HubProxyRequest {
  return body === undefined ? { name, path } : { name, path, body }
}

async function firstValue<T>(values: AsyncIterable<T>): Promise<T> {
  for await (const value of values) return value
  throw new Error('Hub stream ended before first value')
}

async function* mapValues<T, U>(values: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  for await (const value of values) yield map(value)
}
