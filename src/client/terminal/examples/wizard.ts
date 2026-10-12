import { Button, HStack, MemoryTerminalDevice, ProgressBar, Spacer, Terminal, Text, TextField, Toggle, VStack, type Binding } from '../index'
import type { ViewNode } from '../view/base'

function binding<T>(get: () => T, set: (value: T) => void): Binding<T> {
  return { get, set }
}

export type WizardState = {
  step: number
  name: string
  email: string
  acceptTerms: boolean
  submitted: boolean
}

export const wizardFocusIds = {
  profileInput: 'wizard-profile-input',
  contactInput: 'wizard-contact-input',
  terms: 'wizard-terms',
  backAction: 'wizard-back-action',
  primaryAction: 'wizard-primary-action',
} as const

const steps = ['Profile', 'Contact', 'Confirm']

export function createWizardState(): WizardState {
  return {
    step: 0,
    name: '',
    email: '',
    acceptTerms: false,
    submitted: false,
  }
}

function stepValid(state: WizardState, index: number) {
  if (index === 0) return state.name.trim().length > 0
  if (index === 1) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(state.email)
  return state.acceptTerms
}

export function WizardApp(state: WizardState = createWizardState(), terminal?: Pick<Terminal, 'focus'>): ViewNode {
  const focusPrimary = () => terminal?.focus(wizardFocusIds.primaryAction)

  const next = () => {
    if (state.step < steps.length - 1 && stepValid(state, state.step)) {
      state.step += 1
      if (state.step === steps.length - 1) terminal?.focus(wizardFocusIds.terms)
    } else if (state.step === steps.length - 1 && stepValid(state, state.step)) {
      state.submitted = true
    }
  }

  const back = () => {
    state.step = Math.max(0, state.step - 1)
  }

  const StepContent = () => {
    if (state.step === 0) {
      return VStack([
        Text('Name'),
        TextField(binding(() => state.name, value => { state.name = value; state.submitted = false }), { placeholder: 'Ada Lovelace', onSubmit: next })
          .frame({ maxWidth: -1 })
          .focusId(wizardFocusIds.profileInput)
          .keyBinding('down', 'Next', focusPrimary),
      ], { spacing: 1 }).id('profile')
    }
    if (state.step === 1) {
      return VStack([
        Text('Email'),
        TextField(binding(() => state.email, value => { state.email = value; state.submitted = false }), { placeholder: 'ada@example.com', onSubmit: next })
          .frame({ maxWidth: -1 })
          .focusId(wizardFocusIds.contactInput)
          .keyBinding('down', 'Next', focusPrimary),
      ], { spacing: 1 }).id('contact')
    }
    return VStack(
      [
        Text(`Name: ${state.name || '-'}`),
        Text(`Email: ${state.email || '-'}`),
        Toggle('Accept terms', binding(() => state.acceptTerms, value => { state.acceptTerms = value; state.submitted = false }))
          .focusId(wizardFocusIds.terms)
          .keyBinding('down', 'Submit', focusPrimary),
      ],
      { spacing: 1 },
    ).id('confirm')
  }

  const valid = stepValid(state, state.step)
  return VStack(
    [
      HStack([Text('Setup Wizard').fontWeight('bold').foregroundColor('cyan'), Spacer({ minLength: 1 }), Text(`${state.step + 1}/${steps.length}`).foregroundColor('secondary')]),
      ProgressBar((state.step + 1) / steps.length).frame({ maxWidth: -1 }),
      Text(steps.map((item, index) => (index === state.step ? `[${item}]` : ` ${item} `)).join(' > ')),
      StepContent().frame({ maxWidth: -1, maxHeight: -1 }).padding(1),
      Text(valid ? (state.submitted ? 'Submitted' : 'Ready') : 'Complete required fields').foregroundColor(valid ? 'green' : 'red'),
      HStack([
        ...(state.step > 0 ? [Button('Back', back).focusId(wizardFocusIds.backAction)] : []),
        Spacer({ minLength: 1 }),
        Button(state.step === steps.length - 1 ? 'Submit' : 'Next', next).focusId(wizardFocusIds.primaryAction),
      ], { spacing: 1 }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 })
}

export function runWizardExample(smoke = false): void {
  const state = createWizardState()
  if (smoke) {
    const device = new MemoryTerminalDevice({ width: 64, height: 14 })
    const terminal = new Terminal(device)
    terminal.display(() => WizardApp(state, terminal))
    terminal.stop()
    process.stdout.write(device.writes.at(-1) ?? '')
    return
  }

  const terminal = new Terminal()
  terminal.display(() => WizardApp(state, terminal))
}

if (import.meta.main) runWizardExample(process.env.DISPLAY_SMOKE === '1')
