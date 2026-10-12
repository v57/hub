import { Button, ForEach, HStack, ScrollView, Spacer, Terminal, Text, VStack } from '../index'

type ColumnId = 'todo' | 'doing' | 'done'
type Card = { id: string; title: string; column: ColumnId }

const terminal = new Terminal()

let selectedId = 'layout'
let cards: Card[] = [
  { id: 'layout', title: 'Layout examples', column: 'todo' },
  { id: 'forms', title: 'Form validation', column: 'todo' },
  { id: 'task', title: 'Task refresh', column: 'doing' },
  { id: 'readme', title: 'README index', column: 'done' },
]

const columns: Array<{ id: ColumnId; title: string }> = [
  { id: 'todo', title: 'Todo' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
]

function move(card: Card, step: number) {
  const index = columns.findIndex(column => column.id === card.column)
  const next = columns[Math.max(0, Math.min(columns.length - 1, index + step))]!.id
  cards = cards.map(item => (item.id === card.id ? { ...item, column: next } : item))
}

function CardView(card: Card) {
  const selected = selectedId === card.id
  return VStack(
    [
      Button(`${selected ? '*' : ' '} ${card.title}`, () => { selectedId = card.id }).frame({ maxWidth: -1, alignment: 'leading' }),
      HStack([Button('<', () => move(card, -1)), Spacer({ minLength: 1 }), Button('>', () => move(card, 1))]),
    ],
    { spacing: 1 },
  ).padding({ horizontal: 1 }).foregroundColor(selected ? 'cyan' : 'primary').id(card.id)
}

function Column(column: { id: ColumnId; title: string }) {
  const items = cards.filter(card => card.column === column.id)
  return VStack(
    [
      HStack([Text(column.title).fontWeight('bold'), Spacer({ minLength: 1 }), Text(String(items.length)).foregroundColor('secondary')]),
      ScrollView(
        VStack([
          ForEach(
            items,
            card => card.id,
            card => CardView(card),
          ),
        ], { spacing: 1 }),
        { axis: 'vertical' },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }).padding(1).id(column.id)
}

terminal.display(() =>
  VStack(
    [
      Text('Kanban').fontWeight('bold').foregroundColor('cyan'),
      HStack(
        columns.map(column => Column(column)),
        { spacing: 1 },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }),
)
