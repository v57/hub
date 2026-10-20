export interface SecurityPendingItem {
  id: string
  key: string
  name?: string
  pending: string[]
  raw?: unknown
}

export interface SecurityPermissionUpdate {
  key: string
  allow?: string[]
  revoke?: string[]
}

export interface SecurityGroup {
  id: string
  name: string
  permissions: string[]
  /** A group that stands for a person (their devices and keys). */
  person?: boolean
  raw?: unknown
}

export type SecurityGroupUsers = Record<string, string[]>
export type SecurityPermissionNames = Record<string, string>

export interface SecurityGroupUpdate {
  group: string
  add?: string[]
  remove?: string[]
  set?: string[]
}

export interface SecurityGroupUsersUpdate {
  group: string
  add?: string[]
  remove?: string[]
}

export interface SecurityWhitelistStatus {
  enabled: boolean
  users: string[]
  raw?: unknown
}

export interface SecurityWhitelistUpdate {
  enabled?: boolean
  add?: string[]
  remove?: string[]
  allowsCurrent?: boolean
}

export type HubSecurityModeName = 'default-allow' | 'default-deny'

export interface HubSecurityMode {
  mode: HubSecurityModeName
  requireV1: boolean
}

export interface HubSecurityModeUpdate {
  mode?: HubSecurityModeName
  requireV1?: boolean
}

export type HubGrantSubject = { key: string } | { device: string } | { group: string } | { everyone: true }
export type HubGrantObject = { path: string } | { prefix: string } | { share: string }

export interface HubGrant {
  id: string
  subject: HubGrantSubject
  object: HubGrantObject
  by?: string
  at?: string
}

/** A group from `hub/groups`, with its members and the paths granted to it. */
export interface SecurityGroupInfo {
  id: string
  name: string
  person: boolean
  /** `key:<SPKI>` or `device:<id>`. */
  members: string[]
  paths: string[]
}

/** A group member string: `key:<SPKI>` or `device:<id>`; plain SPKI strings mean `key:`. */
export type HubGroupMember = { kind: 'key'; key: string } | { kind: 'device'; id: string }
