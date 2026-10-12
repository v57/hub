import { RenderBuffer } from '../render'
import { BaseView, controlFocusId, type LayoutContext, type RenderContext, type TaskContext, type ViewNode } from '../view/base'
import {
  ansi256,
  characterDisplayWidth,
  clamp,
  intersection,
  rect,
  type BackgroundColor,
  type FontWeight,
  type ForegroundColor,
  type NamedColor,
  type ProposedSize,
  type Rect,
  type Size,
} from '../types'

type TerminalCell = {
  char: string
  foregroundColor?: ForegroundColor
  backgroundColor?: BackgroundColor
  fontWeight?: FontWeight
}

type TerminalStyle = Omit<TerminalCell, 'char'>

export type EmbeddedTerminalHandle = {
  write(data: string | Uint8Array): void
  resize(cols: number, rows: number): void
  kill(signal?: number | NodeJS.Signals): void
}

export type EmbeddedTerminalPty = {
  write(data: string | Uint8Array): void
  resize(cols: number, rows: number): void
}

export type EmbeddedTerminalProcess = {
  terminal: EmbeddedTerminalPty
  exited: Promise<number>
  kill(signal?: number | NodeJS.Signals): void
}

export type EmbeddedTerminalSpawnOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
  cols: number
  rows: number
  name: string
  onData(data: Uint8Array): void
}

export type EmbeddedTerminalSpawner = (command: string[], options: EmbeddedTerminalSpawnOptions) => EmbeddedTerminalProcess

export type EmbeddedTerminalOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
  name?: string
  focusId?: string
  restartKey?: unknown
  spawn?: EmbeddedTerminalSpawner
  onReady?: (handle: EmbeddedTerminalHandle) => void
  onExit?: (exitCode: number) => void
}

