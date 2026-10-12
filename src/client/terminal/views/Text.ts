import { BaseView, type LayoutContext, type RenderContext, type ViewNode } from '../view/base'
import { displayWidth, intersection, sliceDisplay, truncateDisplay, type ProposedSize, type Rect, type Size } from '../types'

export type TextSource = string | number | Date | (() => unknown) | AsyncIterable<unknown> | (() => AsyncIterable<unknown>)

type TextState = {
  value: string
}

export type TextTruncationMode = 'head' | 'middle' | 'tail' | 'clip'

export type TextOptions = {
  wrap?: boolean
  lineLimit?: number
  truncation?: TextTruncationMode
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value)
}

function toDisplayString(value: unknown): string {
  if (value instanceof Date) return value.toString()
  if (value == null) return ''
  return String(value)
}

export class TextView extends BaseView {
  constructor(private readonly source: TextSource, private readonly options: TextOptions = {}) {
    super()
  }

  private resolve(context: LayoutContext): string {
    if (typeof this.source === 'function') {
      const state = context.runtime?.getState<TextState>(context.path, () => ({ value: '' }))
      const value = this.source()
      if (isAsyncIterable(value)) return state?.value ?? ''
      return toDisplayString(value)
    }

    if (isAsyncIterable(this.source)) {
      return context.runtime?.getState<TextState>(context.path, () => ({ value: '' })).value ?? ''
    }

    return toDisplayString(this.source)
  }

  private asyncIterator(): (() => AsyncIterator<unknown>) | undefined {
    if (typeof this.source === 'function') {
      const value = this.source()
      if (!isAsyncIterable(value)) return undefined
      return () => value[Symbol.asyncIterator]()
    }
    const source = this.source
    if (isAsyncIterable(source)) return () => source[Symbol.asyncIterator]()
    return undefined
  }

  private isAsyncSource(): boolean {
    if (typeof this.source === 'function') {
      const value = this.source()
      return isAsyncIterable(value)
    }
    return isAsyncIterable(this.source)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const lines = layoutText(this.resolve(context), proposal.width, this.options)
    const width = Math.max(this.isAsyncSource() ? 1 : 0, ...lines.map(line => displayWidth(line)), 0)
    return { width: Math.min(width, proposal.width ?? width), height: lines.length }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return

    const iterator = this.asyncIterator()
    if (iterator) {
      context.runtime?.markVisible(context.path, () => {
        const state = context.runtime!.getState<TextState>(context.path, () => ({ value: '' }))
        const inner = iterator()
        return {
          next: async () => {
            const result = await inner.next()
            if (!result.done) {
              state.value = toDisplayString(result.value)
              this.setNeedsUpdate()
            }
            return result
          },
          return: inner.return?.bind(inner),
          throw: inner.throw?.bind(inner),
        }
      })
    }

    const lines = layoutText(this.resolve(context), bounds.width, this.options).slice(0, bounds.height)
    lines.forEach((line, index) => {
      context.buffer.write(bounds.x, bounds.y + index, line, visible, context.foregroundColor, context.fontWeight)
    })
  }
}

function layoutText(text: string, width: number | undefined, options: TextOptions): string[] {
  const maxWidth = width === undefined ? undefined : Math.max(0, Math.floor(width))
  const sourceLines = text.split(/\r?\n/)
  const lines: string[] = []
  for (const sourceLine of sourceLines) {
    if (options.wrap && maxWidth !== undefined && maxWidth > 0) {
      let remaining = sourceLine
      if (remaining.length === 0) lines.push('')
      while (remaining.length > 0) {
        const line = sliceDisplay(remaining, maxWidth)
        lines.push(line)
        remaining = remaining.slice(line.length)
        if (line.length === 0) break
      }
    } else {
      lines.push(maxWidth === undefined ? sourceLine : truncateDisplay(sourceLine, maxWidth, options.truncation ?? 'clip'))
    }
  }

  const limited = options.lineLimit === undefined ? lines : lines.slice(0, Math.max(0, Math.floor(options.lineLimit)))
  if (maxWidth !== undefined && !options.wrap && options.truncation && options.truncation !== 'clip') {
    return limited.map(line => truncateDisplay(line, maxWidth, options.truncation))
  }
  return limited.length > 0 ? limited : ['']
}

export function Text(source: TextSource, options?: TextOptions): ViewNode {
  return new TextView(source, options)
}
