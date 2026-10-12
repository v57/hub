/**
 * Page spec: Launcher Store.
 *
 * Source reference:
 * - `Reference/Launcher/Store.swift`
 * - `Reference/Launcher/IconView.swift`
 * - `Reference/Launcher/Launcher logic.swift`
 *
 * How user gets here:
 * - Launcher page -> "Get More".
 * - Navigation title is "Store".
 *
 * What page displays:
 * - List of installable apps/services from a JSON store URL.
 * - Default store URL:
 *   `https://raw.githubusercontent.com/v57/hub-store/refs/heads/main/apps.json`
 * - Toolbar filter picker:
 *   - All.
 *   - App.
 *   - Api.
 *   - Server.
 * - Optional custom store URL row appears after "Change Store".
 *
 * Store item data shape:
 * - `id`: string.
 * - `icon`: Hub icon model. Can be symbol icon or text icon.
 * - `name`: display/install name.
 * - `shortDescription`: subtitle.
 * - `type`: `app`, `api`, or `server`.
 * - `setup`: optional launcher setup payload. If missing, item is informational
 *   and no install button is shown.
 *
 * Icon display:
 * - Symbol icon:
 *   - Background uses provided icon background color when present; otherwise
 *     gray/neutral background.
 *   - Symbol is centered.
 * - Text icon:
 *   - Background uses provided color when present.
 *   - Text is centered, bold rounded style.
 *   - Foreground uses provided foreground color when present.
 * - Rounded square, 44x44 in list rows.
 *
 * Fetch/loading behavior:
 * - Page starts with loading status.
 * - Fetch URL once per `attempt`; repeated requests for same URL are cached in
 *   static task map.
 * - While no items and loading, show circular progress.
 * - On failure and no items, show red error label "Failed to fetch store" and
 *   "Retry" button.
 * - Retry increments attempt and refetches.
 *
 * Toolbar actions:
 * - Filter picker changes visible list.
 * - "Change Store" button appears until custom URL row is shown.
 *
 * Custom store URL row:
 * - Text field placeholder: "Store URL".
 * - If entered text is valid URL, show "Open".
 * - If text is empty and current URL is not main store, show "Go to Main Store".
 * - Selecting URL:
 *   - Clears focus.
 *   - Sets store URL.
 *   - Clears current items.
 *   - Increments attempt.
 *
 * Store item row:
 * - Leading icon.
 * - Name.
 * - Short description.
 * - Trailing action button when applicable:
 *   - "Installing" while install request is running.
 *   - "Installed" when app already exists in `launcher/info`.
 *   - "Get" when not installed and setup exists.
 *   - No button when setup missing.
 * - "Get" action:
 *   - Sets installing state.
 *   - Sends `launcher/app/create` with:
 *     - name: store item name.
 *     - active: true.
 *     - restarts: true.
 *     - setup: item setup.
 *   - Marks installed true on success.
 *
 * Data/API needed:
 * - Network fetch for store JSON.
 * - `launcher/info` stream to detect installed apps by name.
 * - Endpoint `launcher/app/create`.
 *
 * Web port notes:
 * - Use list with filter tabs/select and install buttons.
 * - Custom store URL should validate URL before enabling Open.
 *
 * Terminal port notes:
 * - Commands: filter all|app|api|server, change-store <url>, retry,
 *   install <item>.
 * - Show installed state in table.
 */
import { Button, HStack, StatusBadge, TabBar, Text, TextField } from '../../terminal'
import { Card, PageShell, Section, stateBinding } from '../shared'
import type { ClientPage, ClientPageState, ClientStoreFilter, ClientStoreItem } from '../types'

const storeFilters: ClientStoreFilter[] = ['All', 'App', 'Api', 'Server']
const mainStoreUrl = 'https://raw.githubusercontent.com/v57/hub-store/refs/heads/main/apps.json'

export const launcherStorePage: ClientPage = {
  route: 'launcher/store',
  title: 'Launcher Store',
  render(context) {
    const state = context.state
    const items = filteredItems(state)

    return PageShell(this, context, [
      Section('Store', [
        Text(state.storeUrl ?? mainStoreUrl).foregroundColor('secondary'),
        TabBar(storeFilters, stateBinding(state, 'storeFilter', 'All')),
        HStack([
          Button('Retry', () => retryStore(state), { loading: state.storeLoading }),
          Button('Change Store', () => { state.storeCustomUrlVisible = true }, { disabled: state.storeCustomUrlVisible }),
        ], { spacing: 1 }),
        ...(state.storeCustomUrlVisible ? customStoreRows(state) : []),
        ...(state.storeError ? [Text(`Failed to fetch store: ${state.storeError}`).foregroundColor('red')] : []),
        ...(state.launcherNotice ? [Text(state.launcherNotice).foregroundColor('green')] : []),
      ]),
      Section('Apps', items.length > 0 ? items.map(item => storeItemCard(state, item)) : emptyStoreRows(state)),
    ])
  },
}

