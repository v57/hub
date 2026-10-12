/**
 * Page spec: Create App.
 *
 * Source reference:
 * - `Reference/Launcher/Create app.swift`
 * - `Reference/Launcher/Launcher logic.swift`
 *
 * How user gets here:
 * - Launcher page toolbar -> "Create" plus button.
 * - Presented as a sheet/modal in Swift.
 *
 * What page displays:
 * - App creation form for Hub Launcher.
 * - Top picker/segmented control "Type":
 *   - "Shell".
 *   - "Bun".
 * - App name field:
 *   - Placeholder is derived default name when available, otherwise "App Name".
 *   - Monospaced style in reference.
 * - Restart on crash toggle, default on.
 *
 * Shell type fields:
 * - Install script:
 *   - Multiline text field.
 *   - Optional.
 *   - Split by newline into command array.
 * - Uninstall script:
 *   - Multiline text field.
 *   - Optional.
 *   - Split by newline into command array.
 * - Launch directory:
 *   - Optional.
 *   - Empty means omitted/null.
 * - Launch command:
 *   - Required for Shell readiness.
 *   - Default app name is first whitespace-separated word of launch command.
 *
 * Bun type fields:
 * - GitHub Repo:
 *   - Expected form like `owner/repo`.
 *   - Default app name is second path component (`repo`) when present.
 * - Reference sends Bun setup with repo, commit null, command null.
 *
 * Readiness:
 * - Create button appears only when default name can be derived.
 * - For Shell, launch command must be non-empty.
 * - For Bun, repo must contain owner/name and name must be non-empty.
 *
 * Toolbar/actions:
 * - Cancel: dismiss modal.
 * - Create:
 *   - Builds `Hub.Launcher.Create`.
 *   - Name = explicit name or derived default.
 *   - active = true.
 *   - restarts = toggle value.
 *   - setup:
 *     - Shell: `{ type: "sh", directory, install, uninstall, run }`.
 *     - Bun: `{ type: "bun", repo, commit: null, command: null }`.
 *   - Sends `launcher/app/create`.
 *   - Dismisses sheet immediately after task starts in reference.
 *
 * Data/API needed:
 * - Current hub launcher API.
 * - Endpoint `launcher/app/create`.
 *
 * Web port notes:
 * - Use modal dialog.
 * - Keep Shell command fields monospaced and multiline.
 * - Disable or hide Create until ready; reference hides it.
 *
 * Terminal port notes:
 * - Prompt for type first.
 * - Shell flow asks launch command before optional install/uninstall/directory.
 * - Bun flow asks repo.
 * - Confirm generated payload before send.
 */
import { Button, HStack, TabBar, Text, TextField, Toggle } from '../../terminal'
import { Card, PageShell, Section, stateBinding } from '../shared'
import type { ClientCreateAppMode, ClientPage, ClientPageState } from '../types'

const createModes: ClientCreateAppMode[] = ['Shell', 'Bun']

export const createAppPage: ClientPage = {
  route: 'launcher/create-app',
  title: 'Create App',
  render(context) {
    const state = context.state
    const mode = state.createAppMode ?? 'Shell'
    const derivedName = defaultAppName(state)
    const finalName = (state.createAppName ?? '').trim() || derivedName
    const ready = createAppReady(state)

    return PageShell(this, context, [
      Section('Create App', [
        TabBar(createModes, stateBinding(state, 'createAppMode', 'Shell')),
        Text('App Name').fontWeight('bold'),
        TextField(stateBinding(state, 'createAppName', ''), { placeholder: derivedName || 'App Name' }).frame({ maxWidth: -1 }),
        Toggle('Restart on crash', stateBinding(state, 'createAppRestarts', true)),
        ...(mode === 'Shell' ? shellFields(state) : bunFields(state)),
        Card('Payload Preview', payloadPreview(state, finalName)),
        HStack([
          Button('Cancel', () => {
            state.launcherNotice = 'Create app cancelled'
          }, { role: 'cancel' }),
          Button('Create', () => createLauncherApp(state, finalName), { disabled: !ready }),
        ], { spacing: 1 }),
        ...(state.launcherNotice ? [Text(state.launcherNotice).foregroundColor('green')] : []),
      ]),
    ])
  },
}

function shellFields(state: ClientPageState) {
  return [
    Text('Launch command').fontWeight('bold'),
    TextField(stateBinding(state, 'createShellRun', ''), { placeholder: 'bun run start' }).frame({ maxWidth: -1 }),
    Text('Launch directory').fontWeight('bold'),
    TextField(stateBinding(state, 'createShellDirectory', ''), { placeholder: 'Optional' }).frame({ maxWidth: -1 }),
    Text('Install script').fontWeight('bold'),
    TextField(stateBinding(state, 'createShellInstall', ''), { placeholder: 'Optional multiline install commands', multiline: true }).frame({ maxWidth: -1, height: 3 }),
    Text('Uninstall script').fontWeight('bold'),
    TextField(stateBinding(state, 'createShellUninstall', ''), { placeholder: 'Optional multiline uninstall commands', multiline: true }).frame({ maxWidth: -1, height: 3 }),
  ]
}

function bunFields(state: ClientPageState) {
  return [
    Text('GitHub Repo').fontWeight('bold'),
    TextField(stateBinding(state, 'createBunRepo', ''), { placeholder: 'owner/repo' }).frame({ maxWidth: -1 }),
  ]
}

function payloadPreview(state: ClientPageState, name: string) {
  const mode = state.createAppMode ?? 'Shell'
  if (mode === 'Bun') {
    return [
      Text(`name: ${name || '-'}`),
      Text('active: true'),
      Text(`restarts: ${state.createAppRestarts ? 'true' : 'false'}`),
      Text(`setup: bun ${state.createBunRepo || '-'}`),
    ]
  }
  return [
    Text(`name: ${name || '-'}`),
    Text('active: true'),
    Text(`restarts: ${state.createAppRestarts ? 'true' : 'false'}`),
    Text(`run: ${state.createShellRun || '-'}`),
    Text(`directory: ${state.createShellDirectory || '(omitted)'}`),
    Text(`install commands: ${splitLines(state.createShellInstall ?? '').length}`),
    Text(`uninstall commands: ${splitLines(state.createShellUninstall ?? '').length}`),
  ]
}

function createLauncherApp(state: ClientPageState, name: string): void {
  if (!createAppReady(state)) {
    state.launcherNotice = 'Create app payload is incomplete'
    return
  }
  const app = {
    id: name,
    name,
    active: true,
    restarts: state.createAppRestarts ?? true,
    instances: 1,
    processes: [],
  }
  state.launcherApps = [...(state.launcherApps ?? []).filter(row => (row.id ?? row.name) !== name), app]
  state.selectedLauncherAppId = name
  state.editAppName = name
  state.launcherNotice = `${name} create action prepared`
}

function createAppReady(state: ClientPageState): boolean {
  return Boolean(defaultAppName(state))
}

function defaultAppName(state: ClientPageState): string {
  if ((state.createAppName ?? '').trim()) return (state.createAppName ?? '').trim()
  if ((state.createAppMode ?? 'Shell') === 'Bun') {
    const parts = (state.createBunRepo ?? '').trim().split('/').filter(Boolean)
    return parts.length >= 2 ? titleName(parts[1]!) : ''
  }
  return (state.createShellRun ?? '').trim().split(/\s+/)[0] ?? ''
}

function splitLines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean)
}

function titleName(value: string): string {
  return value.trim().replace(/[-_]+/g, ' ')
}
