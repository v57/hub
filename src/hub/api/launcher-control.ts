import type { HubRuntimeClient } from '../runtime'
import type {
  LauncherAppInfo,
  LauncherAppStatus,
  LauncherCreate,
  LauncherInfo,
  LauncherProcessRow,
  LauncherProcessStatus,
  LauncherSettings,
  LauncherStatus,
} from '../types/launcher'

export class LauncherControl {
  constructor(private client: HubRuntimeClient) {}

  info(): Promise<LauncherInfo> {
    return firstValue(this.watchInfo())
  }

  watchInfo(): AsyncIterable<LauncherInfo> {
    return mapValues(this.client.values('launcher/info'), normalizeLauncherInfo)
  }

  status(): Promise<LauncherStatus> {
    return firstValue(this.watchStatus())
  }

  watchStatus(): AsyncIterable<LauncherStatus> {
    return mapValues(this.client.values('launcher/status'), normalizeLauncherStatus)
  }

  checkLauncherUpdate(): Promise<boolean> {
    return this.client.send<boolean>('launcher/update/check')
  }

  async updateLauncher(): Promise<void> {
    await this.client.send('launcher/update')
  }

  async checkAllUpdates(): Promise<void> {
    await this.client.send('launcher/update/check/all')
  }

  async updateAll(): Promise<void> {
    await this.client.send('launcher/update/all')
  }

  async stopLauncher(): Promise<void> {
    await this.client.send('launcher/stop')
  }

  /** Replaces hub-server's pairing code and returns it; owners only, to add another owner */
  newPairingCode(): Promise<string> {
    return this.client.send<string>('launcher/pair/new')
  }

  async startApp(app: string): Promise<void> {
    await this.client.send('launcher/app/start', app)
  }

  async stopApp(app: string): Promise<void> {
    await this.client.send('launcher/app/stop', app)
  }

  async restartApp(app: string): Promise<void> {
    await this.client.send('launcher/app/restart', app)
  }

  async uninstallApp(app: string): Promise<void> {
    await this.client.send('launcher/app/uninstall', app)
  }

  async createApp(app: LauncherCreate): Promise<void> {
    await this.client.send('launcher/app/create', app)
  }

  async updateAppSettings(app: string, settings: LauncherSettings): Promise<void> {
    await this.client.send('launcher/app/settings', { app, settings })
  }

  async setAppClusterCount(name: string, count: number): Promise<void> {
    await this.client.send('launcher/app/cluster', { name, count })
  }

  async processes(): Promise<LauncherProcessRow[]> {
    return flattenLauncherProcesses(await this.status())
  }
}

export function flattenLauncherProcesses(status: LauncherStatus): LauncherProcessRow[] {
  const rows: LauncherProcessRow[] = []
  for (const app of Object.values(status.apps)) {
    for (const process of app.processes ?? []) {
      rows.push({
        ...process,
        app: app.name,
        started: app.started,
      })
    }
  }
  return rows
}

export function normalizeLauncherInfo(value: unknown): LauncherInfo {
  const item = asRecord(value)
  const apps = arrayValues(item?.apps ?? value).map(normalizeLauncherAppInfo).filter((app): app is LauncherAppInfo => Boolean(app))
  return { apps, raw: value }
}

export function normalizeLauncherStatus(value: unknown): LauncherStatus {
  const item = asRecord(value)
  const apps = arrayValues(item?.apps ?? value).map(normalizeLauncherAppStatus).filter((app): app is LauncherAppStatus => Boolean(app))
  return {
    apps: Object.fromEntries(apps.map(app => [app.name, app])),
    raw: value,
  }
}

function normalizeLauncherAppInfo(value: unknown): LauncherAppInfo | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const name = optionalString(item.name)
  if (!name) return undefined
  return {
    id: name,
    name,
    active: booleanValue(item.active),
    restarts: booleanValue(item.restarts),
    updateAvailable: booleanValue(item.updateAvailable),
    instances: numberValue(item.instances, 1),
    settings: normalizeSettings(item.settings),
    terminal: normalizeTerminalSettings(item.terminal),
    raw: value,
  }
}

function normalizeLauncherAppStatus(value: unknown): LauncherAppStatus | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const name = optionalString(item.name)
  if (!name) return undefined
  return {
    name,
    checkingForUpdates: optionalBoolean(item.checkingForUpdates),
    updating: optionalBoolean(item.updating),
    crashes: optionalNumber(item.crashes),
    processes: arrayValues(item.processes).map(normalizeProcessStatus).filter((process): process is LauncherProcessStatus => Boolean(process)),
    started: normalizeDateString(item.started),
    raw: value,
  }
}

function normalizeProcessStatus(value: unknown): LauncherProcessStatus | undefined {
  const item = asRecord(value)
  const pid = optionalNumber(item?.pid)
  if (pid === undefined) return undefined
  return {
    pid,
    cpu: optionalNumber(item?.cpu),
    memory: optionalNumber(item?.memory),
    cols: optionalNumber(item?.cols),
    rows: optionalNumber(item?.rows),
    raw: value,
  }
}

function normalizeSettings(value: unknown): LauncherSettings | null | undefined {
  if (value === null) return null
  const item = asRecord(value)
  if (!item) return undefined
  const settings: LauncherSettings = {}
  const env = normalizeStringRecord(item.env)
  const secrets = normalizeStringRecord(item.secrets)
  if (env) settings.env = env
  if (secrets) settings.secrets = secrets
  return settings
}

function normalizeTerminalSettings(value: unknown) {
  const item = asRecord(value)
  if (!item) return undefined
  return omitUndefined({
    cols: optionalNumber(item.cols),
    rows: optionalNumber(item.rows),
    name: optionalString(item.name),
  })
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const output: Record<string, string> = {}
  for (const [key, raw] of Object.entries(item)) {
    if (typeof raw === 'string') output[key] = raw
  }
  return Object.keys(output).length ? output : undefined
}

function normalizeDateString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

async function firstValue<T>(values: AsyncIterable<T>): Promise<T> {
  for await (const value of values) return value
  throw new Error('Launcher stream ended before first value')
}

async function* mapValues<T, U>(values: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  for await (const value of values) yield map(value)
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (raw !== undefined) output[key] = raw
  }
  return output as T
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return record ? Object.values(record) : []
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
