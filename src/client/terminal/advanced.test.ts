import { expect, test } from 'bun:test'
import {
  Alert,
  AsyncValue,
  Button,
  CommandPalette,
  Grid,
  GridColumn,
  LazyForEach,
  List,
  MemoryTerminalDevice,
  OutlineGroup,
  State,
  ScrollView,
  Table,
  TaskHost,
  Terminal,
  Text,
  TextField,
  Timer,
  Toggle,
  VStack,
  binding,
  constant,
  derived,
  parseTerminalKeyInput,
  renderViewToString,
  type RowId,
} from './index'
import { Grid as GridFromPath } from './views/Grid'
import { List as ListFromPath } from './views/List'
import { Alert as AlertFromPath } from './views/Overlay'
import { TaskHost as TaskHostFromPath } from './views/TaskHost'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

test('state helpers create mutable, constant, derived, and downstream bindings', () => {
  const count = State(1)
  count.set(2)
  expect(count.get()).toBe(2)
  expect(count.value).toBe(2)

  const fixed = constant('A')
  fixed.set('B')
  expect(fixed.get()).toBe('A')

  let source = 4
  const doubled = derived(() => source * 2, value => {
    source = value / 2
  })
  expect(doubled.get()).toBe(8)
  doubled.set(10)
  expect(source).toBe(5)

  const custom = binding(() => source, value => {
    source = value
  })
  custom.set(9)
  expect(custom.get()).toBe(9)

  const enabled = State(false)
  const device = new MemoryTerminalDevice({ width: 12, height: 1 })
  const terminal = new Terminal(device)
  terminal.display(() => Toggle('Enabled', enabled))
  device.emitKey({ key: 'enter' })
  expect(enabled.get()).toBe(true)
  terminal.stop()
})

test('disabled and loading controls render state and block activation', () => {
  let saves = 0
  const text = State('')
  const device = new MemoryTerminalDevice({ width: 18, height: 3 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    VStack([
      Button('Save', () => { saves += 1 }, { disabled: true }),
      Button('Install', () => { saves += 10 }, { loading: true }),
      TextField(text, { placeholder: 'Name', disabled: true }),
    ]),
  )

  device.emitKey({ key: 'enter' })
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'enter' })
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'char', char: 'x' })

  expect(saves).toBe(0)
  expect(text.get()).toBe('')
  expect(device.writes.at(-1)).toContain('\x1b[90m')
  expect(device.writes.at(-1)).toContain('... Install')
  terminal.stop()
})

test('List navigates, activates, clips, and preserves stable selection through reorder', async () => {
  let rows = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ]
  const selection = State<RowId | undefined>('a')
  let activated = ''
  const device = new MemoryTerminalDevice({ width: 8, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() => List(() => rows, 'id', row => Text(row.label), { selection, onActivate: row => { activated = row.id } }))
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'enter' })
  expect(selection.get()).toBe('b')
  expect(activated).toBe('b')

  rows = [rows[2]!, rows[1]!, rows[0]!]
  terminal.setNeedsUpdate()
  await Bun.sleep(120)
  expect(selection.get()).toBe('b')
  expect(stripAnsi(device.writes.at(-1) ?? '')).toContain('Beta')
  terminal.stop()
})

test('Table renders headers, sizes columns, selects rows, and activates selected row', () => {
  const rows = [
    { id: 'api', name: 'API', status: 'OK' },
    { id: 'db', name: 'Database', status: 'Slow' },
  ]
  const selection = State<RowId | undefined>('api')
  let activated = ''
  const device = new MemoryTerminalDevice({ width: 18, height: 4 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    Table(rows, 'id', [
      { header: 'Name', width: { flexible: 1, min: 6 }, cell: 'name' },
      { header: 'Status', width: 6, cell: 'status' },
    ], { selection, onActivate: row => { activated = row.id } }),
  )

  expect(stripAnsi(device.writes.at(-1) ?? '')).toContain('Name')
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'enter' })
  expect(selection.get()).toBe('db')
  expect(activated).toBe('db')
  terminal.stop()
})