const defaultTerminalName = 'xterm-256color'
const normalColors: NamedColor[] = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const brightColors: NamedColor[] = ['gray', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

export class TerminalScreenBuffer {
  private cells: TerminalCell[][]
  private cursorX = 0
  private cursorY = 0
  private savedX = 0
  private savedY = 0
  private style: TerminalStyle = {}
  private pending = ''
  private readonly decoder = new TextDecoder()

  constructor(size: Size) {
    this.cells = []
    this.resize(size)
  }

  get width(): number {
    return this.cells[0]?.length ?? 0
  }

  get height(): number {
    return this.cells.length
  }

  resize(size: Size): void {
    const width = Math.max(0, Math.floor(size.width))
    const height = Math.max(0, Math.floor(size.height))
    if (width === this.width && height === this.height) return

    const next = Array.from({ length: height }, (_row, y) =>
      Array.from({ length: width }, (_column, x) => this.cloneCell(this.cells[y]?.[x] ?? this.blankCell())),
    )
    this.cells = next
    this.clampCursor()
  }

  write(data: string | Uint8Array): void {
    this.pending += typeof data === 'string' ? data : this.decoder.decode(data, { stream: true })
    let index = 0

    while (index < this.pending.length) {
      const char = this.pending[index]
      if (char === '\x1b') {
        const next = this.consumeEscape(this.pending, index)
        if (next === undefined) break
        index = next
        continue
      }

      const codePoint = this.pending.codePointAt(index)
      if (codePoint === undefined) break
      const value = String.fromCodePoint(codePoint)
      this.consumeCharacter(value)
      index += value.length
    }

    this.pending = this.pending.slice(index)
    if (this.pending.length > 4096) this.pending = ''
  }

  renderTo(buffer: RenderBuffer, bounds: Rect, clip: Rect): void {
    const visible = intersection(bounds, clip)
    if (!visible) return
    const rows = Math.min(bounds.height, this.height)
    const columns = Math.min(bounds.width, this.width)
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const cell = this.cells[y]?.[x] ?? this.blankCell()
        buffer.write(bounds.x + x, bounds.y + y, cell.char, visible, cell.foregroundColor, cell.fontWeight, cell.backgroundColor)
      }
    }
  }

  toString(): string {
    return this.cells.map(row => row.map(cell => cell.char).join('')).join('\n')
  }

  private consumeCharacter(char: string): void {
    if (char === '\r') {
      this.cursorX = 0
      return
    }
    if (char === '\n') {
      this.lineFeed()
      return
    }
    if (char === '\b') {
      this.cursorX = Math.max(0, this.cursorX - 1)
      return
    }
    if (char === '\t') {
      const spaces = 8 - (this.cursorX % 8)
      for (let index = 0; index < spaces; index += 1) this.putCharacter(' ')
      return
    }
    if (char < ' ') return
    this.putCharacter(char)
  }

  private consumeEscape(text: string, index: number): number | undefined {
    if (index + 1 >= text.length) return undefined
    const next = text[index + 1]

    if (next === '[') {
      let end = index + 2
      while (end < text.length) {
        const code = text.charCodeAt(end)
        if (code >= 0x40 && code <= 0x7e) {
          this.handleCsi(text.slice(index + 2, end), text[end]!)
          return end + 1
        }
        end += 1
      }
      return undefined
    }

    if (next === ']') {
      const bell = text.indexOf('\x07', index + 2)
      const st = text.indexOf('\x1b\\', index + 2)
      if (bell === -1 && st === -1) return undefined
      if (bell !== -1 && (st === -1 || bell < st)) return bell + 1
      return st + 2
    }

    if (next === '(' || next === ')' || next === '*' || next === '+') return index + 2 < text.length ? index + 3 : undefined
    if (next === 'c') this.reset()
    else if (next === '7') this.saveCursor()
    else if (next === '8') this.restoreCursor()
    else if (next === 'D') this.lineFeed()
    else if (next === 'E') {
      this.cursorX = 0
      this.lineFeed()
    } else if (next === 'M') this.reverseLineFeed()
    return index + 2
  }

  private handleCsi(body: string, final: string): void {
    const params = parseCsiParams(body)
    if (final === 'm') {
      this.applySgr(params)
      return
    }
    if (final === 'H' || final === 'f') {
      this.moveCursor((params[1] ?? 1) - 1, (params[0] ?? 1) - 1)
      return
    }
    if (final === 'A') {
      this.moveCursor(this.cursorX, this.cursorY - (params[0] || 1))
      return
    }
    if (final === 'B') {
      this.moveCursor(this.cursorX, this.cursorY + (params[0] || 1))
      return
    }
    if (final === 'C') {
      this.moveCursor(this.cursorX + (params[0] || 1), this.cursorY)
      return
    }
    if (final === 'D') {
      this.moveCursor(this.cursorX - (params[0] || 1), this.cursorY)
      return
    }
    if (final === 'G') {
      this.moveCursor((params[0] ?? 1) - 1, this.cursorY)
      return
    }
    if (final === 'd') {
      this.moveCursor(this.cursorX, (params[0] ?? 1) - 1)
      return
    }
    if (final === 'J') {
      this.clearDisplay(params[0] ?? 0)
      return
    }
    if (final === 'K') {
      this.clearLine(params[0] ?? 0)
      return
    }
    if (final === 's') this.saveCursor()
    else if (final === 'u') this.restoreCursor()
  }

  private applySgr(params: number[]): void {
    const values = params.length === 0 ? [0] : params
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index] ?? 0
      if (value === 0) this.style = {}
      else if (value === 1) this.style.fontWeight = 'bold'
      else if (value === 22) this.style.fontWeight = undefined
      else if (value >= 30 && value <= 37) this.style.foregroundColor = normalColors[value - 30]
      else if (value === 39) this.style.foregroundColor = undefined
      else if (value >= 40 && value <= 47) this.style.backgroundColor = normalColors[value - 40]
      else if (value === 49) this.style.backgroundColor = undefined
      else if (value >= 90 && value <= 97) this.style.foregroundColor = brightColors[value - 90]
      else if (value >= 100 && value <= 107) this.style.backgroundColor = brightColors[value - 100]
      else if (value === 38 && values[index + 1] === 5 && values[index + 2] !== undefined) {
        this.style.foregroundColor = ansiColor(values[index + 2]!)
        index += 2
      } else if (value === 48 && values[index + 1] === 5 && values[index + 2] !== undefined) {
        this.style.backgroundColor = ansiColor(values[index + 2]!)
        index += 2
      }
    }
  }

  private putCharacter(char: string): void {
    if (this.width === 0 || this.height === 0) return
    const width = characterDisplayWidth(char)
    if (width === 0) {
      const previous = this.cells[this.cursorY]?.[Math.max(0, this.cursorX - 1)]
      if (previous) previous.char += char
      return
    }
    if (this.cursorX >= this.width) {
      this.cursorX = 0
      this.lineFeed()
    }
    if (width === 2 && this.cursorX === this.width - 1) {
      this.cursorX = 0
      this.lineFeed()
    }

    this.cells[this.cursorY]![this.cursorX] = { char, ...this.style }
    if (width === 2 && this.cursorX + 1 < this.width) this.cells[this.cursorY]![this.cursorX + 1] = { char: ' ', ...this.style }
    this.cursorX += width
    if (this.cursorX >= this.width) {
      this.cursorX = 0
      this.lineFeed()
    }
  }

  private lineFeed(): void {
    if (this.height === 0) return
    if (this.cursorY >= this.height - 1) this.scrollUp()
    else this.cursorY += 1
  }

  private reverseLineFeed(): void {
    if (this.height === 0) return
    if (this.cursorY <= 0) {
      this.cells.pop()
      this.cells.unshift(this.blankRow())
    } else {
      this.cursorY -= 1
    }
  }

  private scrollUp(): void {
    if (this.height === 0) return
    this.cells.shift()
    this.cells.push(this.blankRow())
  }

  private clearDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.cells = Array.from({ length: this.height }, () => this.blankRow())
      return
    }
    if (mode === 1) {
      for (let y = 0; y < this.cursorY; y += 1) this.cells[y] = this.blankRow()
      for (let x = 0; x <= this.cursorX; x += 1) this.cells[this.cursorY]![x] = this.blankCell()
      return
    }
    for (let x = this.cursorX; x < this.width; x += 1) this.cells[this.cursorY]![x] = this.blankCell()
    for (let y = this.cursorY + 1; y < this.height; y += 1) this.cells[y] = this.blankRow()
  }

  private clearLine(mode: number): void {
    if (this.height === 0) return
    const start = mode === 0 ? this.cursorX : 0
    const end = mode === 1 ? this.cursorX + 1 : this.width
    for (let x = start; x < end; x += 1) this.cells[this.cursorY]![x] = this.blankCell()
  }

  private moveCursor(x: number, y: number): void {
    this.cursorX = clamp(Math.floor(x), 0, Math.max(0, this.width - 1))
    this.cursorY = clamp(Math.floor(y), 0, Math.max(0, this.height - 1))
  }

  private saveCursor(): void {
    this.savedX = this.cursorX
    this.savedY = this.cursorY
  }

  private restoreCursor(): void {
    this.moveCursor(this.savedX, this.savedY)
  }

  private reset(): void {
    this.style = {}
    this.cursorX = 0
    this.cursorY = 0
    this.clearDisplay(2)
  }

  private clampCursor(): void {
    this.cursorX = clamp(this.cursorX, 0, Math.max(0, this.width - 1))
    this.cursorY = clamp(this.cursorY, 0, Math.max(0, this.height - 1))
  }

  private blankRow(): TerminalCell[] {
    return Array.from({ length: this.width }, () => this.blankCell())
  }

  private blankCell(): TerminalCell {
    return { char: ' ' }
  }

  private cloneCell(cell: TerminalCell): TerminalCell {
    return { ...cell }
  }
}

