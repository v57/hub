import type { HubRuntimeClient } from '../runtime'
import type {
  SecurityGroup,
  SecurityGroupUpdate,
  SecurityGroupUsers,
  SecurityGroupUsersUpdate,
  SecurityPendingItem,
  SecurityPermissionNames,
  SecurityPermissionUpdate,
  SecurityWhitelistStatus,
  SecurityWhitelistUpdate,
} from '../types/security'

export class SecurityControl {
  constructor(private client: HubRuntimeClient) {}

  hostPending(): Promise<SecurityPendingItem[]> {
    return firstValue(this.watchHostPending())
  }

  watchHostPending(): AsyncIterable<SecurityPendingItem[]> {
    return mapValues(this.client.values('hub/host/pending'), normalizePendingPermissions)
  }

  hostAllowed(key: string): Promise<string[]> {
    return this.client.send<string[]>('hub/host/allowed', key)
  }

  async allowHost(key: string, paths: string[]): Promise<void> {
    await this.updateHost({ key, allow: paths })
  }

  async revokeHost(key: string, paths: string[]): Promise<void> {
    await this.updateHost({ key, revoke: paths })
  }

  async updateHost(update: SecurityPermissionUpdate): Promise<void> {
    await this.client.send('hub/host/update', update)
  }

  callPending(): Promise<SecurityPendingItem[]> {
    return firstValue(this.watchCallPending())
  }

  watchCallPending(): AsyncIterable<SecurityPendingItem[]> {
    return mapValues(this.client.values('hub/call/pending'), normalizePendingPermissions)
  }

  callAllowed(key: string): Promise<string[]> {
    return this.client.send<string[]>('hub/call/allowed', key)
  }

  async allowCall(key: string, paths: string[]): Promise<void> {
    await this.updateCall({ key, allow: paths })
  }

  async revokeCall(key: string, paths: string[]): Promise<void> {
    await this.updateCall({ key, revoke: paths })
  }

  async updateCall(update: SecurityPermissionUpdate): Promise<void> {
    await this.client.send('hub/call/update', update)
  }

  async createGroup(name: string): Promise<void> {
    await this.client.send('hub/group/create', name)
  }

  async renameGroup(group: string, name: string): Promise<void> {
    await this.client.send('hub/group/rename', { group, name })
  }

  async removeGroup(group: string): Promise<void> {
    await this.client.send('hub/group/remove', group)
  }

  async updateGroup(update: SecurityGroupUpdate): Promise<void> {
    await this.client.send('hub/group/update', update)
  }

  async addGroupPermissions(group: string, permissions: string[]): Promise<void> {
    await this.updateGroup({ group, add: permissions })
  }

  async removeGroupPermissions(group: string, permissions: string[]): Promise<void> {
    await this.updateGroup({ group, remove: permissions })
  }

  async setGroupPermissions(group: string, permissions: string[]): Promise<void> {
    await this.updateGroup({ group, set: permissions })
  }

  async updateGroupUsers(update: SecurityGroupUsersUpdate): Promise<void> {
    await this.client.send('hub/group/update/users', update)
  }

  async addGroupUsers(group: string, users: string[]): Promise<void> {
    await this.updateGroupUsers({ group, add: users })
  }

  async removeGroupUsers(group: string, users: string[]): Promise<void> {
    await this.updateGroupUsers({ group, remove: users })
  }

  groupList(): Promise<SecurityGroup[]> {
    return firstValue(this.watchGroupList())
  }

  watchGroupList(): AsyncIterable<SecurityGroup[]> {
    return mapValues(this.client.values('hub/group/list'), normalizeGroupList)
  }

  groupUsers(): Promise<SecurityGroupUsers> {
    return firstValue(this.watchGroupUsers())
  }

  watchGroupUsers(): AsyncIterable<SecurityGroupUsers> {
    return mapValues(this.client.values('hub/group/users'), normalizeStringArrayMap)
  }

  groupNames(): Promise<SecurityPermissionNames> {
    return firstValue(this.watchGroupNames())
  }

  watchGroupNames(): AsyncIterable<SecurityPermissionNames> {
    return mapValues(this.client.values('hub/group/names'), normalizePermissionNames)
  }

  whitelistStatus(): Promise<SecurityWhitelistStatus> {
    return firstValue(this.watchWhitelistStatus())
  }