test('OutlineGroup expands, collapses, preserves selection, and cancels hidden child work', async () => {
  type Node = { id: string; name: string; children?: Node[] }
  const nodes: Node[] = [{ id: 'root', name: 'Root', children: [{ id: 'child', name: 'Child' }] }]
  const expanded = State<RowId[]>(['root'])
  const selection = State<RowId | undefined>('root')
  let aborted = 0
  const device = new MemoryTerminalDevice({ width: 12, height: 3 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    OutlineGroup(nodes, node =>
      node.id === 'child'
        ? Text(node.name).task('child', context => {
            context.signal.addEventListener('abort', () => {
              aborted += 1
            })
          })
        : Text(node.name),
    { id: 'id', children: 'children', expanded, selection }),
  )

  await Bun.sleep(120)
  expect(stripAnsi(device.writes.at(-1) ?? '')).toContain('Child')
  device.emitKey({ key: 'left' })
  await Bun.sleep(120)
  expect(expanded.get()).toEqual([])
  expect(aborted).toBe(1)
  terminal.stop()
})

test('LazyForEach builds only visible rows and keeps visible identity under scroll', async () => {
  const built: number[] = []
  const rows = Array.from({ length: 10 }, (_, id) => ({ id }))
  const device = new MemoryTerminalDevice({ width: 4, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    LazyForEach(rows, 'id', row => {
      built.push(row.id)
      return Text(String(row.id))
    }).id('lazy'),
  )

  expect(built).toEqual([0, 1])
  built.length = 0
  const offset = State(2)
  terminal.display(() =>
    ScrollView(
      LazyForEach(rows, 'id', row => {
        built.push(row.id)
        return Text(String(row.id))
      }),
      { offset },
    ).frame({ width: 4, height: 2, alignment: 'topLeading' }),
  )
  await Bun.sleep(120)
  expect(built).toEqual([2, 3])

  expect(renderViewToString(Grid(rows.slice(0, 4), 'id', [GridColumn.adaptive(2)], row => Text(String(row.id))), { width: 5, height: 2 })).toBe('0  1 \n2  3 ')
  expect(offset.get()).toBe(2)
  terminal.stop()
})

test('TaskHost and AsyncValue run, update, retry, and cancel through terminal lifecycle', async () => {
  let started = 0
  let aborted = 0
  let ticks = 0
  let attempts = 0
  const device = new MemoryTerminalDevice({ width: 20, height: 3 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    VStack([
      TaskHost('host', context => {
        started += 1
        context.signal.addEventListener('abort', () => {
          aborted += 1
        })
      }),
      Timer(20, () => {
        ticks += 1
      }),
      AsyncValue(
        'load',
        async () => {
          attempts += 1
          if (attempts === 1) throw new Error('offline')
          return 'Loaded'
        },
        value => Text(value),
        { error: (_error, retry) => Button('Retry', retry) },
      ),
    ]),
  )

  await Bun.sleep(120)
  expect(started).toBe(1)
  expect(ticks).toBeGreaterThan(0)
  expect(stripAnsi(device.writes.at(-1) ?? '')).toContain('Retry')
  device.emitKey({ key: 'enter' })
  await Bun.sleep(300)
  expect(stripAnsi(device.writes.at(-1) ?? '')).toContain('Loaded')
  terminal.stop()
  expect(aborted).toBe(1)
})

test('overlays render above content, trap focus, close with Escape, and command palette filters actions', async () => {
  const open = State(true)
  const palette = State(false)
  let base = 0
  let action = ''
  const device = new MemoryTerminalDevice({ width: 28, height: 8 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    VStack([
      Button('Base', () => { base += 1 }),
      Alert(open, { title: 'Confirm', message: 'Proceed?', actions: [{ label: 'OK', action: () => { action = 'ok' } }] }),
      CommandPalette(palette, [
        { label: 'Open File', action: () => { action = 'open' } },
        { label: 'Close Tab', action: () => { action = 'close' } },
      ]),
    ]),
  )

  expect(stripAnsi(device.writes.at(-1) ?? '')).toContain('Confirm')
  device.emitKey({ key: 'enter' })
  expect(action).toBe('ok')
  expect(base).toBe(0)

  palette.set(true)
  terminal.setNeedsUpdate()
  await Bun.sleep(120)
  device.emitKey({ key: 'char', char: 'c' })
  await Bun.sleep(120)
  expect(stripAnsi(device.writes.at(-1) ?? '')).toContain('Close Tab')
  device.emitKey({ key: 'escape' })
  await Bun.sleep(120)
  expect(palette.get()).toBe(false)
  terminal.stop()
})

test('terminal parser emits Escape, modifiers, raw fallback, and opt-in mouse events', () => {
  expect(parseTerminalKeyInput('\u001b')).toEqual([{ key: 'escape', raw: '\u001b' }])
  expect(parseTerminalKeyInput('\u000f')).toEqual([{ key: 'char', char: 'o', modifiers: ['ctrl'], raw: '\u000f' }])
  expect(parseTerminalKeyInput('\u001b[1;5A')).toEqual([{ key: 'up', modifiers: ['ctrl'], raw: '\u001b[1;5A' }])
  expect(parseTerminalKeyInput('\u001bx')).toEqual([{ key: 'char', char: 'x', modifiers: ['alt'], raw: '\u001bx' }])
  expect(parseTerminalKeyInput('\u001b[999~')).toEqual([{ key: 'raw', sequence: '\u001b[999~', raw: '\u001b[999~' }])
  expect(parseTerminalKeyInput('\u001b[<0;4;5M')).toEqual([{ key: 'raw', sequence: '\u001b[<0;4;5M', raw: '\u001b[<0;4;5M' }])
  expect(parseTerminalKeyInput('\u001b[<0;4;5M', { mouse: true })).toEqual([{ key: 'mouse', action: 'down', button: 0, x: 3, y: 4, raw: '\u001b[<0;4;5M' }])
})

test('public advanced APIs import and render through package entrypoint', () => {
  expect(renderViewToString(Grid([{ id: 'a' }], 'id', [GridColumn.fixed(2), GridColumn.flexible()], row => Text(row.id)), { width: 6, height: 1 })).toContain('a')
  expect([GridFromPath, ListFromPath, AlertFromPath, TaskHostFromPath].every(value => typeof value === 'function')).toBe(true)
})

test('Grid flexible and adaptive columns respond to terminal width', () => {
  expect(renderViewToString(Grid([{ id: 'a' }, { id: 'b' }], 'id', [GridColumn.fixed(1), GridColumn.flexible({ min: 1 })], row => Text(row.id)), { width: 6, height: 1 })).toBe('a b   ')
  expect(renderViewToString(Grid([{ id: 0 }, { id: 1 }, { id: 2 }], 'id', [GridColumn.adaptive(2)], row => Text(String(row.id))), { width: 2, height: 3 })).toBe('0 \n1 \n2 ')
  expect(renderViewToString(Grid([{ id: 0 }, { id: 1 }, { id: 2 }], 'id', [GridColumn.adaptive(2)], row => Text(String(row.id))), { width: 5, height: 2 })).toBe('0  1 \n2    ')
})
