import { RenderBuffer } from './render'
import { rect, type Cleanup, type FocusCandidate, type FocusDirection, type KeyEvent, type Size, type TerminalDevice } from './types'
import type { RegisteredControl, RuntimeHooks, TaskContext, ViewNode } from './view'

type AsyncState<T = unknown> = {
  value?: T
  iterator?: AsyncIterator<T>
  running: boolean
}

type RenderResult = {
  output: string
  candidates: FocusCandidate[]
  keyHandlers: KeyHandler[]
  tabHandlers: (() => void)[]
}

type KeyHandler = {
  handleKey(event: KeyEvent): boolean
  sourceOrder: number
}

type ControlRegistration = RegisteredControl & {
  sourceOrder: number
}

type TaskState = {
  id: unknown
  controller: AbortController
  running: boolean
}

const frameMs = 100

export class ProcessTerminalDevice implements TerminalDevice {
  private active = false
  private mouseEnabled = false

  getSize(): Size {
    return {
      width: process.stdout.columns || 80,
      height: process.stdout.rows || 24,
    }
  }

  write(text: string): void {
    process.stdout.write(`\x1b[H\x1b[J${text}`)
  }

  writeFrame(text: string, previous: string | undefined, force: boolean): void {
    process.stdout.write(diffAnsiFrames(previous, text, force))
  }

  onResize(callback: () => void): Cleanup {
    process.stdout.on('resize', callback)
    return () => process.stdout.off('resize', callback)
  }

  onKey(callback: (event: KeyEvent) => void): Cleanup {
    const handler = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      for (const event of parseTerminalKeyInput(text, { mouse: this.mouseEnabled })) callback(event)
    }
    process.stdin.on('data', handler)
    return () => process.stdin.off('data', handler)
  }

  setRawMode(enabled: boolean): void {
    if (process.stdout.isTTY && enabled !== this.active) {
      process.stdout.write(enabled ? '\x1b[?1049h\x1b[?25l' : '\x1b[?25h\x1b[?1049l')
      this.active = enabled
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(enabled)
      if (enabled) process.stdin.resume()
    }
  }

  requestInterruptExit(): void {
    setTimeout(() => process.exit(130), 0)
  }

  enableMouse(enabled: boolean): void {
    if (this.mouseEnabled === enabled) return
    this.mouseEnabled = enabled
    if (process.stdout.isTTY) process.stdout.write(enabled ? '\x1b[?1000h\x1b[?1006h' : '\x1b[?1000l\x1b[?1006l')
  }
}

export class MemoryTerminalDevice implements TerminalDevice {
  writes: string[] = []
  size: Size
  private resizeCallbacks = new Set<() => void>()
  private keyCallbacks = new Set<(event: KeyEvent) => void>()

  constructor(size: Size = { width: 80, height: 24 }) {
    this.size = size
  }

  getSize(): Size {
    return this.size
  }

  write(text: string): void {
    this.writes.push(text)
  }

  onResize(callback: () => void): Cleanup {
    this.resizeCallbacks.add(callback)
    return () => this.resizeCallbacks.delete(callback)
  }

  onKey(callback: (event: KeyEvent) => void): Cleanup {
    this.keyCallbacks.add(callback)
    return () => this.keyCallbacks.delete(callback)
  }

  setSize(size: Size): void {
    this.size = size
    for (const callback of this.resizeCallbacks) callback()
  }

  emitKey(event: KeyEvent): void {
    for (const callback of this.keyCallbacks) callback(event)
  }
}

export class Terminal {
  private root?: () => ViewNode
  private cleanups: Cleanup[] = []
  private states = new Map<string, unknown>()
  private asyncStates = new Map<string, AsyncState>()
  private taskStates = new Map<string, TaskState>()
  private visible = new Set<string>()
  private visibleTasks = new Set<string>()
  private dirty = false
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  private lastFlush = 0
  private lastOutput = ''
  private candidates: FocusCandidate[] = []
  private keyHandlers: KeyHandler[] = []
  private tabHandlers: (() => void)[] = []
  private focusedId?: string
  private controlsEnabled = false

  constructor(private readonly device: TerminalDevice = new ProcessTerminalDevice()) {}

  controls(enabled: boolean): this {
    this.controlsEnabled = enabled
    this.setNeedsUpdate()
    return this
  }

  focus(id: string | undefined): void {
    this.focusedId = id
    this.setNeedsUpdate()
  }

