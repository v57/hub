import { Button, HStack, MemoryTerminalDevice, Picker, ScrollView, Spacer, Terminal, Text, TextField, Toggle, VStack, type Binding } from '../index'

type Theme = 'System' | 'Light' | 'Dark'
type Density = 'Comfortable' | 'Compact'

export type SettingsFormState = {
  theme: Theme
  density: Density
  projectName: string
  refresh: string
  autoSave: boolean
  telemetry: boolean
  submitted: boolean
}

function binding<T>(get: () => T, set: (value: T) => void): Binding<T> {
  return { get, set }
}

export function createSettingsFormState(): SettingsFormState {
  return {
    theme: 'System',
    density: 'Comfortable',
    projectName: 'display',
    refresh: '10',
    autoSave: true,
    telemetry: false,
    submitted: false,
  }
}

export function settingsFormErrors(state: SettingsFormState): string[] {
  const result: string[] = []
  if (!state.projectName.trim()) result.push('Project name required')
  if (!/^\d+$/.test(state.refresh) || Number(state.refresh) < 1) result.push('Refresh must be positive seconds')
  return result
}

export function createSettingsFormView(state: SettingsFormState = createSettingsFormState()) {
  const formErrors = settingsFormErrors(state)
  const canSubmit = formErrors.length === 0
  return VStack(
    [
      HStack([Text('Settings').fontWeight('bold').foregroundColor('cyan'), Spacer({ minLength: 1 }), Text(state.submitted ? 'Saved' : 'Unsaved').foregroundColor(state.submitted ? 'green' : 'yellow')]),
      ScrollView(
        VStack(
          [
            Text('Project'),
            TextField(binding(() => state.projectName, value => { state.projectName = value; state.submitted = false }), { placeholder: 'Project name' }).frame({ maxWidth: -1 }),
            VStack(
              [
                Text('Refresh seconds').foregroundColor('secondary'),
                TextField(binding(() => state.refresh, value => { state.refresh = value; state.submitted = false }), { placeholder: '10' }).frame({ maxWidth: -1 }),
              ],
              { spacing: 0 },
            ),
            Picker('Theme', ['System', 'Light', 'Dark'] as Theme[], binding(() => state.theme, value => { state.theme = value; state.submitted = false })),
            Picker('Density', ['Comfortable', 'Compact'] as Density[], binding(() => state.density, value => { state.density = value; state.submitted = false })),
            Toggle('Auto save', binding(() => state.autoSave, value => { state.autoSave = value; state.submitted = false })),
            Toggle('Anonymous telemetry', binding(() => state.telemetry, value => { state.telemetry = value; state.submitted = false })),
            formErrors.length === 0 ? Text('Validation passed').foregroundColor('green') : VStack(formErrors.map(error => Text(error).foregroundColor('red'))),
          ],
          { spacing: 1 },
        ),
        { axis: 'vertical' },
      ).frame({ maxWidth: -1, maxHeight: -1 }).padding({ horizontal: 1 }),
      Button(canSubmit ? 'Save Settings' : 'Fix Errors', () => {
        if (canSubmit) state.submitted = true
      }).foregroundColor(canSubmit ? 'green' : 'red'),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 })
}

export function runSettingsFormExample(smoke = false): void {
  const state = createSettingsFormState()
  if (smoke) {
    const device = new MemoryTerminalDevice({ width: 50, height: 18 })
    const terminal = new Terminal(device)
    terminal.display(() => createSettingsFormView(state))
    terminal.stop()
    process.stdout.write(device.writes.at(-1) ?? '')
    return
  }

  new Terminal().display(() => createSettingsFormView(state))
}

if (import.meta.main) runSettingsFormExample(process.env.DISPLAY_SMOKE === '1')
