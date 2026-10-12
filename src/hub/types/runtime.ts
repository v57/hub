import type { HubContext } from './common'
import type { AppInterface } from './app-interface'
import type { LauncherInfo, LauncherStatus } from './launcher'
import type { HubStorageFile, HubStorageList } from './storage'

export type { LauncherInfo, LauncherStatus } from './launcher'
export type { HubStorageFile, HubStorageList } from './storage'

export interface HubSnapshot {
  connected: boolean
  loading: boolean
  api: Set<string>
  status: HubStatus
  statusBadges: HubStatusBadges
  launcherInfo: LauncherInfo
  launcherStatus: LauncherStatus
  users: HubUser[]
  groupList: Record<string, string[]>
  groupUsers: Record<string, string[]>
  groupNames: Record<string, string>
  hostPending: PendingPermission[]
  callPending: PendingPermission[]
  whitelist: HubWhitelistStatus
  mergeStatus: HubMergeStatus[]
  storageLists: Record<string, HubStorageList>
  serviceProviders: Record<string, ServiceProvider[]>
  serviceInterfaces: Record<string, AppInterface>
  publicKey?: string
  connectionError?: string
}

export interface HubStatus {
  requests: number
  connections: number
  services: HubServiceStatus[]
  apps: AppHeader[]
  raw?: unknown
}

export interface HubServiceStatus {
  name: string
  services: number
  requests: number
  balancer?: string
  raw?: unknown
}

export type HubStatusService = HubServiceStatus
export type HubStatusBadges = Record<string, unknown>

export interface AppHeader {
  id?: string
  type: 'app'
  name: string
  path: string
  services?: number
  isOnline?: boolean
  raw?: unknown
}

export interface HubUser {
  id: string
  key?: string
  name: string
  services: number
  apps: number
  raw?: unknown
}

export interface PendingPermission {
  key: string
  path?: string
  name?: string
  raw?: unknown
}

export interface HubWhitelistStatus {
  enabled: boolean
  users: string[]
  raw?: unknown
}

export interface HubMergeStatus {
  address: string
  isConnected: boolean
  error?: string
  raw?: unknown
}

export interface ServiceProvider {
  id: string
  name?: string
  raw?: unknown
}

export interface HubRuntimeWatchOptions {
  context?: HubContext
}