class EmbeddedTerminalState implements EmbeddedTerminalHandle {
  private readonly screen = new TerminalScreenBuffer({ width: 80, height: 12 })
  private process?: EmbeddedTerminalProcess
  private pty?: EmbeddedTerminalPty
  private runningKey?: string
  private size: Size = { width: 80, height: 12 }
  private error?: string

  resize(cols: number, rows: number): void {
    const width = Math.max(0, Math.floor(cols))
    const height = Math.max(0, Math.floor(rows))
    if (width === this.size.width && height === this.size.height) return
    this.size = { width, height }
    this.screen.resize(this.size)
    this.pty?.resize(Math.max(1, width), Math.max(1, height))
  }

  write(data: string | Uint8Array): void {
    this.pty?.write(data)
  }

  kill(signal: number | NodeJS.Signals = 'SIGTERM'): void {
    try {
      this.process?.kill(signal)
    } catch {
      // Process may already have exited.
    }
  }

  render(buffer: RenderBuffer, bounds: Rect, clip: Rect): void {
    this.screen.renderTo(buffer, bounds, clip)
    if (this.error) buffer.write(bounds.x, bounds.y, this.error, clip, 'red')
  }

  async start(command: string[], options: EmbeddedTerminalOptions, taskKey: string, context: TaskContext): Promise<void> {
    if (this.runningKey === taskKey && this.process) return
    this.runningKey = taskKey
    this.error = undefined

    const spawn = options.spawn ?? spawnBunEmbeddedTerminal
    const process = spawn(command, {
      cwd: options.cwd,
      env: options.env,
      cols: Math.max(1, this.size.width),
      rows: Math.max(1, this.size.height),
      name: options.name ?? defaultTerminalName,
      onData: data => {
        this.screen.write(data)
        context.setNeedsUpdate()
      },
    })

    this.process = process
    this.pty = process.terminal
    options.onReady?.(this)
    context.signal.addEventListener('abort', () => this.kill(), { once: true })

    try {
      const code = await process.exited
      if (!context.signal.aborted) options.onExit?.(code)
    } catch (error) {
      if (!context.signal.aborted) {
        this.error = error instanceof Error ? error.message : String(error)
        context.setNeedsUpdate()
      }
    } finally {
      if (this.process === process) {
        this.process = undefined
        this.pty = undefined
        this.runningKey = undefined
      }
      context.setNeedsUpdate()
    }
  }
}

