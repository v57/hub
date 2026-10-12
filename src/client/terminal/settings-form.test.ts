import { expect, test } from 'bun:test'
import { MemoryTerminalDevice, Terminal, renderViewToString } from './index'
import { createSettingsFormState, createSettingsFormView, settingsFormErrors } from './examples/settings-form'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function renderedLines(refresh = '10'): string[] {
  const state = createSettingsFormState()
  state.refresh = refresh
  return stripAnsi(renderViewToString(createSettingsFormView(state), { width: 50, height: 18 })).split('\n')
}

test('settings refresh field renders compact secondary label', () => {
  const output = renderViewToString(createSettingsFormView(createSettingsFormState()), { width: 50, height: 18 })
  const lines = stripAnsi(output).split('\n')
  const labelIndex = lines.findIndex(line => line.includes('Refresh seconds'))

  expect(output).toContain('\x1b[90mRefresh seconds\x1b[39m')
  expect(labelIndex).toBeGreaterThan(-1)
  expect(lines[labelIndex + 1]?.trim()).toBe('10')
  expect(lines[labelIndex - 1]?.trim()).toBe('')
  expect(lines[labelIndex + 2]?.trim()).toBe('')
  expect(lines[labelIndex + 3]).toContain('Theme: System')
})

test('settings refresh validation stays unchanged', () => {
  for (const refresh of ['', 'abc', '0']) {
    const state = createSettingsFormState()
    state.refresh = refresh
    expect(settingsFormErrors(state)).toContain('Refresh must be positive seconds')
  }

  const emptyRefreshLines = renderedLines('')
  const labelIndex = emptyRefreshLines.findIndex(line => line.includes('Refresh seconds'))
  expect(emptyRefreshLines[labelIndex + 1]?.trim()).toBe('10')
  expect(emptyRefreshLines.some(line => line.includes('Refresh must be positive seconds'))).toBe(true)
})

test('settings refresh field keeps binding and unsaved edit behavior', () => {
  const state = createSettingsFormState()
  state.submitted = true
  const device = new MemoryTerminalDevice({ width: 50, height: 18 })
  const terminal = new Terminal(device)

  terminal.display(() => createSettingsFormView(state))
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'char', char: '5' })

  expect(state.refresh).toBe('105')
  expect(state.submitted).toBe(false)
  terminal.stop()
})
