import { expect, test } from 'bun:test'
import { createWizardState, WizardApp, wizardFocusIds, type WizardState } from './wizard'
import { MemoryTerminalDevice, Terminal, type Size } from '../index'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function mountWizard(state: WizardState = createWizardState(), size: Size = { width: 64, height: 20 }) {
  const device = new MemoryTerminalDevice(size)
  const terminal = new Terminal(device)
  terminal.display(() => WizardApp(state, terminal))
  return { device, terminal, state }
}

function latestOutput(device: MemoryTerminalDevice): string {
  return stripAnsi(device.writes.at(-1) ?? '')
}

async function waitForFrame(): Promise<void> {
  await Bun.sleep(120)
}

test('wizard first step hides Back and keeps trailing Next', () => {
  const { device, terminal } = mountWizard()
  const output = latestOutput(device)
  const nextLine = output.split('\n').find(line => line.includes('[Next]')) ?? ''

  expect(output).not.toContain('[Back]')
  expect(output).not.toContain('>Back<')
  expect(output).toContain('[Next]')
  expect(nextLine.endsWith('[Next]')).toBe(true)
  terminal.stop()
})

test('wizard later steps keep Back and primary action visible', () => {
  const contact = createWizardState()
  contact.step = 1
  const contactMount = mountWizard(contact)
  expect(latestOutput(contactMount.device)).toContain('[Back]')
  expect(latestOutput(contactMount.device)).toContain('[Next]')
  contactMount.terminal.stop()

  const confirm = createWizardState()
  confirm.step = 2
  const confirmMount = mountWizard(confirm)
  expect(latestOutput(confirmMount.device)).toContain('[Back]')
  expect(latestOutput(confirmMount.device)).toContain('[Submit]')
  confirmMount.terminal.stop()
})

test('wizard Down from profile and contact content focuses Next', async () => {
  const profile = mountWizard()
  profile.terminal.focus(wizardFocusIds.profileInput)
  await waitForFrame()
  profile.device.emitKey({ key: 'down' })
  await waitForFrame()
  expect(latestOutput(profile.device)).toContain('>Next<')
  profile.terminal.stop()

  const contactState = createWizardState()
  contactState.step = 1
  const contact = mountWizard(contactState)
  contact.terminal.focus(wizardFocusIds.contactInput)
  await waitForFrame()
  contact.device.emitKey({ key: 'down' })
  await waitForFrame()
  expect(latestOutput(contact.device)).toContain('>Next<')
  expect(latestOutput(contact.device)).not.toContain('>Back<')
  contact.terminal.stop()
})

test('wizard entering confirm focuses terms once and Down selects Submit', async () => {
  const state = createWizardState()
  state.step = 1
  state.name = 'Ada'
  state.email = 'ada@example.com'
  const { device, terminal } = mountWizard(state)

  terminal.focus(wizardFocusIds.primaryAction)
  await waitForFrame()
  device.emitKey({ key: 'enter' })
  await waitForFrame()
  expect(state.step).toBe(2)
  expect(latestOutput(device)).toContain('>[ ] Accept terms')

  device.emitKey({ key: 'down' })
  await waitForFrame()
  expect(latestOutput(device)).toContain('>Submit<')

  terminal.setNeedsUpdate()
  await waitForFrame()
  expect(latestOutput(device)).toContain('>Submit<')
  terminal.stop()
})

test('wizard validation, Back, terms toggle, and Submit behavior stay unchanged', async () => {
  const { device, terminal, state } = mountWizard()

  terminal.focus(wizardFocusIds.primaryAction)
  await waitForFrame()
  device.emitKey({ key: 'enter' })
  await waitForFrame()
  expect(state.step).toBe(0)

  state.name = 'Ada'
  terminal.focus(wizardFocusIds.primaryAction)
  await waitForFrame()
  device.emitKey({ key: 'enter' })
  await waitForFrame()
  expect(state.step).toBe(1)

  terminal.focus(wizardFocusIds.backAction)
  await waitForFrame()
  device.emitKey({ key: 'enter' })
  await waitForFrame()
  expect(state.step).toBe(0)

  state.step = 2
  state.email = 'ada@example.com'
  state.acceptTerms = false
  state.submitted = false
  terminal.focus(wizardFocusIds.primaryAction)
  await waitForFrame()
  device.emitKey({ key: 'enter' })
  await waitForFrame()
  expect(state.submitted).toBe(false)

  terminal.focus(wizardFocusIds.terms)
  await waitForFrame()
  device.emitKey({ key: 'enter' })
  await waitForFrame()
  expect(state.acceptTerms).toBe(true)

  terminal.focus(wizardFocusIds.primaryAction)
  await waitForFrame()
  device.emitKey({ key: 'enter' })
  await waitForFrame()
  expect(state.submitted).toBe(true)
  terminal.stop()
})
