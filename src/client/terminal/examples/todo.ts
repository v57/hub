import { Button, ForEach, HStack, Picker, ScrollView, Spacer, Terminal, Text, TextField, Toggle, VStack, type Binding } from '../index'

type Filter = 'All' | 'Active' | 'Done'
type Todo = { id: string; title: string; done: boolean }

function binding<T>(get: () => T, set: (value: T) => void): Binding<T> {
  return { get, set }
}

const terminal = new Terminal()

let filter: Filter = 'All'
let draft = ''
let editingId = 'build'
let editText = 'Build examples catalog'
let todos: Todo[] = [
  { id: 'build', title: 'Build examples catalog', done: false },
  { id: 'readme', title: 'Document every example', done: false },
  { id: 'smoke', title: 'Smoke-run entrypoints', done: true },
]

function visibleTodos() {
  if (filter === 'Active') return todos.filter(todo => !todo.done)
  if (filter === 'Done') return todos.filter(todo => todo.done)
  return todos
}

function addTodo() {
  const title = draft.trim()
  if (!title) return
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID()
  todos = [...todos, { id, title, done: false }]
  draft = ''
}

function TodoRow(todo: Todo) {
  const isEditing = editingId === todo.id
  return HStack(
    [
      Toggle('', binding(() => todo.done, value => {
        todos = todos.map(item => (item.id === todo.id ? { ...item, done: value } : item))
      })).frame({ width: 5 }),
      isEditing
        ? TextField(binding(() => editText, value => { editText = value }), {
            placeholder: 'Todo title',
            onSubmit: () => {
              const title = editText.trim()
              if (title) todos = todos.map(item => (item.id === todo.id ? { ...item, title } : item))
            },
          }).frame({ maxWidth: -1 })
        : Text(todo.title, { truncation: 'tail' }).frame({ maxWidth: -1 }).foregroundColor(todo.done ? 'secondary' : 'primary'),
      Button(isEditing ? 'Save' : 'Edit', () => {
        editingId = todo.id
        editText = todo.title
      }),
    ],
    { spacing: 1, alignment: 'center' },
  ).id(todo.id)
}

terminal.display(() =>
  VStack(
    [
      HStack([Text('Todo').fontWeight('bold').foregroundColor('cyan'), Spacer({ minLength: 1 }), Picker('Filter', ['All', 'Active', 'Done'] as Filter[], binding(() => filter, value => { filter = value }))]),
      ScrollView(
        VStack([
          ForEach(
            visibleTodos,
            todo => todo.id,
            todo => TodoRow(todo),
          ),
        ]),
        { axis: 'vertical' },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
      HStack(
        [
          TextField(binding(() => draft, value => { draft = value }), { placeholder: 'New todo', onSubmit: addTodo }).frame({ maxWidth: -1 }),
          Button('Add', addTodo),
        ],
        { spacing: 1 },
      ),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }),
)