export class EmbeddedTerminalView extends BaseView {
  private readonly taskKey: string

  constructor(private readonly command: string[], private readonly options: EmbeddedTerminalOptions = {}) {
    super()
    this.taskKey = stableKey(options.restartKey ?? {
      command,
      cwd: options.cwd,
      env: options.env,
      name: options.name,
    })
  }

  measure(proposal: ProposedSize, _context: LayoutContext): Size {
    return {
      width: Math.max(0, Math.floor(proposal.width ?? 80)),
      height: Math.max(0, Math.floor(proposal.height ?? 12)),
    }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return

    const state = context.runtime?.getState<EmbeddedTerminalState>(context.path, () => new EmbeddedTerminalState())
    state?.resize(bounds.width, bounds.height)
    context.runtime?.markTaskVisible(context.path, this.taskKey, task => state?.start(this.command, this.options, this.taskKey, task))
    state?.render(context.buffer, bounds, visible)

    context.registerFocus({
      id: this.options.focusId ?? controlFocusId(context),
      bounds,
      fallback: true,
      handleKey: event => {
        if (!event.raw) return false
        state?.write(event.raw)
        return true
      },
    })
  }
}

export function EmbeddedTerminal(command: string[], options?: EmbeddedTerminalOptions): ViewNode {
  return new EmbeddedTerminalView(command, options)
}

export const spawnBunEmbeddedTerminal: EmbeddedTerminalSpawner = (command, options) => {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: options.cols,
      rows: options.rows,
      name: options.name,
      data(_terminal, data) {
        options.onData(data)
      },
    },
  })
  const terminal = process.terminal
  if (!terminal) throw new Error('Bun PTY terminal was not created.')
  return {
    terminal: {
      write: data => {
        terminal.write(data)
      },
      resize: (cols, rows) => terminal.resize(cols, rows),
    },
    exited: process.exited,
    kill: signal => process.kill(signal),
  }
}

function ansiColor(index: number): ForegroundColor {
  return Number.isInteger(index) && index >= 0 && index <= 255 ? ansi256(index) : 'primary'
}

function parseCsiParams(body: string): number[] {
  const normalized = body.replace(/[?=>]/g, '')
  if (normalized.length === 0) return []
  return normalized.split(';').map(value => {
    if (value.trim() === '') return 0
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  })
}

function stableKey(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
  return `{${Object.entries(value)
    .sort(([lhs], [rhs]) => lhs.localeCompare(rhs))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableKey(nested)}`)
    .join(',')}}`
}
