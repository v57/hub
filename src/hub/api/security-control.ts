import type { HubRuntimeClient } from '../runtime'
import { normalizeHubInfo, type HubInfo } from '../client'
import type {
  HubGrant,
  HubGrantObject,
  HubGrantSubject,
  HubGroupMember,
  HubSecurityMode,
  HubSecurityModeUpdate,
  SecurityGroup,
  SecurityGroupInfo,
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

  /** A person group stands for one person's devices and keys. */
  async createGroup(name: string, options: { person?: boolean } = {}): Promise<void> {
    await this.client.send('hub/group/create', options.person ? { name, person: true } : name)
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

  /** Adds `key:<SPKI>` or `device:<id>` members; a member can be in any number of groups. */
  async addGroupMembers(group: string, members: HubGroupMember[]): Promise<void> {
    await this.addGroupUsers(group, members.map(formatGroupMember))
  }

  async removeGroupMembers(group: string, members: HubGroupMember[]): Promise<void> {
    await this.removeGroupUsers(group, members.map(formatGroupMember))
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

  /** Groups with their members, person flag and paths (`hub/groups`, owners first). Hubs before phase 5 lack it. */
  groups(): Promise<SecurityGroupInfo[]> {
    return firstValue(this.watchGroups())
  }

  watchGroups(): AsyncIterable<SecurityGroupInfo[]> {
    return mapValues(this.client.values('hub/groups'), normalizeGroupInfos)
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

  async info(): Promise<HubInfo | undefined> {
    return normalizeHubInfo(await this.client.send('hub/info'))
  }

  securityMode(): Promise<HubSecurityMode> {
    return firstValue(this.watchSecurityMode())
  }

  watchSecurityMode(): AsyncIterable<HubSecurityMode> {
    return mapValues(this.client.values('hub/security/mode'), normalizeSecurityMode)
  }

  async setSecurityMode(update: HubSecurityModeUpdate): Promise<void> {
    await this.client.send('hub/security/mode/set', update)
  }

  grants(): Promise<HubGrant[]> {
    return firstValue(this.watchGrants())
  }

  watchGrants(): AsyncIterable<HubGrant[]> {
    return mapValues(this.client.values('hub/grants'), normalizeGrants)
  }

  async addGrant(subject: HubGrantSubject, object: HubGrantObject): Promise<HubGrant | undefined> {
    return normalizeGrant(await this.client.send('hub/grant/add', { subject, object }))
  }

  async removeGrant(id: string): Promise<void> {
    await this.client.send('hub/grant/remove', { id })
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

export function normalizeGroupInfos(value: unknown): SecurityGroupInfo[] {
  const source = asRecord(value)
  const items = Array.isArray(value) ? value : Array.isArray(source?.groups) ? source.groups : []
  return items.flatMap((item): SecurityGroupInfo[] => {
    const record = asRecord(item)
    const id = optionalString(record?.id)
    if (!record || !id) return []
    return [{
      id,
      name: optionalString(record.name) ?? id,
      person: record.person === true,
      members: stringArray(record.members),
      paths: stringArray(record.paths),
    }]
  })
}

export function normalizeSecurityMode(value: unknown): HubSecurityMode {
  const source = asRecord(value)
  return {
    mode: source?.mode === 'default-deny' ? 'default-deny' : 'default-allow',
    requireV1: source?.requireV1 === true,
  }
}

export function normalizeGrants(value: unknown): HubGrant[] {
  const source = asRecord(value)
  const items = Array.isArray(value) ? value : Array.isArray(source?.grants) ? source.grants : []
  return items.map(normalizeGrant).filter((grant): grant is HubGrant => Boolean(grant))
}

export function normalizeGrant(value: unknown): HubGrant | undefined {
  const item = asRecord(value)
  const id = optionalString(item?.id)
  const subject = normalizeGrantSubject(item?.subject)
  const object = normalizeGrantObject(item?.object)
  if (!item || !id || !subject || !object) return undefined
  return { id, subject, object, by: optionalString(item.by), at: optionalString(item.at) }
}

function normalizeGrantSubject(value: unknown): HubGrantSubject | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  if (typeof item.key === 'string') return { key: item.key }
  if (typeof item.device === 'string') return { device: item.device }
  if (typeof item.group === 'string') return { group: item.group }
  if (item.everyone === true) return { everyone: true }
  return undefined
}

function normalizeGrantObject(value: unknown): HubGrantObject | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  if (typeof item.path === 'string') return { path: item.path }
  if (typeof item.prefix === 'string') return { prefix: item.prefix }
  if (typeof item.share === 'string') return { share: item.share }
  return undefined
}

/** `key:<SPKI>`, `device:<id>`, `group:<id>` or `everyone`. */
export function parseGrantSubject(text: string): HubGrantSubject {
  if (text === 'everyone') return { everyone: true }
  const [kind, value] = splitKind(text)
  if (kind === 'key' && value) return { key: value }
  if (kind === 'device' && value) return { device: value }
  if (kind === 'group' && value) return { group: value }
  throw new Error(`Grant subject must be key:<SPKI>, device:<id>, group:<id> or everyone, got ${text}`)
}

/** `path:<path>`, `prefix:<prefix>` or `share:<resource id>`. */
export function parseGrantObject(text: string): HubGrantObject {
  const [kind, value] = splitKind(text)
  if (kind === 'path' && value) return { path: value }
  if (kind === 'prefix' && value) return { prefix: value }
  if (kind === 'share' && value) return { share: value }
  throw new Error(`Grant object must be path:<path>, prefix:<prefix> or share:<id>, got ${text}`)
}

export function formatGrantSubject(subject: HubGrantSubject): string {
  if ('everyone' in subject) return 'everyone'
  if ('key' in subject) return `key:${subject.key}`
  if ('device' in subject) return `device:${subject.device}`
  return `group:${subject.group}`
}

export function formatGrantObject(object: HubGrantObject): string {
  if ('path' in object) return `path:${object.path}`
  if ('prefix' in object) return `prefix:${object.prefix}`
  return `share:${object.share}`
}

/** Group member strings are `key:<SPKI>` or `device:<id>`; plain SPKI strings in older stores mean `key:`. */
export function parseGroupMember(text: string): HubGroupMember {
  if (text.startsWith('device:')) return { kind: 'device', id: text.slice('device:'.length) }
  if (text.startsWith('key:')) return { kind: 'key', key: text.slice('key:'.length) }
  return { kind: 'key', key: text }
}

export function formatGroupMember(member: HubGroupMember): string {
  return member.kind === 'device' ? `device:${member.id}` : `key:${member.key}`
}

function splitKind(text: string): [string, string] {
  const index = text.indexOf(':')
  return index < 0 ? [text, ''] : [text.slice(0, index), text.slice(index + 1)]
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
    ...(item.person === true ? { person: true } : {}),
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
