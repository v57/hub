/**
 * Page spec: Launcher.
 *
 * Source reference:
 * - `Reference/Launcher.swift`
 * - `Reference/Launcher/Launcher logic.swift`
 * - `Reference/Launcher/Shell.swift`
 *
 * How user gets here:
 * - Home -> selected hub section -> "Launcher" card.
 * - Requires hub to expose launcher status capability; Home only shows entry
 *   when `launcher/status` permission is allowed.
 *
 * What page displays:
 * - List page for Hub Launcher and apps managed by it.
 * - First section is explanatory placeholder:
 *   - Icon: apple.terminal.
 *   - Title: "Launcher".
 *   - Text: installs apps, displays usage, updates apps, restarts on crash.
 * - Launcher status cell.
 * - If connected and hub has launcher:
 *   - List of installed launcher apps from `launcher/info`.
 *   - "Get More" action opening Store page (`launcher/store.ts`).
 *   - Toolbar actions for update/check/create.
 *
 * Launcher status cell:
 * - In Pro/local build, displays local launcher install/runtime status:
 *   - Not installed.
 *   - Failed to download the project.
 *   - Failed to install Bun.
 *   - Installation failed.
 *   - Installed.
 *   - Status text.
 *   - Stopping.
 *   - Offline.
 *   - Running.
 * - Action button depends on status:
 *   - Install for not installed/failed states.
 *   - Launch for installed/offline.
 *   - Stop for running.
 * - Context menu:
 *   - "Update" if updates are available.
 *   - Otherwise "Check for Updates".
 * - Local install flow in Swift:
 *   - Clone `v57/hub-launcher` into home directory.
 *   - Ensure Bun is installed via `curl -fsSL https://bun.sh/install | bash`.
 *   - Run `bun i`.
 *   - Launch via `screen -dmS hub bun .`.
 *   - Stop via `launcher/stop` endpoint.
 *
 * Toolbar actions when launcher is connected:
 * - "Update All" appears when any app has `updateAvailable` and no app is
 *   currently updating. Sends `launcher/update/all`.
 * - "Check for Updates" appears when no app is currently checking. Sends
 *   `launcher/update/check/all`.
 * - Icon-only "Create" opens Create App sheet (`launcher/create-app.ts`).
 *
 * App row display:
 * - Shows app id/name.
 * - Shows install/update badge:
 *   - "Updating" when status updating.
 *   - "Checking for updates" when checking.
 *   - "Update available" when app has update available.
 * - Shows process status rows:
 *   - CPU percent + memory MB when both present.
 *   - Memory MB when CPU missing.
 *   - "Not running" when no process memory.
 * - Shows relative started time when processes exist and `started` exists.
 * - Shows instance stepper when explicitly expanded or app instances > 1.
 * - App named "Hub Lite" shows "Upgrade to Pro", sending local public key to
 *   `launcher/pro`.
 *
 * App row context menu:
 * - Active app:
 *   - "Cluster" when app has one instance; reveals instance stepper.
 *   - "Edit" opens Edit App sheet (`launcher/edit-app.ts`).
 *   - "Stop" sends `launcher/app/stop`.
 * - Inactive app:
 *   - "Start" sends `launcher/app/start`.
 *   - "Uninstall" sends `launcher/app/uninstall` and is destructive.
 * - Home page variant also has "Restart"; full launcher reference only has
 *   Stop/Edit/Cluster for active apps.
 *
 * Instance scaling:
 * - Stepper changes local target count.
 * - Send `launcher/app/cluster` with `{ name, count }`.
 * - Guard count > 0, count differs from current, count <= 1024.
 *
 * Navigation:
 * - "Get More" -> Store page (`launcher/store.ts`).
 * - "Create" -> Create App sheet (`launcher/create-app.ts`).
 * - App "Edit"/"Settings" -> Edit App sheet (`launcher/edit-app.ts`).
 *
 * Data/state streams needed:
 * - `launcher/info`: app list with name, active, restarts, updateAvailable,
 *   instances, settings.
 * - `launcher/status`: app runtime status map with processes, started time,
 *   updating/checking flags.
 * - Hub connection state and hasLauncher flag.
 * - Local public key for Pro upgrade.
 *
 * Web port notes:
 * - Use list/table with app status, process metrics, started age, update badge,
 *   and row overflow menu.
 * - Sheets can be modal dialogs.
 * - Stepper can be number input with +/- buttons.
 *
 * Terminal port notes:
 * - Render launcher status plus app table.
 * - Commands: create, store, update-all, check-updates, start, stop, restart,
 *   uninstall, edit, cluster <app> <count>, pro.
 * - Keep destructive uninstall behind confirmation.
 */
import { Button, HStack, StatusBadge, Table, Text } from '../terminal'
import { Card, PageShell, RouteLink, Section, stateBinding } from './shared'
import type { ClientLauncherApp, ClientPage, ClientPageState } from './types'

