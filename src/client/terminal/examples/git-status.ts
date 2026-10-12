import { Button, ForEach, HStack, ScrollView, Spacer, Terminal, Text, VStack } from '../index'

type Change = { id: string; path: string; status: 'modified' | 'added' | 'deleted'; staged: boolean }

const terminal = new Terminal()

let selectedId = 'view'
let changes: Change[] = [
  { id: 'readme', path: 'README.md', status: 'modified', staged: true },
  { id: 'view', path: 'src/view.ts', status: 'modified', staged: false },
  { id: 'api', path: 'examples/api-monitor.ts', status: 'added', staged: false },
  { id: 'old', path: 'examples/old-demo.ts', status: 'deleted', staged: false },
]

function move(change: Change, staged: boolean) {
  changes = changes.map(item => (item.id === change.id ? { ...item, staged } : item))
}

function discard(change: Change) {
  changes = changes.filter(item => item.id !== change.id)
}

function colorFor(change: Change) {
  if (change.status === 'added') return 'green'
  if (change.status === 'deleted') return 'red'
  return 'yellow'
}

function ChangeRow(change: Change) {
  const selected = selectedId === change.id
  return HStack(
    [
      Button(`${selected ? '*' : ' '} ${change.path}`, () => { selectedId = change.id }).frame({ maxWidth: -1, alignment: 'leading' }).foregroundColor(colorFor(change)),
      Text(change.status).foregroundColor('secondary').frame({ width: 9 }),
      Button(change.staged ? 'Unstage' : 'Stage', () => move(change, !change.staged)),
      Button('Discard', () => discard(change)),
    ],
    { spacing: 1, alignment: 'center' },
  ).id(change.id)
}

function Section(title: string, staged: boolean) {
  const rows = changes.filter(change => change.staged === staged)
  return VStack(
    [
      HStack([Text(title).fontWeight('bold'), Spacer({ minLength: 1 }), Text(`${rows.length}`).foregroundColor('secondary')]),
      rows.length === 0 ? Text('Nothing here').foregroundColor('secondary') : ForEach(rows, change => change.id, change => ChangeRow(change)),
    ],
    { spacing: 1 },
  ).padding({ horizontal: 1 })
}

terminal.display(() =>
  VStack(
    [
      Text('Git Status').fontWeight('bold').foregroundColor('cyan'),
      ScrollView(
        VStack([Section('Staged', true), Section('Unstaged', false)], { spacing: 1 }),
        { axis: 'vertical' },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }),
)
