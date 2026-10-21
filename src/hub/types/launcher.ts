export interface LauncherSettings {
  env?: Record<string, string>
  secrets?: Record<string, string>
}

export interface LauncherTerminalSettings {
  cols?: number
  rows?: number
  name?: string
}

export interface LauncherBunSetup {
  type: 'bun'
  repo: string
  commit?: string | null
  command?: string | null
}

export interface LauncherShellSetup {
  type: 'sh'
  directory?: string | null
  install?: string[] | null
  uninstall?: string[] | null
  run: string
}

export type LauncherSetup = LauncherBunSetup | LauncherShellSetup

export interface LauncherCreate {
  name: string
  active: boolean
  restarts: boolean
  setup: LauncherSetup
  settings?: LauncherSettings | null
}

export interface LauncherAppInfo {
  id: string
  name: string
  active: boolean
  restarts: boolean
  updateAvailable: boolean
  instances: number
  settings?: LauncherSettings | null
  terminal?: LauncherTerminalSettings
  raw?: unknown
}

export interface LauncherInfo {
  apps: LauncherAppInfo[]
  raw?: unknown
}

export interface LauncherProcessStatus {
  pid: number
  cpu?: number
  memory?: number
  cols?: number
  rows?: number
  raw?: unknown
}

export interface LauncherAppStatus {
  name: string
  checkingForUpdates?: boolean
  updating?: boolean
  crashes?: number
  processes?: LauncherProcessStatus[]
  started?: string
  raw?: unknown
}

export interface LauncherStatus {
  apps: Record<string, LauncherAppStatus>
  raw?: unknown
}

export interface LauncherProcessRow extends LauncherProcessStatus {
  app: string
  started?: string
}