type LauncherAppRow = ClientLauncherApp & {
  id: string
  status: string
  processText: string
  updateText: string
  instanceText: string
}

export const launcherPage: ClientPage = {
  route: 'launcher',
  title: 'Launcher',
  render(context) {
    const state = context.state
    const rows = launcherRows(state)
    const selected = rows.find(row => row.id === state.selectedLauncherAppId) ?? rows[0]
    const hasUpdate = rows.some(row => row.updateAvailable)
    const checking = state.launcherCheckingUpdates || rows.some(row => row.checkingForUpdates)
    const updating = state.launcherUpdating || rows.some(row => row.updating)

    return PageShell(this, context, [
      Section('Launcher', [
        HStack([
          StatusBadge(launcherStatusLabel(state), launcherStatusTone(state)),
          StatusBadge(`${rows.length} apps`, rows.length > 0 ? 'success' : 'muted'),
          ...(hasUpdate ? [StatusBadge('Update available', 'warning')] : []),
        ], { spacing: 1 }),
        Text('Installs apps, displays usage, updates apps, and restarts processes on crash.', { wrap: true }).foregroundColor('secondary'),
        HStack([
          Button('Update All', () => updateAllApps(state), { disabled: !hasUpdate || updating, loading: updating }),
          Button('Check for Updates', () => checkAllUpdates(state), { disabled: checking, loading: checking }),
          RouteLink('Create', 'launcher/create-app'),
          RouteLink('Get More', 'launcher/store'),
        ], { spacing: 1 }),
        ...(state.launcherNotice ? [Text(state.launcherNotice).foregroundColor('green')] : []),
      ]),
      Section('Apps', rows.length > 0 ? [
        Table(rows, 'id', [
          { header: 'App', width: { flexible: 2, min: 12 }, cell: 'name' },
          { header: 'Status', width: 12, cell: 'status' },
          { header: 'Processes', width: { flexible: 1, min: 12 }, cell: 'processText' },
          { header: 'Update', width: 12, cell: 'updateText' },
          { header: 'Instances', width: 9, cell: 'instanceText' },
        ], {
          selection: stateBinding(state, 'selectedLauncherAppId', selected?.id ?? ''),
          onActivate: row => {
            state.selectedLauncherAppId = row.id
            state.editAppName = row.name
            state.launcherNotice = `${row.name} selected`
          },
        }).frame({ maxWidth: -1 }),
        ...(selected ? [selectedAppCard(state, selected)] : []),
      ] : [
        Text('No launcher apps installed.').foregroundColor('secondary'),
        HStack([RouteLink('Create App', 'launcher/create-app'), RouteLink('Store', 'launcher/store')], { spacing: 2 }),
      ]),
    ])
  },
}

function selectedAppCard(state: ClientPageState, app: LauncherAppRow) {
  return Card(
    `Selected: ${app.name}`,
    [
      HStack([
        Text(app.processText),
        Text(app.started ? `Started ${app.started}` : 'No start time'),
        ...(app.restarts ? [Text('Restarts on crash')] : []),
      ], { spacing: 2 }).foregroundColor('secondary'),
      HStack([
        appActionsButton(state, app),
        RouteLink('Settings', 'launcher/edit-app'),
        Button('Terminal', () => {
          state.selectedLauncherAppId = app.id
          state.launcherNotice = `${app.name} terminal selected`
        }),
        ...(app.name === 'Hub Lite' ? [Button('Upgrade to Pro', () => {
          state.launcherNotice = state.publicKey ? 'Pro upgrade request prepared' : 'Public key is required for Pro upgrade'
        }, { disabled: !state.publicKey })] : []),
      ], { spacing: 1 }),
    ],
    [
      StatusBadge(app.status, app.status === 'running' ? 'success' : app.active ? 'warning' : 'muted'),
      ...(app.updateAvailable ? [StatusBadge('Update', 'warning')] : []),
      ...(app.updating ? [StatusBadge('Updating', 'warning')] : []),
    ],
  )
}

function appActionsButton(state: ClientPageState, app: LauncherAppRow) {
  return Button('App Actions', () => {
    state.selectedLauncherAppId = app.id
    state.launcherNotice = `Open ${app.name} action menu with Space`
  }).contextMenu([
    ...(app.active
      ? [
          { label: 'Cluster', action: () => clusterApp(state, app, Math.max(2, app.instances ?? 1)) },
          { label: 'Restart', action: () => restartApp(state, app) },
          { label: 'Stop', action: () => stopApp(state, app) },
        ]
      : [
          { label: 'Start', action: () => startApp(state, app) },
          { label: 'Uninstall', action: () => uninstallApp(state, app) },
        ]),
    { label: 'Edit', action: () => { state.editAppName = app.name; state.launcherNotice = `${app.name} settings selected` } },
    { label: 'Cluster 1', action: () => clusterApp(state, app, 1) },
    { label: 'Cluster 2', action: () => clusterApp(state, app, 2) },
    { label: 'Cluster 4', action: () => clusterApp(state, app, 4) },
    { label: 'Cluster 8', action: () => clusterApp(state, app, 8) },
  ])
}

