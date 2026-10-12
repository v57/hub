/**
 * Page spec: Edit App Settings.
 *
 * Source reference:
 * - `Reference/Launcher/Edit app.swift`
 * - `Reference/Launcher/Launcher logic.swift`
 *
 * How user gets here:
 * - Launcher app row context menu -> "Edit".
 * - Home launcher app card context menu -> "Settings".
 * - Presented as sheet/modal in Swift.
 *
 * What page displays:
 * - List form for launcher app environment and secret settings.
 * - Navigation title is app name.
 * - Sections:
 *   - "Environment values".
 *   - "Secret keys".
 *
 * Environment values section:
 * - Rows contain:
 *   - Key text field, fixed small width.
 *   - Value text field.
 * - Keyboard/style is code/monospaced in reference.
 * - Existing env values are loaded from `app.settings.env`.
 * - Always keep one trailing empty row; when every row has content, append new
 *   empty row.
 *
 * Secret keys section:
 * - Rows contain:
 *   - Secure key field.
 *   - Secure value field.
 * - Always keep one trailing empty row.
 * - On save, non-empty secret key/value pairs are sent as app settings secrets.
 *
 * Important reference bug/quirk:
 * - Swift `settings` currently builds `secrets` from `self.env` instead of
 *   `self.secrets`. Web/terminal implementation should probably fix this by
 *   using secret rows for secrets, unless strict bug-for-bug parity is required.
 *
 * Toolbar/actions:
 * - Cancel: dismiss modal.
 * - Save:
 *   - Visible only when computed settings differ from old app settings.
 *   - Sends app settings update via `launcher/app/settings`.
 *   - Payload shape:
 *     - app id/name.
 *     - settings: `{ env?: Record<string,string>, secrets?: Record<string,string> }`.
 *   - Dismisses after successful save.
 *
 * Change detection:
 * - Empty env rows are ignored.
 * - `env` is included only if different from existing `app.settings.env`.
 * - `secrets` is included only if non-empty.
 * - If final settings equal old value, `hasChanges` is false.
 *
 * Data/API needed:
 * - App info with current settings.
 * - Endpoint `launcher/app/settings`.
 *
 * Web port notes:
 * - Use table-like editable rows.
 * - Secret values should be password fields.
 * - Keep Save disabled/hidden until changes exist.
 *
 * Terminal port notes:
 * - Commands: set-env KEY VALUE, unset-env KEY, set-secret KEY VALUE,
 *   unset-secret KEY, save, cancel.
 * - Mask secret input and never echo raw secret after entry.
 */
import { Button, HStack, Text, TextField, type Binding, type ViewNode } from '../../terminal'
import { PageShell, Section } from '../shared'
import type { ClientKeyValueRow, ClientLauncherApp, ClientPage, ClientPageState } from '../types'

export const editAppPage: ClientPage = {
  route: 'launcher/edit-app',
  title: 'Edit App',
  render(context) {
    const state = context.state
    const app = selectedEditApp(state)
    if (!app) {
      return PageShell(this, context, [
        Section('Settings', [
          Text('No launcher app selected.').foregroundColor('secondary'),
        ]),
      ])
    }

    ensureEditRows(state, app)
    const envRows = state.editEnvRows ?? []
    const secretRows = state.editSecretRows ?? []
    const changed = hasSettingsChanges(app, envRows, secretRows)

    return PageShell(this, context, [
      Section(app.name, [
        Text('Environment values').fontWeight('bold'),
        ...settingRows(envRows, false),
        Text('Secret keys').fontWeight('bold'),
        ...settingRows(secretRows, true),
        HStack([
          Button('Cancel', () => {
            state.editEnvRows = undefined
            state.editSecretRows = undefined
            state.editNotice = `${app.name} settings cancelled`
          }, { role: 'cancel' }),
          Button('Save', () => saveSettings(state, app), { disabled: !changed }),
        ], { spacing: 1 }),
        ...(state.editNotice ? [Text(state.editNotice).foregroundColor('green')] : []),
      ]),
    ])
  },
}

function settingRows(rows: ClientKeyValueRow[], secure: boolean): ViewNode[] {
  return rows.map((row, index) =>
    HStack([
      TextField(rowBinding(rows, index, 'key'), { placeholder: secure ? 'SECRET_KEY' : 'KEY', secure }).frame({ width: 18 }),
      TextField(rowBinding(rows, index, 'value'), { placeholder: secure ? 'Secret value' : 'Value', secure }).frame({ maxWidth: -1 }),
    ], { spacing: 1 }),
  )
}

function selectedEditApp(state: ClientPageState): ClientLauncherApp | undefined {
  const name = state.editAppName ?? state.selectedLauncherAppId
  return (state.launcherApps ?? []).find(app => app.name === name || app.id === name) ?? (state.launcherApps ?? [])[0]
}

function ensureEditRows(state: ClientPageState, app: ClientLauncherApp): void {
  if (!state.editEnvRows) state.editEnvRows = recordRows(app.settings?.env)
  if (!state.editSecretRows) state.editSecretRows = recordRows(app.settings?.secrets)
  ensureTrailingEmptyRow(state.editEnvRows)
  ensureTrailingEmptyRow(state.editSecretRows)
}

function rowBinding(rows: ClientKeyValueRow[], index: number, key: keyof ClientKeyValueRow): Binding<string> {
  return {
    get() {
      return rows[index]?.[key] ?? ''
    },
    set(value) {
      if (!rows[index]) rows[index] = { key: '', value: '' }
      rows[index]![key] = value
      ensureTrailingEmptyRow(rows)
    },
  }
}

function saveSettings(state: ClientPageState, app: ClientLauncherApp): void {
  const env = rowsRecord(state.editEnvRows ?? [])
  const secrets = rowsRecord(state.editSecretRows ?? [])
  state.launcherApps = (state.launcherApps ?? []).map(row => {
    if ((row.id ?? row.name) !== (app.id ?? app.name)) return row
    return {
      ...row,
      settings: {
        ...(Object.keys(env).length ? { env } : {}),
        ...(Object.keys(secrets).length ? { secrets } : {}),
      },
    }
  })
  state.editNotice = `${app.name} settings save action prepared`
}

function hasSettingsChanges(app: ClientLauncherApp, envRows: ClientKeyValueRow[], secretRows: ClientKeyValueRow[]): boolean {
  const env = rowsRecord(envRows)
  const secrets = rowsRecord(secretRows)
  return !sameRecord(env, app.settings?.env ?? {}) || Object.keys(secrets).length > 0
}

function recordRows(record: Record<string, string> | undefined): ClientKeyValueRow[] {
  const rows = Object.entries(record ?? {}).map(([key, value]) => ({ key, value }))
  ensureTrailingEmptyRow(rows)
  return rows
}

function rowsRecord(rows: ClientKeyValueRow[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key && row.value) record[key] = row.value
  }
  return record
}

function ensureTrailingEmptyRow(rows: ClientKeyValueRow[]): void {
  const last = rows.at(-1)
  if (!last || last.key.trim() || last.value) rows.push({ key: '', value: '' })
}

function sameRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}
