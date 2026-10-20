import type { HubRuntimeClient } from '../runtime'
import type {
  HubDevice,
  HubDeviceCapabilities,
  HubDeviceData,
  HubDeviceService,
  HubPendingDevice,
} from '../types/devices'

export class DeviceControl {
  constructor(private client: HubRuntimeClient) {}

  devices(): Promise<HubDevice[]> {
    return firstValue(this.watchDevices())
  }

  watchDevices(): AsyncIterable<HubDevice[]> {
    return mapValues(this.client.values('hub/devices'), normalizeDevices)
  }

  pending(): Promise<HubPendingDevice[]> {
    return firstValue(this.watchPending())
  }

  watchPending(): AsyncIterable<HubPendingDevice[]> {
    return mapValues(this.client.values('hub/devices/pending'), normalizePendingDevices)
  }

  async approve(id: string): Promise<HubDevice | undefined> {
    return normalizeDevice(await this.client.send('hub/device/approve', { id }))
  }

  async rename(id: string, name: string): Promise<HubDevice | undefined> {
    return normalizeDevice(await this.client.send('hub/device/rename', { id, name }))
  }

  /** Detaches the device and its connections; it can enrol again as pending. */
  async remove(id: string): Promise<void> {
    await this.client.send('hub/device/remove', { id })
  }

  /** Tombstones the device and revokes its service keys, except `keepServices`. */
  async revoke(id: string, keepServices: string[] = []): Promise<void> {
    await this.client.send('hub/device/revoke', keepServices.length > 0 ? { id, keepServices } : { id })
  }

  data(id: string): Promise<HubDeviceData> {
    return firstValue(this.watchData(id))
  }

  watchData(id: string): AsyncIterable<HubDeviceData> {
    return mapValues(this.client.values('hub/devices/data', { id }), normalizeDeviceData)
  }
}

export function normalizeDevices(value: unknown): HubDevice[] {
  const source = asRecord(value)
  const items = Array.isArray(value) ? value : Array.isArray(source?.devices) ? source.devices : []
  return items
    .map(normalizeDevice)
    .filter((device): device is HubDevice => Boolean(device))
    .sort(compareDevices)
}

export function normalizeDevice(value: unknown): HubDevice | undefined {
  const item = asRecord(value)
  const id = optionalString(item?.id)
  if (!item || !id) return undefined
  return {
    id,
    key: optionalString(item.key) ?? '',
    name: optionalString(item.name) || id,
    platform: optionalString(item.platform),
    os: optionalString(item.os),
    arch: optionalString(item.arch),
    parent: optionalString(item.parent),
    approved: item.approved === true,
    revoked: item.revoked === true,
    online: item.online === true,
    network: item.network === 'online' || item.network === 'offline' ? item.network : undefined,
    lastSeen: optionalString(item.lastSeen),
    capabilities: asRecord(item.capabilities) as HubDeviceCapabilities | undefined,
    services: (Array.isArray(item.services) ? item.services : [])
      .map(normalizeDeviceService)
      .filter((service): service is HubDeviceService => Boolean(service)),
  }
}

export function normalizePendingDevices(value: unknown): HubPendingDevice[] {
  const source = asRecord(value)
  const items = Array.isArray(value) ? value : Array.isArray(source?.devices) ? source.devices : []
  return items
    .map((item): HubPendingDevice | undefined => {
      const record = asRecord(item)
      const id = optionalString(record?.id)
      if (!record || !id) return undefined
      return {
        id,
        key: optionalString(record.key) ?? '',
        name: optionalString(record.name),
        platform: optionalString(record.platform),
        parent: optionalString(record.parent),
        safetyCode: optionalString(record.safetyCode) ?? '',
        firstSeen: optionalString(record.firstSeen),
      }
    })
    .filter((device): device is HubPendingDevice => Boolean(device))
    .sort((left, right) => (left.firstSeen ?? '').localeCompare(right.firstSeen ?? '') || left.id.localeCompare(right.id))
}

export function normalizeDeviceData(value: unknown): HubDeviceData {
  return (asRecord(value) as HubDeviceData | undefined) ?? {}
}

/** One-line summary of static capabilities for lists. */
export function deviceCapabilitySummary(capabilities: HubDeviceCapabilities | undefined): string {
  if (!capabilities) return '-'
  const parts: string[] = []
  const cpu = capabilities.cpu
  if (cpu?.model || cpu?.cores) parts.push([cpu.model, cpu.cores ? `${cpu.cores} cores` : undefined].filter(Boolean).join(' '))
  if (typeof capabilities.memory === 'number') parts.push(`${formatBytes(capabilities.memory)} RAM`)
  if (capabilities.gpu && capabilities.gpu !== cpu?.model) parts.push(capabilities.gpu)
  for (const disk of capabilities.disks ?? []) {
    parts.push(typeof disk.free === 'number' ? `${disk.name} ${formatBytes(disk.free)} free` : disk.name)
  }
  if (capabilities.power) parts.push(capabilities.power === 'ac' ? 'AC power' : 'battery')
  const tools = capabilities.tools
  if (tools) {
    const names = Object.entries(tools)
      .filter(([name, value]) => name !== 'simulators' && value !== false && value !== undefined && value !== null)
      .map(([name, value]) => (typeof value === 'string' ? `${name} ${value}` : name))
    if (tools.simulators?.length) names.push(`${tools.simulators.length} simulators`)
    if (names.length > 0) parts.push(names.join(', '))
  }
  if (capabilities.ssh) parts.push(`ssh :${capabilities.ssh.port}`)
  return parts.length > 0 ? parts.join(' / ') : '-'
}

/** One-line summary of live data: CPU, memory, battery and network. */
export function deviceDataSummary(data: HubDeviceData | undefined): string {
  if (!data) return 'No live data'
  const parts: string[] = []
  if (typeof data.cpu === 'number') parts.push(`CPU ${Math.round(data.cpu * 100)}%`)
  if (typeof data.memoryUsed === 'number') parts.push(`Memory ${formatBytes(data.memoryUsed)}`)
  if (typeof data.battery === 'number') parts.push(`Battery ${Math.round(data.battery * 100)}%${data.charging ? ' charging' : ''}`)
  else if (data.charging) parts.push('Charging')
  if (data.network) parts.push(`Network ${data.network}`)
  if (data.thermal) parts.push(`Thermal ${data.thermal}`)
  return parts.length > 0 ? parts.join(' / ') : 'No live data'
}

export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

function normalizeDeviceService(value: unknown): HubDeviceService | undefined {
  const item = asRecord(value)
  const key = optionalString(item?.key)
  if (!item || !key) return undefined
  return {
    key,
    instance: optionalString(item.instance) ?? '',
    name: optionalString(item.name),
    online: item.online === true,
    paths: Array.isArray(item.paths) ? item.paths.map(String) : [],
  }
}

function compareDevices(left: HubDevice, right: HubDevice): number {
  return Number(right.online) - Number(left.online) || left.name.localeCompare(right.name)
}

async function firstValue<T>(values: AsyncIterable<T>): Promise<T> {
  for await (const value of values) return value
  throw new Error('Device stream ended before first value')
}

async function* mapValues<T, U>(values: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  for await (const value of values) yield map(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
