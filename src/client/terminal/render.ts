import { characterDisplayWidth, intersection, isAnsi256Color, rect, type BackgroundColor, type FontWeight, type ForegroundColor, type NamedColor, type Rect, type Size } from './types'

type RenderCell = {
  char: string
  backgroundColor?: BackgroundColor
  foregroundColor?: ForegroundColor
  fontWeight?: FontWeight
}

const foregroundAnsi: Record<NamedColor, string> = {
  primary: '39',
  secondary: '90',
  tint: '38;5;208',
  black: '30',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  white: '97',
  gray: '90',
}

const backgroundAnsi: Record<NamedColor, string> = {
  primary: '49',
  secondary: '100',
  tint: '48;5;208',
  black: '40',
  red: '41',
  green: '42',
  yellow: '43',
  blue: '44',
  magenta: '45',
  cyan: '46',
  white: '107',
  gray: '100',
}

function colorKey(color: ForegroundColor | BackgroundColor | undefined): string | undefined {
  if (!color) return undefined
  return isAnsi256Color(color) ? `ansi256:${color.index}` : color
}

function foregroundCode(color: ForegroundColor): string {
  return isAnsi256Color(color) ? `38;5;${color.index}` : foregroundAnsi[color]
}

function backgroundCode(color: BackgroundColor): string {
  return isAnsi256Color(color) ? `48;5;${color.index}` : backgroundAnsi[color]
}

export class RenderBuffer {
  readonly width: number
  readonly height: number
  private readonly cells: RenderCell[][]

  constructor(size: Size) {
    this.width = Math.max(0, Math.floor(size.width))
    this.height = Math.max(0, Math.floor(size.height))
    this.cells = Array.from({ length: this.height }, () => Array.from({ length: this.width }, () => ({ char: ' ' })))
  }

  write(
    x: number,
    y: number,
    text: string,
    clip: Rect = this.bounds,
    foregroundColor?: ForegroundColor,
    fontWeight?: FontWeight,
    backgroundColor?: BackgroundColor,
  ): void {
    const row = Math.floor(y)
    if (row < clip.y || row >= clip.y + clip.height || row < 0 || row >= this.height) return

    let column = Math.floor(x)
    for (const char of text) {
      const width = characterDisplayWidth(char)
      if (width === 0) {
        const previous = this.cells[row]?.[column - 1]
        if (previous) previous.char += char
        continue
      }
      const existing = this.cells[row]?.[column]
      const nextBackground = backgroundColor ?? existing?.backgroundColor
      if (column >= clip.x && column < clip.x + clip.width && column >= 0 && column < this.width) {
        this.cells[row]![column] = { char, foregroundColor, fontWeight, backgroundColor: nextBackground }
      }
      if (width === 2 && column + 1 >= clip.x && column + 1 < clip.x + clip.width && column + 1 >= 0 && column + 1 < this.width) {
        const trailing = this.cells[row]?.[column + 1]
        this.cells[row]![column + 1] = { char: ' ', foregroundColor, fontWeight, backgroundColor: backgroundColor ?? trailing?.backgroundColor }
      }
      column += width
    }
  }

  fill(rectangle: Rect, backgroundColor: BackgroundColor, clip: Rect = this.bounds): void {
    const visible = intersection(rectangle, clip)
    if (!visible) return
    for (let y = visible.y; y < visible.y + visible.height; y += 1) {
      for (let x = visible.x; x < visible.x + visible.width; x += 1) {
        const current = this.cells[y]?.[x] ?? { char: ' ' }
        this.cells[y]![x] = { ...current, backgroundColor }
      }
    }
  }

  copyFrom(source: RenderBuffer, sourceRect: Rect, targetX: number, targetY: number, clip: Rect = this.bounds): void {
    const sourceClip = intersection(sourceRect, rect(0, 0, source.width, source.height))
    if (!sourceClip) return

    for (let y = 0; y < sourceClip.height; y += 1) {
      for (let x = 0; x < sourceClip.width; x += 1) {
        const cell = source.cells[sourceClip.y + y]?.[sourceClip.x + x] ?? { char: ' ' }
        this.write(targetX + x, targetY + y, cell.char, clip, cell.foregroundColor, cell.fontWeight, cell.backgroundColor)
      }
    }
  }

  toString(): string {
    return this.cells.map(row => row.map(cell => cell.char).join('')).join('\n')
  }

  toAnsiString(): string {
    return this.cells.map(row => {
      let current: ForegroundColor | undefined
      let currentBackground: BackgroundColor | undefined
      let currentKey: string | undefined
      let currentBackgroundKey: string | undefined
      let currentWeight: FontWeight | undefined
      let output = ''
      for (const cell of row) {
        if (cell.fontWeight !== currentWeight) {
          const previousWeight = currentWeight
          currentWeight = cell.fontWeight
          if (currentWeight === 'bold') output += '\x1b[1m'
          else if (previousWeight === 'bold' || currentWeight === 'regular') output += '\x1b[22m'
        }
        const nextKey = colorKey(cell.foregroundColor)
        if (nextKey !== currentKey) {
          current = cell.foregroundColor
          currentKey = nextKey
          output += current ? `\x1b[${foregroundCode(current)}m` : '\x1b[39m'
        }
        const nextBackgroundKey = colorKey(cell.backgroundColor)
        if (nextBackgroundKey !== currentBackgroundKey) {
          currentBackground = cell.backgroundColor
          currentBackgroundKey = nextBackgroundKey
          output += currentBackground ? `\x1b[${backgroundCode(currentBackground)}m` : '\x1b[49m'
        }
        output += cell.char
      }
      if (current) output += '\x1b[39m'
      if (currentBackground) output += '\x1b[49m'
      if (currentWeight === 'bold') output += '\x1b[22m'
      return output
    }).join('\n')
  }

  get bounds(): Rect {
    return rect(0, 0, this.width, this.height)
  }
}
