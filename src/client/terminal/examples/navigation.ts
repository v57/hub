import { HStack, NavigationLink, NavigationStack, ScrollView, Spacer, Terminal, Text, VStack, type Binding } from '../index'

type Item = {
  id: string
  title: string
  detail: string
}

function binding<T>(get: () => T, set: (value: T) => void): Binding<T> {
  return { get, set }
}

const terminal = new Terminal()

let path: string[] = []

const items: Item[] = [
  { id: 'layout', title: 'Layout Engine', detail: 'Stacks measure fixed and flexible children before rendering.' },
  { id: 'focus', title: 'Focus Routing', detail: 'Arrow keys choose the next control by terminal geometry.' },
  { id: 'tasks', title: 'Visible Tasks', detail: 'Async tasks start only while their view is visible.' },
  { id: 'diff', title: 'Diff Writer', detail: 'Terminal output rewrites only changed rows after the first frame.' },
]

function selectedItem(id: string) {
  return items.find(item => item.id === id) ?? items[0]!
}

function Master() {
  return VStack(
    [
      Text('Navigation').fontWeight('bold').foregroundColor('cyan'),
      Text('Choose a topic').foregroundColor('secondary'),
      ScrollView(
        VStack(
          items.map(item =>
            NavigationLink(item.title, item.id)
              .frame({ maxWidth: -1, alignment: 'leading' })
              .id(item.id),
          ),
          { spacing: 1 },
        ),
        { axis: 'vertical' },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
    ],
    { spacing: 1 },
  )
}

function Detail(id: string) {
  const item = selectedItem(id)
  return VStack(
    [
      HStack([Text(item.title).fontWeight('bold').foregroundColor('cyan'), Spacer({ minLength: 1 }), Text(item.id).foregroundColor('secondary')]),
      Text(item.detail, { wrap: true }),
    ],
    { spacing: 1 },
  ).padding(1)
}

terminal.display(() =>
  NavigationStack(
    binding(() => path, value => {
      path = value
    }),
    Master,
    Detail,
  ).frame({ maxWidth: -1, maxHeight: -1 }),
)
