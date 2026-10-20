import type { ViewNode } from '../terminal'
import type { DeviceControl, HubBalancerType, HubDevice, HubDeviceData, HubPendingDevice, SecurityControl } from '../../hub'

export const clientRouteIds = [
  'home',
  'connect',
  'services',
  'help/install-hub',
  'help/install-s3',
  'launcher',
  'launcher/create-app',
  'launcher/edit-app',
  'launcher/store',
  'security/pending-list',
  'security/permission-groups',
  'security/user-connections',
  'security/lockdown',
  'devices',
  'devices/detail',
] as const

export type ClientRouteId = typeof clientRouteIds[number]

export interface ClientConnectionSummary {
  id: string
  name: string
  address: string
  connected?: boolean
  serviceCount?: number
  requestCount?: number
}

export type InstallHubTab = 'macOS / Linux' | 'Docker' | 'iOS / tvOS' | 'Windows'
export type ClientStorageTab = 'Local' | 'Cloud' | 'Connect'
export type ClientStorageTestStatus = 'idle' | 'ok' | 'failed'
export type ClientLauncherStatus = 'not-installed' | 'failed' | 'installed' | 'offline' | 'stopping' | 'running'
export type ClientCreateAppMode = 'Shell' | 'Bun'
export type ClientStoreFilter = 'All' | 'App' | 'Api' | 'Server'

export interface ClientServiceRow {
  id?: string
  name: string
  services: number
  requests: number
  balancer?: HubBalancerType | string
  running?: number
  pending?: number
  disabled?: number
  limit?: number
}

export interface ClientPendingPermission {
  key: string
  name?: string
  paths: string[]
}

export interface ClientStorageFileEntry {
  name: string
  kind: 'file' | 'directory'
  size?: number
  lastModified?: string
}

export interface ClientLauncherProcess {
  pid: number
  cpu?: number
  memory?: number
  started?: string
}

export interface ClientLauncherApp {
  id?: string
  name: string
  active: boolean
  restarts?: boolean
  updateAvailable?: boolean
  checkingForUpdates?: boolean
  updating?: boolean
  instances?: number
  targetInstances?: number
  processes?: ClientLauncherProcess[]
  started?: string
  settings?: {
    env?: Record<string, string>
    secrets?: Record<string, string>
  } | null
}

export interface ClientKeyValueRow {
  key: string
  value: string
}

export interface ClientStoreItem {
  id: string
  name: string
  shortDescription: string
  type: 'app' | 'api' | 'server'
  setup?: boolean
  installed?: boolean
}

export interface ClientPermissionGroup {
  id?: string
  name: string
  permissions: string[]
}

export interface ClientHubUser {
  id?: string
  name?: string
  key?: string
  group?: string
  services?: number
  apps?: number
}

/** Controls for the selected hub; pages that have them stream live data and send actions. */
export interface ClientLive {
  devices: DeviceControl
  security: SecurityControl
}

export interface ClientPageState {
  live?: ClientLive
  /** Redraws after an async action or stream update; set by the visible page's task. */
  refresh?: () => void
  connections: ClientConnectionSummary[]
  selectedConnectionId?: string
  loading?: boolean
  error?: string
  publicKey?: string
  copiedKey?: boolean
  draftConnectionAddress?: string
  draftConnectionName?: string
  connectionNotice?: string
  installHubTab?: InstallHubTab
  services?: ClientServiceRow[]
  selectedServiceId?: string
  serviceNotice?: string
  serviceBalancerRequests?: { path: string; type: HubBalancerType }[]
  storageTab?: ClientStorageTab
  storageOpen?: boolean
  storageCanRead?: boolean
  storageCanCreateLauncherApp?: boolean
  storageCanAllowPending?: boolean
  storagePendingPermission?: ClientPendingPermission
  storageAppInstalled?: boolean
  storageAppName?: string
  storageTestStatus?: ClientStorageTestStatus
  storageNotice?: string
  storageCloudStep?: number
  storagePath?: string
  storageFiles?: ClientStorageFileEntry[]
  s3BucketName?: string
  s3Region?: string
  s3Endpoint?: string
  s3ManualRegion?: string
  s3AccessKey?: string
  s3SecretKey?: string
  launcherStatus?: ClientLauncherStatus
  launcherConnected?: boolean
  launcherStatusText?: string
  launcherUpdateAvailable?: boolean
  launcherCheckingUpdates?: boolean
  launcherUpdating?: boolean
  launcherApps?: ClientLauncherApp[]
  selectedLauncherAppId?: string
  launcherNotice?: string
  createAppMode?: ClientCreateAppMode
  createAppName?: string
  createAppRestarts?: boolean
  createShellInstall?: string
  createShellUninstall?: string
  createShellDirectory?: string
  createShellRun?: string
  createBunRepo?: string
  editAppName?: string
  editEnvRows?: ClientKeyValueRow[]
  editSecretRows?: ClientKeyValueRow[]
  editNotice?: string
  storeFilter?: ClientStoreFilter
  storeUrl?: string
  storeDraftUrl?: string
  storeCustomUrlVisible?: boolean
  storeLoading?: boolean
  storeError?: string
  storeItems?: ClientStoreItem[]
  storeInstallingId?: string
  storeInstalledNames?: string[]
  hostPending?: ClientPendingPermission[]
  callPending?: ClientPendingPermission[]
  securityCanManageHost?: boolean
  securityCanManageGroups?: boolean
  securityNotice?: string
  permissionGroups?: ClientPermissionGroup[]
  permissionNames?: Record<string, string>
  addingGroup?: boolean
  editingGroupName?: string
  groupNameDraft?: string
  groupDraftPermissions?: string[]
  users?: ClientHubUser[]
  lockdownEnabled?: boolean
  trustedKeys?: string[]
  devices?: HubDevice[]
  pendingDevices?: HubPendingDevice[]
  selectedDeviceId?: string
  deviceData?: Record<string, HubDeviceData>
  deviceNotice?: string
  deviceNameDraft?: string
  deviceRevokeArmed?: boolean
  deviceKeepServices?: string[]
}

