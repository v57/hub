import { Alert, Button, CommandPalette, Dialog, HStack, Spacer, State, Terminal, Text, VStack } from '../index'

const terminal = new Terminal()

const paletteOpen = State(true)
const confirmOpen = State(false)
const alertOpen = State(false)
const status = State('Choose a command')

function runBuild() {
  status.set('Build queued')
  alertOpen.set(true)
}

terminal.display(() =>
  VStack(
    [
      HStack([
        Text('Command Workflow').fontWeight('bold').foregroundColor('cyan'),
        Spacer({ minLength: 1 }),
        Button('Commands', () => paletteOpen.set(true)),
      ]),
      Text(() => status.get()).foregroundColor('secondary'),
      Button('Danger Action', () => confirmOpen.set(true), { role: 'destructive' }),
      CommandPalette(paletteOpen, [
        { label: 'Run Build', action: runBuild },
        { label: 'Open Confirm Dialog', action: () => confirmOpen.set(true) },
        { label: 'Dismiss', action: () => status.set('Dismissed'), role: 'cancel' },
      ]),
      Dialog(confirmOpen, 'This action updates local example state only.', {
        title: 'Confirm Action',
        actions: [
          { label: 'Cancel', role: 'cancel' },
          { label: 'Run', role: 'destructive', action: () => status.set('Danger action accepted') },
        ],
      }),
      Alert(alertOpen, {
        title: 'Queued',
        message: 'Build command accepted.',
        actions: [{ label: 'OK' }],
      }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }).padding(1),
)
