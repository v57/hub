export type Alignment =
  | 'leading'
  | 'center'
  | 'trailing'
  | 'top'
  | 'bottom'
  | 'topLeading'
  | 'topTrailing'
  | 'bottomLeading'
  | 'bottomTrailing'

export type StackAlignment = 'leading' | 'center' | 'trailing'
export type CrossAlignment = 'top' | 'center' | 'bottom'

export type Size = {
  width: number
  height: number
}

export type ProposedSize = {
  width?: number
  height?: number
}

export type Point = {
  x: number
  y: number
}

export type Rect = Point & Size

export type FrameOptions = {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  alignment?: Alignment
}

export type KeyModifier = 'shift' | 'alt' | 'ctrl' | 'meta'

export type KeyEventMetadata = {
  modifiers?: KeyModifier[]
  raw?: string
}

export type KeyEvent = (
  | { key: 'up' }
  | { key: 'down' }
  | { key: 'left' }
  | { key: 'right' }
  | { key: 'pageUp' }
  | { key: 'pageDown' }
  | { key: 'home' }
  | { key: 'end' }
  | { key: 'delete' }
  | { key: 'enter' }
  | { key: 'tab' }
  | { key: 'backspace' }
  | { key: 'escape' }
  | { key: 'ctrl-c' }
  | { key: 'char'; char: string }
  | { key: 'raw'; sequence: string }
  | { key: 'mouse'; action: 'down' | 'up' | 'drag' | 'scroll'; x: number; y: number; button?: number }
) &
  KeyEventMetadata

export type Binding<T> = {
  get(): T
  set(value: T): void
}

export type MutableBinding<T> = Binding<T> & {
  value: T
}

export type Cleanup = () => void

export type FocusDirection = 'top' | 'bottom' | 'left' | 'right'

export type FocusCandidate = {
  id: string
  bounds: Rect
  sourceOrder: number
  fallback?: boolean
  activate?: () => void
  handleKey?: (event: KeyEvent) => boolean
}

export type ProgressBarStyle = 'full' | 'compact'

export type NamedColor = 'primary' | 'secondary' | 'tint' | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray'

export type Ansi256Color = {
  readonly kind: 'ansi256'
  readonly index: number
}

export type ForegroundColor = NamedColor | Ansi256Color

export type BackgroundColor = ForegroundColor

export type FontWeight = 'regular' | 'bold'

export type TerminalDevice = {
  getSize(): Size
  write(text: string): void
  writeFrame?(text: string, previous: string | undefined, force: boolean): void
  onResize(callback: () => void): Cleanup
  onKey?(callback: (event: KeyEvent) => void): Cleanup
  setRawMode?(enabled: boolean): void
  requestInterruptExit?(): void
  enableMouse?(enabled: boolean): void
}

export function ansi256(index: number): Ansi256Color {
  if (!Number.isInteger(index) || index < 0 || index > 255) throw new RangeError(`ANSI 256 color index must be an integer from 0 to 255: ${index}`)
  return { kind: 'ansi256', index }
}

export function isAnsi256Color(color: ForegroundColor | BackgroundColor | undefined): color is Ansi256Color {
  return Boolean(color && typeof color === 'object' && color.kind === 'ansi256')
}

export function State<T>(initial: T): MutableBinding<T> {
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

export function constant<T>(value: T): Binding<T> {
  return {
    get: () => value,
    set: () => {},
  }
}

export function binding<T>(get: () => T, set: (value: T) => void): Binding<T> {
  return { get, set }
}

export function derived<T>(get: () => T, set: (value: T) => void = () => {}): Binding<T> {
  return { get, set }
}

export function characterDisplayWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if ((code >= 0x0300 && code <= 0x036f) || (code >= 0x1ab0 && code <= 0x1aff) || (code >= 0x1dc0 && code <= 0x1dff)) return 0
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  ) {
    return 2
  }
  return 1
}

export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) width += characterDisplayWidth(char)
  return width
}

export function sliceDisplay(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  let width = 0
  let output = ''
  for (const char of text) {
    const charWidth = characterDisplayWidth(char)
    if (charWidth > 0 && width + charWidth > maxWidth) break
    output += char
    width += charWidth
  }
  return output
}

export function dropDisplay(text: string, widthToDrop: number): string {
  if (widthToDrop <= 0) return text
  let width = 0
  let index = 0
  for (const char of text) {
    const charWidth = characterDisplayWidth(char)
    if (charWidth > 0 && width + charWidth > widthToDrop) break
    width += charWidth
    index += char.length
  }
  return text.slice(index)
}

export function truncateDisplay(text: string, maxWidth: number, mode: 'head' | 'middle' | 'tail' | 'clip' = 'tail'): string {
  if (displayWidth(text) <= maxWidth) return text
  if (maxWidth <= 0) return ''
  if (mode === 'clip' || maxWidth === 1) return sliceDisplay(text, maxWidth)
  const marker = '…'
  const available = maxWidth - 1
  if (mode === 'head') return marker + dropDisplay(text, displayWidth(text) - available)
  if (mode === 'middle') {
    const head = Math.ceil(available / 2)
    const tail = Math.floor(available / 2)
    return sliceDisplay(text, head) + marker + dropDisplay(text, displayWidth(text) - tail)
  }
  return sliceDisplay(text, available) + marker
}

export function size(width: number, height: number): Size {
  return { width: Math.max(0, Math.floor(width)), height: Math.max(0, Math.floor(height)) }
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x: Math.floor(x), y: Math.floor(y), ...size(width, height) }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function intersection(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return undefined
  return rect(x, y, right - x, bottom - y)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1)
}

export function alignChild(container: Rect, child: Size, alignment: Alignment = 'center'): Rect {
  let x = container.x
  let y = container.y

  if (alignment === 'trailing' || alignment === 'topTrailing' || alignment === 'bottomTrailing') {
    x = container.x + container.width - child.width
  } else if (alignment === 'center' || alignment === 'top' || alignment === 'bottom') {
    x = container.x + Math.floor((container.width - child.width) / 2)
  }

  if (alignment === 'bottom' || alignment === 'bottomLeading' || alignment === 'bottomTrailing') {
    y = container.y + container.height - child.height
  } else if (alignment === 'center' || alignment === 'leading' || alignment === 'trailing') {
    y = container.y + Math.floor((container.height - child.height) / 2)
  }

  return rect(x, y, child.width, child.height)
}