function customStoreRows(state: ClientPageState) {
  const draft = state.storeDraftUrl ?? ''
  const valid = isValidUrl(draft)
  return [
    Text('Custom store URL').fontWeight('bold'),
    TextField(stateBinding(state, 'storeDraftUrl', ''), { placeholder: 'Store URL' }).frame({ maxWidth: -1 }),
    HStack([
      Button('Open', () => openCustomStore(state), { disabled: !valid }),
      Button('Go to Main Store', () => {
        state.storeUrl = mainStoreUrl
        state.storeDraftUrl = ''
        state.storeError = undefined
        state.launcherNotice = 'Main store selected'
      }, { disabled: (state.storeUrl ?? mainStoreUrl) === mainStoreUrl || draft.trim().length > 0 }),
    ], { spacing: 1 }),
  ]
}

function storeItemCard(state: ClientPageState, item: ClientStoreItem) {
  const installed = item.installed || (state.storeInstalledNames ?? []).includes(item.name) || (state.launcherApps ?? []).some(app => app.name === item.name)
  const installing = state.storeInstallingId === item.id
  return Card(
    item.name,
    [
      Text(item.shortDescription).foregroundColor('secondary'),
      HStack([
        StatusBadge(item.type, item.type === 'app' ? 'default' : item.type === 'api' ? 'success' : 'warning'),
        ...(installed ? [StatusBadge('Installed', 'success')] : []),
        ...(item.setup ? [Button(installing ? 'Installing' : installed ? 'Installed' : 'Get', () => installStoreItem(state, item), { disabled: installed || installing, loading: installing })] : [StatusBadge('Info', 'muted')]),
      ], { spacing: 1 }),
    ],
  )
}

function filteredItems(state: ClientPageState): ClientStoreItem[] {
  const filter = state.storeFilter ?? 'All'
  const items = state.storeItems ?? []
  if (filter === 'All') return items
  const type = filter.toLowerCase()
  return items.filter(item => item.type === type)
}

function emptyStoreRows(state: ClientPageState) {
  if (state.storeLoading) return [Text('Loading store...').foregroundColor('secondary')]
  if (state.storeError) return [
    Text('Failed to fetch store.').foregroundColor('red'),
    Button('Retry', () => retryStore(state)),
  ]
  return [
    Text('No store items loaded yet.').foregroundColor('secondary'),
    Text('Retry fetches the current store URL; Change Store accepts a custom apps.json URL.').foregroundColor('secondary'),
  ]
}

function retryStore(state: ClientPageState): void {
  state.storeLoading = false
  state.storeError = undefined
  state.launcherNotice = `Store retry requested for ${state.storeUrl ?? mainStoreUrl}`
}

function openCustomStore(state: ClientPageState): void {
  const draft = state.storeDraftUrl?.trim() ?? ''
  if (!isValidUrl(draft)) {
    state.storeError = 'Invalid store URL'
    return
  }
  state.storeUrl = draft
  state.storeItems = []
  state.storeError = undefined
  state.storeCustomUrlVisible = false
  state.launcherNotice = 'Custom store selected'
}

function installStoreItem(state: ClientPageState, item: ClientStoreItem): void {
  if (!item.setup) {
    state.launcherNotice = `${item.name} has no launcher setup`
    return
  }
  state.storeInstallingId = undefined
  state.storeInstalledNames = [...new Set([...(state.storeInstalledNames ?? []), item.name])]
  state.launcherApps = [
    ...(state.launcherApps ?? []).filter(app => app.name !== item.name),
    {
      id: item.name,
      name: item.name,
      active: true,
      restarts: true,
      instances: 1,
      processes: [],
    },
  ]
  state.launcherNotice = `${item.name} install action prepared`
}

function isValidUrl(value: string): boolean {
  try {
    return Boolean(new URL(value).protocol.match(/^https?:$/))
  } catch {
    return false
  }
}