export interface ClientPageContext {
  route: ClientRouteId
  state: ClientPageState
  closePage(): void
}

export interface ClientPage {
  route: ClientRouteId
  title: string
  render(context: ClientPageContext): ViewNode
}

export function createClientPageState(state: Partial<ClientPageState> = {}): ClientPageState {
  return {
    connections: state.connections ?? [],
    selectedConnectionId: state.selectedConnectionId,
    loading: state.loading ?? false,
    error: state.error,
    publicKey: state.publicKey,
    copiedKey: state.copiedKey ?? false,
    draftConnectionAddress: state.draftConnectionAddress ?? '',
    draftConnectionName: state.draftConnectionName ?? '',
    connectionNotice: state.connectionNotice,
    installHubTab: state.installHubTab ?? 'macOS / Linux',
    services: state.services ?? [],
    selectedServiceId: state.selectedServiceId,
    serviceNotice: state.serviceNotice,
    serviceBalancerRequests: state.serviceBalancerRequests ?? [],
    storageTab: state.storageTab ?? 'Local',
    storageOpen: state.storageOpen ?? false,
    storageCanRead: state.storageCanRead ?? false,
    storageCanCreateLauncherApp: state.storageCanCreateLauncherApp ?? false,
    storageCanAllowPending: state.storageCanAllowPending ?? false,
    storagePendingPermission: state.storagePendingPermission,
    storageAppInstalled: state.storageAppInstalled ?? false,
    storageAppName: state.storageAppName ?? 'S3 Storage',
    storageTestStatus: state.storageTestStatus ?? 'idle',
    storageNotice: state.storageNotice,
    storageCloudStep: state.storageCloudStep ?? 0,
    storagePath: state.storagePath ?? '~/Hub/Files',
    storageFiles: state.storageFiles ?? [],
    s3BucketName: state.s3BucketName ?? '',
    s3Region: state.s3Region ?? 'ap-northeast-1',
    s3Endpoint: state.s3Endpoint ?? '',
    s3ManualRegion: state.s3ManualRegion ?? '',
    s3AccessKey: state.s3AccessKey ?? '',
    s3SecretKey: state.s3SecretKey ?? '',
    launcherStatus: state.launcherStatus ?? 'offline',
    launcherConnected: state.launcherConnected ?? false,
    launcherStatusText: state.launcherStatusText,
    launcherUpdateAvailable: state.launcherUpdateAvailable ?? false,
    launcherCheckingUpdates: state.launcherCheckingUpdates ?? false,
    launcherUpdating: state.launcherUpdating ?? false,
    launcherApps: state.launcherApps ?? [],
    selectedLauncherAppId: state.selectedLauncherAppId,
    launcherNotice: state.launcherNotice,
    createAppMode: state.createAppMode ?? 'Shell',
    createAppName: state.createAppName ?? '',
    createAppRestarts: state.createAppRestarts ?? true,
    createShellInstall: state.createShellInstall ?? '',
    createShellUninstall: state.createShellUninstall ?? '',
    createShellDirectory: state.createShellDirectory ?? '',
    createShellRun: state.createShellRun ?? '',
    createBunRepo: state.createBunRepo ?? '',
    editAppName: state.editAppName,
    editEnvRows: state.editEnvRows,
    editSecretRows: state.editSecretRows,
    editNotice: state.editNotice,
    storeFilter: state.storeFilter ?? 'All',
    storeUrl: state.storeUrl ?? 'https://raw.githubusercontent.com/v57/hub-store/refs/heads/main/apps.json',
    storeDraftUrl: state.storeDraftUrl ?? '',
    storeCustomUrlVisible: state.storeCustomUrlVisible ?? false,
    storeLoading: state.storeLoading ?? false,
    storeError: state.storeError,
    storeItems: state.storeItems ?? [],
    storeInstallingId: state.storeInstallingId,
    storeInstalledNames: state.storeInstalledNames ?? [],
    hostPending: state.hostPending ?? [],
    callPending: state.callPending ?? [],
    securityCanManageHost: state.securityCanManageHost ?? false,
    securityCanManageGroups: state.securityCanManageGroups ?? false,
    securityNotice: state.securityNotice,
    permissionGroups: state.permissionGroups ?? [],
    permissionNames: state.permissionNames ?? {},
    addingGroup: state.addingGroup ?? false,
    editingGroupName: state.editingGroupName,
    groupNameDraft: state.groupNameDraft ?? '',
    groupDraftPermissions: state.groupDraftPermissions ?? [],
    users: state.users ?? [],
    lockdownEnabled: state.lockdownEnabled ?? false,
    trustedKeys: state.trustedKeys ?? [],
    live: state.live,
    refresh: state.refresh,
    devices: state.devices ?? [],
    pendingDevices: state.pendingDevices ?? [],
    selectedDeviceId: state.selectedDeviceId,
    deviceData: state.deviceData ?? {},
    deviceNotice: state.deviceNotice,
    deviceNameDraft: state.deviceNameDraft ?? '',
    deviceRevokeArmed: state.deviceRevokeArmed ?? false,
    deviceKeepServices: state.deviceKeepServices ?? [],
  }
}