function launcherRows(state: ClientPageState): LauncherAppRow[] {
  return (state.launcherApps ?? []).map((app, index) => {
    const id = (app.id ?? app.name) || `app-${index}`
    return {
      ...app,
      id,
      status: appStatus(app),
      processText: processSummary(app),
      updateText: updateSummary(app),
      instanceText: String(app.instances ?? 1),
    }
  })
}

function launcherStatusLabel(state: ClientPageState): string {
  if (state.launcherStatusText) return state.launcherStatusText
  const status = state.launcherStatus ?? 'offline'
  if (status === 'not-installed') return 'Not installed'
  if (status === 'failed') return 'Installation failed'
  if (status === 'installed') return 'Installed'
  if (status === 'stopping') return 'Stopping'
  if (status === 'running') return 'Running'
  return 'Offline'
}

function launcherStatusTone(state: ClientPageState) {
  const status = state.launcherStatus ?? 'offline'
  if (status === 'running') return 'success'
  if (status === 'installed' || status === 'stopping') return 'warning'
  if (status === 'failed' || status === 'not-installed') return 'danger'
  return 'muted'
}

function appStatus(app: ClientLauncherApp): string {
  if ((app.processes?.length ?? 0) > 0) return 'running'
  if (app.active) return 'not running'
  return 'stopped'
}

function processSummary(app: ClientLauncherApp): string {
  const processes = app.processes ?? []
  if (processes.length === 0) return app.active ? 'Not running' : 'Stopped'
  const totalCpu = processes.reduce((sum, process) => sum + (process.cpu ?? 0), 0)
  const totalMemory = processes.reduce((sum, process) => sum + (process.memory ?? 0), 0)
  if (processes.length > 1) return `${processes.length} proc ${totalCpu.toFixed(1)}% ${formatMemory(totalMemory)}`
  const process = processes[0]!
  if (process.cpu !== undefined && process.memory !== undefined) return `${process.cpu.toFixed(1)}% ${formatMemory(process.memory)}`
  if (process.memory !== undefined) return formatMemory(process.memory)
  return 'Active'
}

function updateSummary(app: ClientLauncherApp): string {
  if (app.updating) return 'Updating'
  if (app.checkingForUpdates) return 'Checking'
  if (app.updateAvailable) return 'Available'
  return '-'
}

function updateAllApps(state: ClientPageState): void {
  state.launcherApps = (state.launcherApps ?? []).map(app => ({ ...app, updateAvailable: false, updating: false }))
  state.launcherUpdating = false
  state.launcherNotice = 'All app update action prepared'
}

function checkAllUpdates(state: ClientPageState): void {
  state.launcherCheckingUpdates = false
  state.launcherNotice = 'Check for updates action prepared'
}

function startApp(state: ClientPageState, app: LauncherAppRow): void {
  updateApp(state, app.id, current => ({ ...current, active: true, processes: current.processes?.length ? current.processes : [{ pid: 1, memory: 0 }] }))
  state.launcherNotice = `${app.name} start action prepared`
}

function stopApp(state: ClientPageState, app: LauncherAppRow): void {
  updateApp(state, app.id, current => ({ ...current, active: false, processes: [] }))
  state.launcherNotice = `${app.name} stop action prepared`
}

function restartApp(state: ClientPageState, app: LauncherAppRow): void {
  updateApp(state, app.id, current => ({ ...current, active: true }))
  state.launcherNotice = `${app.name} restart action prepared`
}

function uninstallApp(state: ClientPageState, app: LauncherAppRow): void {
  state.launcherApps = (state.launcherApps ?? []).filter(row => (row.id ?? row.name) !== app.id)
  state.selectedLauncherAppId = state.launcherApps[0]?.id ?? state.launcherApps[0]?.name
  state.launcherNotice = `${app.name} uninstall action prepared`
}

function clusterApp(state: ClientPageState, app: LauncherAppRow, count: number): void {
  const safeCount = Math.max(1, Math.min(1024, count))
  updateApp(state, app.id, current => ({ ...current, instances: safeCount, targetInstances: safeCount }))
  state.launcherNotice = `${app.name} cluster count set to ${safeCount}`
}

function updateApp(state: ClientPageState, id: string, update: (app: ClientLauncherApp) => ClientLauncherApp): void {
  state.launcherApps = (state.launcherApps ?? []).map(app => ((app.id ?? app.name) === id ? update(app) : app))
  state.selectedLauncherAppId = id
}

function formatMemory(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${Math.round(value)} B`
}