  display(builder: () => ViewNode): void {
    this.stop()
    this.stopped = false
    this.root = builder
    this.cleanups.push(this.device.onResize(() => this.setNeedsUpdate()))
    if (this.device.onKey) this.cleanups.push(this.device.onKey(event => this.handleKey(event)))
    this.device.setRawMode?.(true)
    this.flush(true)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.device.setRawMode?.(false)
    for (const state of this.asyncStates.values()) {
      state.running = false
      void state.iterator?.return?.()
    }
    this.asyncStates.clear()
    for (const task of this.taskStates.values()) {
      task.running = false
      task.controller.abort()
    }
    this.taskStates.clear()
  }

  setNeedsUpdate(): void {
    if (this.stopped || !this.root) return
    this.dirty = true
    const elapsed = Date.now() - this.lastFlush
    if (elapsed >= frameMs) {
      queueMicrotask(() => this.flush())
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.flush()
      }, frameMs - elapsed)
    }
  }

  renderToString(): string {
    return this.render().output
  }

  private flush(force = false): void {
    if (!this.root || this.stopped) return
    if (!force && !this.dirty) return
    const elapsed = Date.now() - this.lastFlush
    if (!force && elapsed < frameMs) {
      this.setNeedsUpdate()
      return
    }

    this.dirty = false
    const result = this.render()
    const focusableCandidates = result.candidates.filter(candidate => !candidate.fallback)
    if (!this.focusedId || !result.candidates.some(candidate => candidate.id === this.focusedId)) {
      this.focusedId = focusableCandidates[0]?.id
    } else if (result.candidates.find(candidate => candidate.id === this.focusedId)?.fallback && focusableCandidates.length > 0) {
      this.focusedId = focusableCandidates[0]?.id
    }
    this.candidates = result.candidates
    this.keyHandlers = result.keyHandlers
    this.tabHandlers = result.tabHandlers
    if (force || result.output !== this.lastOutput) {
      if (this.device.writeFrame) this.device.writeFrame(result.output, this.lastOutput || undefined, force)
      else this.device.write(result.output)
      this.lastOutput = result.output
      this.lastFlush = Date.now()
    }
  }

  private render(): RenderResult {
    const terminalSize = this.device.getSize()
    const buffer = new RenderBuffer(terminalSize)
    const candidates: FocusCandidate[] = []
    const keyHandlers: KeyHandler[] = []
    const tabHandlers: (() => void)[] = []
    const controls: ControlRegistration[] = []
    const topLayers: (() => void)[] = []
    let sourceOrder = 0
    this.visible = new Set()
    this.visibleTasks = new Set()

    const runtime: RuntimeHooks = {
      setNeedsUpdate: () => this.setNeedsUpdate(),
      requestFocus: id => {
        this.focusedId = id
      },
      getState: <T>(path: string, create: () => T): T => {
        if (!this.states.has(path)) this.states.set(path, create())
        return this.states.get(path) as T
      },
      markVisible: (path, start) => {
        this.visible.add(path)
        if (start) this.startAsync(path, start)
      },
      markTaskVisible: (path, id, run) => {
        this.visibleTasks.add(path)
        this.startTask(path, id, run)
      },
    }

    const root = this.root!()
    root.installRuntime(runtime, 'root')
    const rootHeight = this.controlsEnabled ? Math.max(0, terminalSize.height - 1) : terminalSize.height
    const rootBounds = rect(0, 0, terminalSize.width, rootHeight)
    root.render(rootBounds, {
      path: 'root',
      runtime,
      buffer,
      clip: rootBounds,
      focusedId: this.focusedId,
      registerFocus: candidate => {
        candidates.push({ ...candidate, sourceOrder: sourceOrder++ })
      },
      registerKeyHandler: handler => {
        keyHandlers.push({ handleKey: handler, sourceOrder: sourceOrder++ })
      },
      registerControl: control => {
        controls.push({ ...control, sourceOrder: sourceOrder++ })
      },
      registerTabBar: handler => tabHandlers.push(handler),
      registerTopLayer: render => topLayers.push(render),
    })

    for (const renderTopLayer of topLayers.slice()) renderTopLayer()
    if (this.controlsEnabled && terminalSize.height > 0) this.renderControls(buffer, controls, terminalSize, this.focusedId)

    for (const [path, state] of this.asyncStates) {
      if (!this.visible.has(path)) {
        state.running = false
        void state.iterator?.return?.()
        this.asyncStates.delete(path)
      }
    }

    for (const [path, state] of this.taskStates) {
      if (!this.visibleTasks.has(path)) {
        state.running = false
        state.controller.abort()
        this.taskStates.delete(path)
      }
    }

    return { output: buffer.toAnsiString(), candidates, keyHandlers, tabHandlers }
  }

  private renderControls(buffer: RenderBuffer, controls: ControlRegistration[], terminalSize: Size, focusedId?: string): void {
    const seen = new Set<string>()
    const activeId = (focusedId && controls.some(control => control.id === focusedId)) ? focusedId : controls[0]?.id
    const entries = controls
      .slice()
      .sort((a, b) => a.sourceOrder - b.sourceOrder)
      .filter(control => control.id === activeId)
      .filter(control => {
        const key = `${control.binding}\u0000${control.title}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map(control => `${formatControlBinding(control.binding)} ${control.title}${control.detail ? ` - ${control.detail}` : ''}`)
    if (entries.length === 0) return
    buffer.write(0, terminalSize.height - 1, entries.join('  '), rect(0, terminalSize.height - 1, terminalSize.width, 1), 'secondary')
  }

  private startAsync(path: string, start: () => AsyncIterator<unknown>): void {
    const existing = this.asyncStates.get(path)
    if (existing?.running) return

    const state: AsyncState = { iterator: start(), running: true }
    this.asyncStates.set(path, state)

    void (async () => {
      while (state.running) {
        const result = await state.iterator!.next()
        if (result.done) break
      }
      state.running = false
    })()
  }

  private startTask(path: string, id: unknown, run: (context: TaskContext) => Promise<void> | void): void {
    const existing = this.taskStates.get(path)
    if (existing && Object.is(existing.id, id)) return
    if (existing) {
      existing.running = false
      existing.controller.abort()
    }

    const controller = new AbortController()
    const state: TaskState = { id, controller, running: true }
    this.taskStates.set(path, state)
    void Promise.resolve()
      .then(() => run({ signal: controller.signal, setNeedsUpdate: () => this.setNeedsUpdate() }))
      .catch(error => {
        if (!controller.signal.aborted) console.error(error)
      })
      .finally(() => {
        state.running = false
      })
  }

  private handleKey(event: KeyEvent): void {
    const focused = this.candidates.find(candidate => candidate.id === this.focusedId)
    const keyHandler = this.keyHandlers
      .slice()
      .sort((a, b) => b.sourceOrder - a.sourceOrder)
      .find(handler => handler.handleKey(event))
    if (keyHandler) {
      this.setNeedsUpdate()
      return
    }

    if (focused?.handleKey?.(event)) {
      this.setNeedsUpdate()
      return
    }

    const arrowDirection = focusDirectionForArrow(event)
    if (arrowDirection) {
      const next = this.nextFocus(arrowDirection)
      if (next && next !== this.focusedId) {
        this.focusedId = next
        this.setNeedsUpdate()
        return
      }
    }

    const fallback = this.candidates
      .filter(candidate => candidate.fallback && candidate.id !== focused?.id)
      .sort((a, b) => b.sourceOrder - a.sourceOrder)
      .find(candidate => candidate.handleKey?.(event))
    if (fallback) {
      this.setNeedsUpdate()
      return
    }

    if (event.key === 'ctrl-c') {
      this.stop()
      this.device.requestInterruptExit?.()
      return
    }

    if (arrowDirection) {
      this.focusedId = this.nextFocus(arrowDirection)
      this.setNeedsUpdate()
      return
    }

    if (event.key === 'tab' && this.tabHandlers[0]) {
      this.tabHandlers[0]()
      this.setNeedsUpdate()
      return
    }

    if (event.key === 'enter' && focused?.activate) {
      focused.activate()
      this.setNeedsUpdate()
    }
  }

  private nextFocus(direction: FocusDirection): string | undefined {
    const current = this.candidates.find(candidate => candidate.id === this.focusedId)
    const focusableCandidates = this.candidates.filter(candidate => !candidate.fallback)
    if (!current || current.fallback) return focusableCandidates[0]?.id
    const cx = current.bounds.x + current.bounds.width / 2
    const cy = current.bounds.y + current.bounds.height / 2

    const candidates = focusableCandidates
      .filter(candidate => candidate.id !== current.id)
      .filter(candidate => {
        if (direction === 'top') return candidate.bounds.y + candidate.bounds.height <= cy
        if (direction === 'bottom') return candidate.bounds.y >= cy
        if (direction === 'left') return candidate.bounds.x + candidate.bounds.width <= cx
        return candidate.bounds.x >= cx
      })
      .map(candidate => {
        const tx = candidate.bounds.x + candidate.bounds.width / 2
        const ty = candidate.bounds.y + candidate.bounds.height / 2
        const main = direction === 'top' || direction === 'bottom' ? Math.abs(ty - cy) : Math.abs(tx - cx)
        const cross = direction === 'top' || direction === 'bottom' ? Math.abs(tx - cx) : Math.abs(ty - cy)
        return { candidate, score: main * 1000 + cross, sourceOrder: candidate.sourceOrder }
      })
      .sort((a, b) => a.score - b.score || a.sourceOrder - b.sourceOrder)

    return candidates[0]?.candidate.id ?? current.id
  }
}

function formatControlBinding(binding: string): string {
  if (binding === 'enter') return '↵'
  return binding
}

function focusDirectionForArrow(event: KeyEvent): FocusDirection | undefined {
  if (event.key === 'up') return 'top'
  if (event.key === 'down') return 'bottom'
  if (event.key === 'left' || event.key === 'right') return event.key
  return undefined
}

export function diffAnsiFrames(previous: string | undefined, next: string, force = false): string {
  if (force || previous === undefined) return `\x1b[H\x1b[J${next}`
  const previousLines = previous.split('\n')
  const nextLines = next.split('\n')
  let output = ''
  for (let index = 0; index < nextLines.length; index += 1) {
    if (previousLines[index] !== nextLines[index]) output += `\x1b[${index + 1};1H${nextLines[index]}`
  }
  return output
}

export type ParseTerminalKeyOptions = {
  mouse?: boolean
}

export function parseTerminalKeyInput(text: string, options: ParseTerminalKeyOptions = {}): KeyEvent[] {
  if (text === '\u0003') return [{ key: 'ctrl-c', raw: text }]
  if (text.length === 1) {
    const code = text.charCodeAt(0)
    if (code >= 1 && code <= 26 && code !== 3 && code !== 9 && code !== 10 && code !== 13) {
      return [{ key: 'char', char: String.fromCharCode(code + 96), modifiers: ['ctrl'], raw: text }]
    }
  }
  if (text === '\r' || text === '\n') return [{ key: 'enter', raw: text }]
  if (text === '\t') return [{ key: 'tab', raw: text }]
  if (text === '\u007f') return [{ key: 'backspace', raw: text }]
  if (text === '\u001b') return [{ key: 'escape', raw: text }]
  if (text === '\u001b[3~') return [{ key: 'delete', raw: text }]
  if (text === '\u001b[5~') return [{ key: 'pageUp', raw: text }]
  if (text === '\u001b[6~') return [{ key: 'pageDown', raw: text }]
  if (text === '\u001b[H' || text === '\u001b[1~' || text === '\u001b[OH') return [{ key: 'home', raw: text }]
  if (text === '\u001b[F' || text === '\u001b[4~' || text === '\u001b[OF') return [{ key: 'end', raw: text }]
  if (text === '\u001b[A') return [{ key: 'up', raw: text }]
  if (text === '\u001b[B') return [{ key: 'down', raw: text }]
  if (text === '\u001b[C') return [{ key: 'right', raw: text }]
  if (text === '\u001b[D') return [{ key: 'left', raw: text }]

  const modifiedArrow = /^\u001b\[1;([2-8])([ABCD])$/.exec(text)
  if (modifiedArrow) {
    const key = ({ A: 'up', B: 'down', C: 'right', D: 'left' } as const)[modifiedArrow[2] as 'A' | 'B' | 'C' | 'D']
    return [{ key, modifiers: modifiersFromCode(Number(modifiedArrow[1])), raw: text }]
  }

  const mouse = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(text)
  if (mouse && options.mouse) {
    const code = Number(mouse[1])
    return [
      {
        key: 'mouse',
        action: mouse[4] === 'm' ? 'up' : code & 64 ? 'scroll' : code & 32 ? 'drag' : 'down',
        button: code & 3,
        x: Math.max(0, Number(mouse[2]) - 1),
        y: Math.max(0, Number(mouse[3]) - 1),
        raw: text,
      },
    ]
  }

  if (text.startsWith('\u001b')) {
    if (text.length === 2 && !text[1]?.startsWith('[')) return [{ key: 'char', char: text[1]!, modifiers: ['alt'], raw: text }]
    return [{ key: 'raw', sequence: text, raw: text }]
  }

  return [...text].map(char => ({ key: 'char' as const, char, raw: char }))
}

function modifiersFromCode(code: number): KeyEvent['modifiers'] {
  if (code === 2) return ['shift']
  if (code === 3) return ['alt']
  if (code === 4) return ['shift', 'alt']
  if (code === 5) return ['ctrl']
  if (code === 6) return ['shift', 'ctrl']
  if (code === 7) return ['alt', 'ctrl']
  if (code === 8) return ['shift', 'alt', 'ctrl']
  return undefined
}

export function renderViewToString(view: ViewNode, size: Size = { width: 80, height: 24 }): string {
  const device = new MemoryTerminalDevice(size)
  const terminal = new Terminal(device)
  terminal.display(() => view)
  terminal.stop()
  return device.writes.at(-1) ?? ''
}