  watchWhitelistStatus(): AsyncIterable<SecurityWhitelistStatus> {
    return mapValues(this.client.values('hub/whitelist/status'), normalizeWhitelistStatus)
  }

  async updateWhitelist(update: SecurityWhitelistUpdate): Promise<void> {
    await this.client.send('hub/whitelist', update)
  }

  async enableWhitelist(): Promise<void> {
    await this.updateWhitelist({ enabled: true })
  }

  async disableWhitelist(): Promise<void> {
    await this.updateWhitelist({ enabled: false })
  }

  async addWhitelistUsers(users: string[]): Promise<void> {
    await this.updateWhitelist({ add: users })
  }

  async removeWhitelistUsers(users: string[]): Promise<void> {
    await this.updateWhitelist({ remove: users })
  }

  async allowCurrentWhitelistUsers(): Promise<void> {
    await this.updateWhitelist({ allowsCurrent: true })
  }
}

export function normalizePendingPermissions(value: unknown): SecurityPendingItem[] {
  const source = asRecord(value)
  const entries = Array.isArray(value)
    ? value
    : Array.isArray(source?.list)
      ? source.list
      : source
        ? Object.entries(source).map(([id, pending]) => ({ id, pending }))
        : []

  return entries
    .map(normalizePendingItem)
    .filter((item): item is SecurityPendingItem => Boolean(item))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function normalizeGroupList(value: unknown): SecurityGroup[] {
  if (Array.isArray(value)) {
    return value.map(normalizeGroup).filter((group): group is SecurityGroup => Boolean(group)).sort(compareGroups)
  }
  const source = asRecord(value)
  if (Array.isArray(source?.groups)) return normalizeGroupList(source.groups)
  if (!source) return []
  return Object.entries(source)
    .map(([name, permissions]) => normalizeGroup({ name, permissions }))
    .filter((group): group is SecurityGroup => Boolean(group))
    .sort(compareGroups)
}

export function normalizePermissionNames(value: unknown): SecurityPermissionNames {
  const source = asRecord(value)
  if (!source) return {}
  const output: SecurityPermissionNames = {}
  for (const [key, raw] of Object.entries(source)) {
    if (!key) continue
    if (typeof raw === 'string') {
      output[key] = raw
    } else if (raw !== undefined && raw !== null) {
      output[key] = String(raw)
    }
  }
  return output
}

export function normalizeWhitelistStatus(value: unknown): SecurityWhitelistStatus {
  const source = asRecord(value)
  return {
    enabled: booleanValue(source?.enabled),
    users: stringArray(source?.users ?? source?.whitelist),
    raw: value,
  }
}

function normalizePendingItem(value: unknown): SecurityPendingItem | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const id = optionalString(item.id ?? item.key)
  if (!id) return undefined
  return {
    id,
    key: optionalString(item.key) ?? id,
    name: optionalString(item.name),
    pending: pendingPermissionArray(item.pending ?? item.paths ?? item.permissions),
    raw: value,
  }
}

function normalizeGroup(value: unknown): SecurityGroup | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const name = optionalString(item.name ?? item.id)
  if (!name) return undefined
  return {
    id: optionalString(item.id) ?? name,
    name,
    permissions: uniqueStrings(item.permissions),
    raw: value,
  }
}

function normalizeStringArrayMap(value: unknown): Record<string, string[]> {
  const source = asRecord(value)
  if (!source) return {}
  const output: Record<string, string[]> = {}
  for (const [key, raw] of Object.entries(source)) {
    output[key] = uniqueStrings(raw)
  }
  return output
}

function uniqueStrings(value: unknown): string[] {
  return Array.from(new Set(stringArray(value))).sort()
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean)
  if (typeof value === 'string') return [value]
  return []
}

function pendingPermissionArray(value: unknown): string[] {
  const nested = asRecord(value)
  return stringArray(nested?.pending ?? nested?.paths ?? nested?.permissions ?? value)
}

function compareGroups(left: SecurityGroup, right: SecurityGroup): number {
  return left.name.localeCompare(right.name)
}

async function firstValue<T>(values: AsyncIterable<T>): Promise<T> {
  for await (const value of values) return value
  throw new Error('Security stream ended before first value')
}

async function* mapValues<T, U>(values: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  for await (const value of values) yield map(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function booleanValue(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}
