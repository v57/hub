import { HubError } from '../errors'
import type { HubAddress } from '../types/common'

export interface HubConnection {
  id: string
  name: string
  address: string
  createdAt?: string
  updatedAt?: string
}

export interface ConnectionStoreData {
  connections: HubConnection[]
  selectedId?: string
}

export interface ConnectionStore {
  add(address: HubAddress, name?: string): Promise<HubConnection>
  remove(nameOrId: string): Promise<boolean>
  select(nameOrId: string): Promise<HubConnection | undefined>
  selected(): Promise<HubConnection | undefined>
  get(nameOrId: string): Promise<HubConnection | undefined>
  list(): Promise<HubConnection[]>
  reset?(): Promise<void>
}

export abstract class BaseConnectionStore implements ConnectionStore {
  async add(address: HubAddress, name?: string): Promise<HubConnection> {
    const data = normalizeStoreData(await this.load())
    const normalized = normalizeHubAddress(address)
    const label = name?.trim() || normalized
    const now = new Date().toISOString()
    const existingIndex = data.connections.findIndex(connection => connection.name === label || connection.id === normalized)
    const previous = existingIndex >= 0 ? data.connections[existingIndex] : undefined
    const connection: HubConnection = {
      id: normalized,
      name: label,
      address: normalized,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }

    if (existingIndex >= 0) {
      data.connections[existingIndex] = connection
    } else {
      data.connections.push(connection)
    }
    data.selectedId = connection.id
    await this.save(data)
    return cloneConnection(connection)
  }

  async remove(nameOrId: string): Promise<boolean> {
    const data = normalizeStoreData(await this.load())
    const index = data.connections.findIndex(connection => matchesConnection(connection, nameOrId))
    if (index < 0) return false
    const [removed] = data.connections.splice(index, 1)
    if (removed && data.selectedId === removed.id) {
      data.selectedId = data.connections[index]?.id ?? data.connections[0]?.id
    }
    await this.save(data)
    return true
  }

  async select(nameOrId: string): Promise<HubConnection | undefined> {
    const data = normalizeStoreData(await this.load())
    const connection = data.connections.find(item => matchesConnection(item, nameOrId))
    if (!connection) return undefined
    data.selectedId = connection.id
    await this.save(data)
    return cloneConnection(connection)
  }

  async selected(): Promise<HubConnection | undefined> {
    const data = normalizeStoreData(await this.load())
    const connection = data.connections.find(item => item.id === data.selectedId)
    return connection ? cloneConnection(connection) : undefined
  }

  async get(nameOrId: string): Promise<HubConnection | undefined> {
    const data = normalizeStoreData(await this.load())
    const connection = data.connections.find(item => matchesConnection(item, nameOrId))
    return connection ? cloneConnection(connection) : undefined
  }

  async list(): Promise<HubConnection[]> {
    const data = normalizeStoreData(await this.load())
    return data.connections.map(cloneConnection)
  }

  async reset(): Promise<void> {
    await this.save({ connections: [] })
  }

  protected abstract load(): Promise<ConnectionStoreData>
  protected abstract save(data: ConnectionStoreData): Promise<void>
}

export function normalizeHubAddress(address: HubAddress): string {
  if (typeof address === 'number') return `ws://localhost:${address}`
  const value = address.trim()
  if (!value) throw new HubError('Hub address is required', { kind: 'validation' })
  if (/^\d+$/.test(value)) return `ws://localhost:${value}`
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`
  if (value.startsWith('ws://') || value.startsWith('wss://')) return value
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new HubError(`Unsupported Hub address scheme: ${value}`, { kind: 'validation' })
  }
  return `ws://${value}`
}

function normalizeStoreData(data: ConnectionStoreData): ConnectionStoreData {
  return {
    connections: Array.isArray(data.connections) ? data.connections.map(cloneConnection) : [],
    selectedId: data.selectedId,
  }
}

function cloneConnection(connection: HubConnection): HubConnection {
  return { ...connection }
}

function matchesConnection(connection: HubConnection, nameOrId: string): boolean {
  return connection.id === nameOrId || connection.name === nameOrId || connection.address === nameOrId
}
