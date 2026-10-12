import { expect, test } from 'bun:test'
import {
  Alert,
  Button,
  CopyButton,
  ForEach,
  HStack,
  List,
  MemoryTerminalDevice,
  NavigationBackButton,
  NavigationLink,
  NavigationStack,
  PanelSection,
  Picker,
  ProgressBar,
  ScrollView,
  Spacer,
  TabBar,
  Terminal,
  Text,
  TextField,
  Toggle,
  StatusBadge,
  VStack,
  ansi256,
  renderViewToString,
  diffAnsiFrames,
  type Binding,
  type ContextMenuAction,
  type KeyBinding,
  type KeyBindingAction,
  type NavigationController,
  type NavigationRouteValue,
  type ScrollOptions,
  type SpacerOptions,
  type StackOptions,
  type TaskContext,
  type TextFieldOptions,
  type TextOptions,
} from './index'
import type { RenderContext, ViewNode } from './view'

function binding<T>(initial: T): Binding<T> & { value: T } {
  return {
    value: initial,
    get() {
      return this.value
    },
    set(value) {
      this.value = value
    },
  }
}

function topLayerProbeView(): ViewNode {
  const view = {
    measure: () => ({ width: 4, height: 1 }),
    render: (_bounds: { x: number; y: number; width: number; height: number }, context: RenderContext) => {
      context.buffer.write(0, 0, 'base', context.clip)
      context.registerTopLayer(() => context.buffer.write(0, 0, '1111', context.clip))
      context.registerTopLayer(() => context.buffer.write(0, 0, '2222', context.clip))
    },
    frame: () => view as ViewNode,
    foregroundColor: () => view as ViewNode,
    fontWeight: () => view as ViewNode,
    padding: () => view as ViewNode,
    background: () => view as ViewNode,
    contextMenu: () => view as ViewNode,
    keyBinding: () => view as ViewNode,
    focusId: () => view as ViewNode,
    id: () => view as ViewNode,
    task: () => view as ViewNode,
    visible: () => view as ViewNode,
    setNeedsUpdate: () => {},
    installRuntime: (_runtime: unknown, _path: string) => {},
  }
  return view as ViewNode
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

test('Text and VStack render vertical content', () => {
  expect(renderViewToString(VStack([Text('A'), Text('B')]), { width: 3, height: 2 })).toBe('A  \nB  ')
})

test('foregroundColor modifier applies named terminal colors', () => {
  expect(renderViewToString(Text('A').foregroundColor('secondary'), { width: 2, height: 1 })).toBe('\x1b[90mA\x1b[39m ')
  expect(renderViewToString(Text('A').foregroundColor(ansi256(143)), { width: 2, height: 1 })).toBe('\x1b[38;5;143mA\x1b[39m ')
})

test('fontWeight modifier applies named terminal weights', () => {
  expect(renderViewToString(Text('A').fontWeight('bold'), { width: 2, height: 1 })).toBe('\x1b[1mA\x1b[22m ')
  expect(renderViewToString(Text('A').fontWeight('regular'), { width: 2, height: 1 })).toBe('\x1b[22mA ')
})

test('HStack renders horizontal content', () => {
  expect(renderViewToString(HStack([Text('A'), Text('B')]), { width: 3, height: 1 })).toBe('AB ')
})

test('Frame centers fixed content', () => {
  expect(renderViewToString(Text('X').frame({ width: 3, height: 3, alignment: 'bottomTrailing' }), { width: 3, height: 3 })).toBe('   \n   \n  X')
})

test('visible modifier preserves layout while hiding drawing and focus', async () => {
  let hiddenCount = 0
  let shownCount = 0
  const device = new MemoryTerminalDevice({ width: 8, height: 3 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    VStack([
      Button('Hide', () => {
        hiddenCount += 1
      }).visible(false),
      Text('Spacer'),
      Button('Show', () => {
        shownCount += 1
      }),
    ]),
  )

  expect(stripAnsi(terminal.renderToString())).toBe('        \nSpacer  \n>Show<  ')

  device.emitKey({ key: 'enter' })
  await Bun.sleep(120)
  expect(hiddenCount).toBe(0)
  expect(shownCount).toBe(1)
  terminal.stop()
})

test('ScrollView clips content and supports bottom anchor', () => {
  const view = ScrollView(VStack([Text('A'), Text('B'), Text('C')]), { axis: 'vertical', anchor: 'bottom' }).frame({ width: 1, height: 2 })

  expect(renderViewToString(view, { width: 1, height: 2 })).toBe('B\nC')
})

test('ScrollView supports bound offsets, keyboard scrolling, and clamping', async () => {
  const offset = binding(0)
  const device = new MemoryTerminalDevice({ width: 1, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    ScrollView(VStack([Text('A'), Text('B'), Text('C'), Text('D')]), {
      axis: 'vertical',
      offset,
    }).frame({ width: 1, height: 2 }),
  )

  device.emitKey({ key: 'down' })
  await Bun.sleep(120)
  expect(offset.get()).toBe(1)
  expect(device.writes.at(-1)).toBe('B\nC')

  device.emitKey({ key: 'end' })
  await Bun.sleep(120)
  device.emitKey({ key: 'down' })
  await Bun.sleep(120)
  expect(offset.get()).toBe(2)
  expect(device.writes.at(-1)).toBe('C\nD')
  terminal.stop()
})

test('ScrollView lets nested controls keep keyboard selection focus', async () => {
  const rows = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ]
  const selection = binding<string | number | undefined>('a')
  const device = new MemoryTerminalDevice({ width: 8, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    ScrollView(
      List(rows, 'id', row => Text(row.label), { selection }),
      { axis: 'vertical' },
    ).frame({ width: 8, height: 2 }),
  )

  device.emitKey({ key: 'down' })
  await Bun.sleep(120)
  expect(selection.get()).toBe('b')
  terminal.stop()
})

test('ScrollView arrow keys focus nested text fields and buttons before scrolling', async () => {
  const address = binding('')
  const name = binding('')
  let connectCount = 0
  const device = new MemoryTerminalDevice({ width: 16, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    ScrollView(
      VStack([
        TextField(address, { placeholder: 'Address' }).focusId('address'),
        Button('Connect', () => {
          connectCount += 1
        }).focusId('connect'),
        Text('Details'),
        TextField(name, { placeholder: 'Name' }).focusId('name'),
      ]),
      { axis: 'vertical' },
    ).frame({ width: 16, height: 2 }),
  )

  const currentFrame = () => stripAnsi(terminal.renderToString())

  expect(currentFrame()).toContain('>Address')

  device.emitKey({ key: 'down' })
  await Bun.sleep(120)
  expect(currentFrame()).toContain('>Connect<')

  device.emitKey({ key: 'up' })
  await Bun.sleep(120)
  expect(currentFrame()).toContain('>Address')

  device.emitKey({ key: 'down' })
  await Bun.sleep(120)
  device.emitKey({ key: 'enter' })
  await Bun.sleep(120)
  expect(connectCount).toBe(1)

  device.emitKey({ key: 'down' })
  await Bun.sleep(120)
  device.emitKey({ key: 'down' })
  await Bun.sleep(120)
  expect(currentFrame()).toContain('>Name')
  terminal.stop()
})

test('keyBinding runs while wrapped view is visible and before focused controls', async () => {
  const text = binding('')
  let calls = 0
  const device = new MemoryTerminalDevice({ width: 12, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    TextField(text, { placeholder: 'Path' }).keyBinding('ctrl+o', 'Open', () => {
      calls += 1
    }),
  )

  device.emitKey({ key: 'char', char: 'o', modifiers: ['ctrl'] })
  await Bun.sleep(120)

  expect(calls).toBe(1)
  expect(text.get()).toBe('')
  terminal.stop()
})

test('keyBinding does not run after wrapped view leaves visible viewport', async () => {
  let calls = 0
  const device = new MemoryTerminalDevice({ width: 8, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    ScrollView(
      VStack([
        Text('Hidden').keyBinding('o', 'Hidden', () => {
          calls += 1
        }),
        Text('Visible'),
      ]),
      { axis: 'vertical', offset: 1 },
    ).frame({ width: 8, height: 1 }),
  )

  device.emitKey({ key: 'char', char: 'o' })
  await Bun.sleep(120)
  expect(calls).toBe(0)
  terminal.stop()
})

test('controls are disabled by default and keep root height', () => {
  const view = VStack([Text('A'), Spacer(), Text('B')]).frame({ maxWidth: -1, maxHeight: -1, alignment: 'topLeading' })

  expect(stripAnsi(renderViewToString(view, { width: 3, height: 3 }))).toBe('A  \n   \nB  ')
})

test('controls render visible titled key bindings on bottom row', () => {
  const device = new MemoryTerminalDevice({ width: 24, height: 2 })
  const terminal = new Terminal(device).controls(true)

  terminal.display(() => Text('Body').keyBinding('ctrl+o', 'Open', () => {}))

  const output = device.writes.at(-1) ?? ''
  expect(stripAnsi(output).split('\n')).toEqual(['Body                    ', 'ctrl+o Open             '])
  expect(output).toContain('\x1b[90mctrl+o Open')
  terminal.stop()
})

test('controls reserve bottom row and ignore clipped key bindings', () => {
  const device = new MemoryTerminalDevice({ width: 18, height: 2 })
  const terminal = new Terminal(device).controls(true)

  terminal.display(() =>
    ScrollView(
      VStack([
        Text('Hidden').keyBinding('h', 'Hidden', () => {}),
        Text('Shown').keyBinding('s', 'Shown', () => {}),
      ]),
      { axis: 'vertical', offset: 1 },
    ).frame({ width: 18, height: 1 }),
  )

  const lines = stripAnsi(device.writes.at(-1) ?? '').split('\n')
  expect(lines[0]).toBe('Shown             ')
  expect(lines[1]).toBe('s Shown           ')
  expect(lines[1]).not.toContain('Hidden')
  terminal.stop()
})

test('controls reserve the only row in a one-row terminal', () => {
  const device = new MemoryTerminalDevice({ width: 16, height: 1 })
  const terminal = new Terminal(device).controls(true)

  terminal.display(() => Text('Body').keyBinding('ctrl+o', 'Open', () => {}))

  expect(stripAnsi(device.writes.at(-1) ?? '')).toBe('                ')
  terminal.stop()
})

test('controls can be disabled after being enabled', async () => {
  const device = new MemoryTerminalDevice({ width: 12, height: 2 })
  const terminal = new Terminal(device).controls(true)

  terminal.display(() => Text('Body').keyBinding('ctrl+o', 'Open', () => {}))
  terminal.controls(false)
  await Bun.sleep(120)

  expect(stripAnsi(device.writes.at(-1) ?? '')).toBe('Body        \n            ')
  terminal.stop()
})

function typecheckKeyBindingRequiresTitle(view: ViewNode) {
  view.keyBinding('ctrl+o', 'Open', () => {})
  // @ts-expect-error keyBinding requires a title before the action.
  view.keyBinding('ctrl+o', () => {})
}

test('Text supports newlines, wrapping, truncation, and Unicode width', () => {
  expect(renderViewToString(Text('A\nB'), { width: 2, height: 2 })).toBe('A \nB ')
  expect(renderViewToString(Text('abcd', { wrap: true }), { width: 2, height: 2 })).toBe('ab\ncd')
  expect(renderViewToString(Text('abcdef', { truncation: 'middle' }), { width: 5, height: 1 })).toBe('ab…ef')
  expect(renderViewToString(Text('界A'), { width: 3, height: 1 })).toBe('界 A')
})

test('Spacer expands in stacks and remains empty outside stacks', () => {
  expect(renderViewToString(HStack([Text('A'), Spacer(), Text('B')]), { width: 5, height: 1 })).toBe('A   B')
  expect(renderViewToString(VStack([Text('T'), Spacer(), Text('B')]), { width: 1, height: 4 })).toBe('T\n \n \nB')
  expect(renderViewToString(HStack([Text('A'), Spacer(), Text('B'), Spacer({ minLength: 1 }), Text('C')]), { width: 8, height: 1 })).toBe('A  B   C')
  expect(renderViewToString(Spacer(), { width: 3, height: 1 })).toBe('   ')
})

test('Padding and background modifiers compose predictably', () => {
  expect(renderViewToString(Text('X').padding(1), { width: 3, height: 3 })).toBe('   \n X \n   ')
  expect(renderViewToString(Text('X').background('blue'), { width: 1, height: 1 })).toBe('\x1b[44mX\x1b[49m')
  expect(renderViewToString(Text('X').background(ansi256(143)), { width: 1, height: 1 })).toBe('\x1b[48;5;143mX\x1b[49m')
  expect(renderViewToString(Text('X').padding({ horizontal: 1 }).background('blue'), { width: 3, height: 1 })).toBe('\x1b[44m X \x1b[49m')
})

test('ForEach expands and preserves render order', () => {
  const view = VStack([ForEach(['A', 'B'], item => item, item => Text(item))])

  expect(renderViewToString(view, { width: 1, height: 2 })).toBe('A\nB')
})

test('ProgressBar supports full and compact styles', () => {
  expect(renderViewToString(ProgressBar(0.5), { width: 10, height: 1 })).toBe('#####-----')
  expect(renderViewToString(ProgressBar(0.5, { style: 'compact' }), { width: 1, height: 1 })).toBe('+')
})

test('Controls render and Enter activates focused button', () => {
  let count = 0
  const device = new MemoryTerminalDevice({ width: 12, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() => Button('Save', () => { count += 1 }))
  device.emitKey({ key: 'enter' })

  expect(count).toBe(1)
  terminal.stop()
})

test('Terminal focuses explicit focusId before display and from actions', () => {
  const text = binding('')
  const device = new MemoryTerminalDevice({ width: 20, height: 2 })
  const terminal = new Terminal(device)

  terminal.focus('draft')
  terminal.display(() =>
    VStack([
      Button('Reply', () => {
        terminal.focus('draft')
      }).focusId('reply'),
      TextField(text).focusId('draft'),
    ]),
  )

  device.emitKey({ key: 'char', char: 'a' })
  expect(text.get()).toBe('a')

  terminal.focus('reply')
  device.emitKey({ key: 'enter' })
  device.emitKey({ key: 'char', char: 'b' })
  expect(text.get()).toBe('ab')
  terminal.stop()
})

test('Button defaults to tint and TextField placeholder defaults to secondary', () => {
  const text = binding('')

  expect(renderViewToString(Button('Go', () => {}), { width: 4, height: 1 })).toBe('\x1b[38;5;208m[Go]\x1b[39m')
  expect(renderViewToString(TextField(text, { placeholder: 'Name' }), { width: 4, height: 1 })).toBe('\x1b[90mName\x1b[39m')
})

test('Toggle, Picker, TextField, and TabBar handle keyboard input', () => {
  const enabled = binding(false)
  const mode = binding('A')
  const text = binding('')
  const tab = binding('One')
  const device = new MemoryTerminalDevice({ width: 50, height: 4 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    VStack([
      Toggle('Enabled', enabled),
      Picker('Mode', ['A', 'B'], mode),
      TextField(text),
      TabBar(['One', 'Two'], tab),
    ]),
  )

  device.emitKey({ key: 'enter' })
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'enter' })
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'char', char: 'x' })
  device.emitKey({ key: 'tab' })

  expect(enabled.get()).toBe(true)
  expect(mode.get()).toBe('B')
  expect(text.get()).toBe('x')
  expect(tab.get()).toBe('Two')
  terminal.stop()
})

test('TextField supports secure and multiline input', async () => {
  const secret = binding('hunter2')
  expect(stripAnsi(renderViewToString(TextField(secret, { secure: true }), { width: 8, height: 1 }))).toBe('******* ')

  const text = binding('one')
  const device = new MemoryTerminalDevice({ width: 10, height: 3 })
  const terminal = new Terminal(device)
  terminal.display(() => TextField(text, { multiline: true }).frame({ width: 10, height: 3 }))
  device.emitKey({ key: 'enter' })
  device.emitKey({ key: 'char', char: 't' })
  device.emitKey({ key: 'char', char: 'w' })
  device.emitKey({ key: 'char', char: 'o' })
  await Bun.sleep(120)

  expect(text.get()).toBe('one\ntwo')
  expect(stripAnsi(device.writes.at(-1) ?? '').split('\n').slice(0, 2)).toEqual(['>one      ', ' two|     '])
  terminal.stop()
})

test('CopyButton, StatusBadge, and PanelSection render reusable dense page helpers', async () => {
  const copied: string[] = []
  const device = new MemoryTerminalDevice({ width: 32, height: 5 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    PanelSection('Actions', [
      CopyButton('Copy key', 'pub-key', { fallback: text => copied.push(text) }),
      StatusBadge('Ready', 'success'),
      StatusBadge('Offline', 'muted'),
    ]),
  )
  device.emitKey({ key: 'enter' })
  await Bun.sleep(120)

  expect(copied).toEqual(['pub-key'])
  expect(stripAnsi(device.writes.at(-1) ?? '').split('\n')).toEqual([
    'Actions                         ',
    '                                ',
    '>Copied<                        ',
    '                                ',
    '[Ready]                         ',
  ])
  terminal.stop()

  const failed = new MemoryTerminalDevice({ width: 20, height: 1 })
  const failedTerminal = new Terminal(failed)
  failedTerminal.display(() => CopyButton('Copy', 'x', { clipboard: { writeText: () => { throw new Error('denied') } } }))
  failed.emitKey({ key: 'enter' })
  await Bun.sleep(120)
  expect(stripAnsi(failed.writes.at(-1) ?? '')).toContain('Copy failed')
  failedTerminal.stop()
})

test('Empty controls and cursor-aware TextField editing are safe', async () => {
  const empty = binding('')
  const text = binding('abc')
  const device = new MemoryTerminalDevice({ width: 24, height: 3 })
  const terminal = new Terminal(device)

  terminal.display(() => VStack([Picker('Mode', [], empty), TextField(text).frame({ width: 4 }), TabBar([], empty)]))
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'left' })
  device.emitKey({ key: 'backspace' })
  device.emitKey({ key: 'char', char: 'Z' })
  await Bun.sleep(120)

  expect(text.get()).toBe('aZc')
  device.emitKey({ key: 'down' })
  device.emitKey({ key: 'enter' })
  device.emitKey({ key: 'tab' })
  expect(empty.get()).toBe('')
  terminal.stop()
})

test('Focus moves by geometry and ignores clipped controls', () => {
  let right = 0
  const device = new MemoryTerminalDevice({ width: 20, height: 3 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    HStack([
      Button('Left', () => {}),
      Button('Right', () => {
        right += 1
      }),
      ScrollView(VStack([Button('Hidden', () => { right = 99 })]), { offset: 10 }).frame({ width: 1, height: 1 }),
    ], { spacing: 1 }),
  )

  device.emitKey({ key: 'right' })
  device.emitKey({ key: 'enter' })

  expect(right).toBe(1)
  terminal.stop()
})

test('ForEach preserves focused identity when data reorders', async () => {
  let items = ['A', 'B']
  let selected = ''
  const device = new MemoryTerminalDevice({ width: 12, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    HStack([
      ForEach(
        items,
        item => item,
        item => Button(item, () => { selected = item }),
      ),
    ], { spacing: 1 }),
  )

  device.emitKey({ key: 'right' })
  items = ['B', 'A']
  terminal.setNeedsUpdate()
  await Bun.sleep(120)
  device.emitKey({ key: 'enter' })

  expect(selected).toBe('B')
  terminal.stop()
})

test('Explicit id preserves focus and async text state across movement', async () => {
  let flipped = false
  let selected = ''
  const device = new MemoryTerminalDevice({ width: 12, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    VStack([
      HStack(flipped ? [Button('Other', () => {}), Button('Search', () => { selected = 'search' }).id('search')] : [Button('Search', () => { selected = 'search' }).id('search'), Button('Other', () => {})]),
      Text(async function* () {
        yield 'Loaded'
      }).id('async'),
    ]),
  )

  await Bun.sleep(120)
  flipped = true
  terminal.setNeedsUpdate()
  await Bun.sleep(120)
  device.emitKey({ key: 'enter' })

  expect(selected).toBe('search')
  expect(device.writes.at(-1)?.includes('Loaded')).toBe(true)
  terminal.stop()
})

test('Task modifier starts only when visible, reruns on id changes, cancels, and invalidates', async () => {
  let id = 'a'
  let value = 'idle'
  let starts = 0
  let aborted = 0
  const device = new MemoryTerminalDevice({ width: 6, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    Text(value)
      .task(id, async context => {
        starts += 1
        context.signal.addEventListener('abort', () => {
          aborted += 1
        })
        value = `run${starts}`
        context.setNeedsUpdate()
      })
      .frame({ width: 6, alignment: 'leading' }),
  )

  await Bun.sleep(150)
  expect(starts).toBe(1)
  expect(device.writes.at(-1)).toBe('run1  ')

  id = 'b'
  terminal.setNeedsUpdate()
  await Bun.sleep(150)
  expect(starts).toBe(2)
  expect(aborted).toBe(1)

  terminal.stop()
  expect(aborted).toBe(2)
})

test('Task modifier does not start when clipped outside ScrollView viewport', async () => {
  let started = false
  const device = new MemoryTerminalDevice({ width: 6, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    ScrollView(
      VStack([
        Text('Hidden').task('hidden', () => {
          started = true
        }),
        Text('Shown'),
      ]),
      { axis: 'vertical', anchor: 'bottom' },
    ).frame({ width: 6, height: 1 }),
  )

  await Bun.sleep(120)
  expect(started).toBe(false)
  terminal.stop()
})

test('NavigationStack renders root for empty path and top destination for non-empty path', () => {
  const path = binding<NavigationRouteValue[]>([])
  const view = NavigationStack(
    path,
    () => Text('Root'),
    value => Text(`Detail ${value}`),
  )

  expect(renderViewToString(view, { width: 12, height: 1 })).toBe('Root        ')

  path.set(['home', 'detail'])
  expect(renderViewToString(view, { width: 12, height: 1 })).toBe('Detail detai')
})

test('NavigationLink pushes route values on Enter', () => {
  const path = binding<NavigationRouteValue[]>([])
  const device = new MemoryTerminalDevice({ width: 16, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    NavigationStack(
      path,
      () => NavigationLink('Open', 'detail'),
      value => Text(`Detail ${value}`),
    ),
  )
  device.emitKey({ key: 'enter' })

  expect(path.get()).toEqual(['detail'])
  terminal.stop()
})

test('NavigationBackButton pops routes and is safe at root', () => {
  const path = binding<NavigationRouteValue[]>(['detail'])
  const device = new MemoryTerminalDevice({ width: 12, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    NavigationStack(
      path,
      () => NavigationBackButton(),
      () => NavigationBackButton(),
    ),
  )
  device.emitKey({ key: 'enter' })
  expect(path.get()).toEqual([])

  device.emitKey({ key: 'enter' })
  expect(path.get()).toEqual([])
  terminal.stop()
})

test('NavigationStack pops one route with Escape and leaves root unchanged', () => {
  const path = binding<NavigationRouteValue[]>(['folder', 'file'])
  const device = new MemoryTerminalDevice({ width: 16, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    NavigationStack(
      path,
      () => Text('Root'),
      value => Text(`Detail ${value}`),
    ),
  )

  device.emitKey({ key: 'escape' })
  expect(path.get()).toEqual(['folder'])

  device.emitKey({ key: 'escape' })
  expect(path.get()).toEqual([])

  device.emitKey({ key: 'escape' })
  expect(path.get()).toEqual([])
  terminal.stop()
})

test('NavigationStack lets open overlays consume Escape before route pop', async () => {
  const path = binding<NavigationRouteValue[]>(['detail'])
  const open = binding(true)
  const device = new MemoryTerminalDevice({ width: 24, height: 5 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    NavigationStack(
      path,
      () => Text('Root'),
      () => VStack([
        Button('Base', () => {}),
        Alert(open, { title: 'Confirm', actions: [{ label: 'OK' }] }),
      ]),
    ),
  )

  device.emitKey({ key: 'escape' })
  await Bun.sleep(120)
  expect(open.get()).toBe(false)
  expect(path.get()).toEqual(['detail'])

  device.emitKey({ key: 'escape' })
  expect(path.get()).toEqual([])
  terminal.stop()
})

test('Nested NavigationStack consumes Escape from innermost active route first', () => {
  const outer = binding<NavigationRouteValue[]>(['outer'])
  const inner = binding<NavigationRouteValue[]>(['inner'])
  const device = new MemoryTerminalDevice({ width: 16, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    NavigationStack(
      outer,
      () => Text('Root'),
      () =>
        NavigationStack(
          inner,
          () => Text('Inner root'),
          value => Text(`Inner ${value}`),
        ),
    ),
  )

  device.emitKey({ key: 'escape' })
  expect(inner.get()).toEqual([])
  expect(outer.get()).toEqual(['outer'])

  device.emitKey({ key: 'escape' })
  expect(outer.get()).toEqual([])
  terminal.stop()
})

test('Navigation route identity separates async state and cancels popped tasks', async () => {
  const path = binding<NavigationRouteValue[]>(['one'])
  let starts = 0
  let aborted = 0
  const device = new MemoryTerminalDevice({ width: 8, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    NavigationStack(
      path,
      () => Text('Root'),
      value =>
        Text(async function* () {
          starts += 1
          yield `${value}:${starts}`
        }).task(value, context => {
          context.signal.addEventListener('abort', () => {
            aborted += 1
          })
        }),
    ),
  )

  await Bun.sleep(120)
  expect(device.writes.at(-1)).toBe('one:1   ')

  path.set(['two'])
  terminal.setNeedsUpdate()
  await Bun.sleep(250)
  expect(device.writes.at(-1)?.startsWith('two:')).toBe(true)
  expect(starts).toBeGreaterThanOrEqual(2)

  path.set([])
  terminal.setNeedsUpdate()
  await Bun.sleep(250)
  expect(aborted).toBeGreaterThanOrEqual(2)
  terminal.stop()
})

test('contextMenu opens with Space, selects actions, activates with Enter, and toggles closed', async () => {
  let action = ''
  const device = new MemoryTerminalDevice({ width: 24, height: 5 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    Button('Message', () => {
      action = 'button'
    }).contextMenu([
      { label: 'Reply', action: () => { action = 'reply' } },
      { label: 'Copy', action: () => { action = 'copy' } },
    ]),
  )

  device.emitKey({ key: 'char', char: ' ' })
  await Bun.sleep(120)
  expect(device.writes.at(-1)?.includes('Reply')).toBe(true)

  device.emitKey({ key: 'down' })
  await Bun.sleep(120)
  expect(device.writes.at(-1)?.includes('> Copy')).toBe(true)

  device.emitKey({ key: 'enter' })
  await Bun.sleep(120)
  expect(action).toBe('copy')
  expect(device.writes.at(-1)?.includes('Copy')).toBe(false)

  device.emitKey({ key: 'enter' })
  expect(action).toBe('button')

  device.emitKey({ key: 'char', char: ' ' })
  await Bun.sleep(120)
  expect(device.writes.at(-1)?.includes('Reply')).toBe(true)
  device.emitKey({ key: 'char', char: ' ' })
  await Bun.sleep(120)
  expect(device.writes.at(-1)?.includes('Reply')).toBe(false)
  terminal.stop()
})

test('contextMenu highlights focused fallback rows', () => {
  const device = new MemoryTerminalDevice({ width: 8, height: 1 })
  const terminal = new Terminal(device)

  terminal.focus('row')
  terminal.display(() => Text('Row').contextMenu([{ label: 'Open', action: () => {} }]).focusId('row'))

  const output = device.writes.at(-1) ?? ''
  expect(output).toContain('\x1b[100mRow')
  expect(stripAnsi(output)).toBe('Row     ')
  terminal.stop()
})

test('contextMenu does not highlight unfocused fallback rows', () => {
  const device = new MemoryTerminalDevice({ width: 8, height: 2 })
  const terminal = new Terminal(device)

  terminal.focus('other')
  terminal.display(() =>
    VStack([
      Text('Row').contextMenu([{ label: 'Open', action: () => {} }]).focusId('row'),
      Text('Other').contextMenu([{ label: 'Open', action: () => {} }]).focusId('other'),
    ]),
  )

  const output = device.writes.at(-1) ?? ''
  const lines = output.split('\n')
  expect(lines[0]).not.toContain('\x1b[100m')
  expect(lines[1]).toContain('\x1b[100mOther')
  terminal.stop()
})

test('contextMenu preserves wrapped control focus style without fallback highlight', () => {
  const device = new MemoryTerminalDevice({ width: 8, height: 1 })
  const terminal = new Terminal(device)

  terminal.focus('button')
  terminal.display(() => Button('Go', () => {}).contextMenu([{ label: 'Open', action: () => {} }]).focusId('button'))

  const output = device.writes.at(-1) ?? ''
  expect(output).not.toContain('\x1b[100m')
  expect(stripAnsi(output)).toBe('>Go<    ')
  terminal.stop()
})

test('empty contextMenu is safe and public action type is importable', async () => {
  const actions: ContextMenuAction[] = []
  const device = new MemoryTerminalDevice({ width: 8, height: 2 })
  const terminal = new Terminal(device)

  terminal.focus('row')
  terminal.display(() => Text('Row').contextMenu(actions).focusId('row'))
  device.emitKey({ key: 'char', char: ' ' })
  await Bun.sleep(120)

  const output = device.writes.at(-1) ?? ''
  expect(stripAnsi(output)).toBe('Row     \n        ')
  expect(output).toContain('\x1b[100mRow')
  terminal.stop()
})

test('contextMenu renders above later overlapping siblings', async () => {
  const device = new MemoryTerminalDevice({ width: 12, height: 4 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    HStack([
      Button('Menu', () => {}).contextMenu([{ label: 'Reply', action: () => {} }]),
      Text('XXXXXXXXX\nXXXXXXXXX\nXXXXXXXXX'),
    ], { spacing: -6 }),
  )

  device.emitKey({ key: 'char', char: ' ' })
  await Bun.sleep(120)

  const lines = stripAnsi(device.writes.at(-1) ?? '').split('\n')
  expect(lines[1]?.startsWith('+-------+')).toBe(true)
  expect(lines[2]?.startsWith('|> Reply|')).toBe(true)
  terminal.stop()
})

test('contextMenu renders above nested decorated content', async () => {
  const device = new MemoryTerminalDevice({ width: 12, height: 6 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    VStack([
      Button('Menu', () => {}).contextMenu([{ label: 'Open', action: () => {} }]),
      Text('########\n########'),
    ], { spacing: -1 }).padding(1),
  )

  device.emitKey({ key: 'char', char: ' ' })
  await Bun.sleep(120)

  const lines = stripAnsi(device.writes.at(-1) ?? '').split('\n')
  expect(lines.some(line => line.includes('+------+'))).toBe(true)
  expect(lines.some(line => line.includes('|> Open|'))).toBe(true)
  terminal.stop()
})

test('top-layer render callbacks flush in deterministic registration order', () => {
  const view = topLayerProbeView()

  expect(renderViewToString(view, { width: 4, height: 1 })).toBe('2222')
  expect(renderViewToString(view, { width: 4, height: 1 })).toBe('2222')
})

test('Diff writer emits only changed rows after first full frame', () => {
  expect(diffAnsiFrames(undefined, 'A\nB', true)).toBe('\x1b[H\x1b[JA\nB')
  expect(diffAnsiFrames('A\nB', 'A\nC')).toBe('\x1b[2;1HC')
  expect(diffAnsiFrames('A\nB', 'A\nB')).toBe('')
})

test('Public option types are importable from package entrypoint', () => {
  const stack: StackOptions = { spacing: 1 }
  const route: NavigationRouteValue = 'detail'
  const navigation: NavigationController = { path: [route], push: () => {}, pop: () => {} }
  const scroll: ScrollOptions = { axis: 'vertical' }
  const spacer: SpacerOptions = { minLength: 1 }
  const text: TextOptions = { wrap: true }
  const field: TextFieldOptions = { placeholder: 'Name' }
  const task = (_context: TaskContext) => {}
  const keyBinding: KeyBinding = 'ctrl+o'
  const keyBindingAction: KeyBindingAction = () => {}

  expect([stack.spacing, navigation.path[0], scroll.axis, spacer.minLength, text.wrap, field.placeholder, task, keyBinding, keyBindingAction].length).toBe(9)
})

test('Runtime throttles rapid updates and suppresses unchanged output', async () => {
  const value = binding(0)
  const device = new MemoryTerminalDevice({ width: 1, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() => Text(String(value.get())))
  for (let index = 0; index < 20; index += 1) {
    value.set(index % 2)
    terminal.setNeedsUpdate()
  }
  await Bun.sleep(150)

  expect(device.writes.length).toBeLessThanOrEqual(3)
  terminal.stop()
})

test('Visible async Text starts and updates output', async () => {
  const device = new MemoryTerminalDevice({ width: 3, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    Text(async function* () {
      yield 'One'
      await Bun.sleep(20)
      yield 'Two'
    }),
  )

  await Bun.sleep(150)

  expect(device.writes.at(-1)).toBe('Two')
  terminal.stop()
})

test('Async Text does not start when clipped outside ScrollView viewport', async () => {
  let started = false
  const device = new MemoryTerminalDevice({ width: 6, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() =>
    ScrollView(
      VStack([
        Text(async function* () {
          started = true
          yield 'Hidden'
        }),
        Text('Shown'),
      ]),
      { axis: 'vertical', anchor: 'bottom' },
    ).frame({ width: 6, height: 1 }),
  )

  await Bun.sleep(120)

  expect(started).toBe(false)
  terminal.stop()
})

test('Resize invalidates and renders with new bounds', async () => {
  const device = new MemoryTerminalDevice({ width: 1, height: 1 })
  const terminal = new Terminal(device)

  terminal.display(() => Text('X').frame({ maxWidth: -1 }))
  device.setSize({ width: 3, height: 1 })
  await Bun.sleep(120)

  expect(device.writes.at(-1)).toBe(' X ')
  terminal.stop()
})
