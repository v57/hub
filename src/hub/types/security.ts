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
