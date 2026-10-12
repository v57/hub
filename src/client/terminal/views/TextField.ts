import { BaseView, controlFocusId, type RenderContext, type ViewNode } from '../view/base'
import { clamp, intersection, type Binding, type ProposedSize, type Rect, type Size } from '../types'
import { controlForeground, isControlBlocked, isControlDisabled, type ControlOptions } from '../view/control'

export type TextFieldOptions = ControlOptions & {
  placeholder?: string
  onSubmit?: () => void
  secure?: boolean
  maskCharacter?: string
  multiline?: boolean
}

type TextFieldState = {
  cursor: number
  scroll: number
}

export class TextFieldView extends BaseView {
  constructor(private readonly binding: Binding<string>, private readonly options: TextFieldOptions = {}) {
    super()
  }

  private text(): string {
    return this.binding.get() || this.options.placeholder || ''
  }

  private displayText(value: string): string {
    if (!this.options.secure || !value) return value
    const mask = (this.options.maskCharacter || '*').charAt(0) || '*'
    return Array.from(value, char => (char === '\n' ? '\n' : mask)).join('')
  }

  measure(proposal: ProposedSize): Size {
    if (!this.options.multiline) return { width: proposal.width ?? Math.max(8, this.text().length), height: 1 }
    const lines = this.text().split('\n')
    const width = Math.max(8, ...lines.map(line => line.length))
    return { width: proposal.width ?? width, height: proposal.height ?? Math.max(2, lines.length) }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = controlFocusId(context)
    const state = context.runtime?.getState<TextFieldState>(context.path, () => ({ cursor: this.binding.get().length, scroll: 0 })) ?? { cursor: this.binding.get().length, scroll: 0 }
    state.cursor = clamp(state.cursor, 0, this.binding.get().length)
    context.registerFocus({
      id,
      bounds,
      activate: this.options.onSubmit,
      handleKey: event => {
        if (event.key === 'char') {
          if (isControlBlocked(this.options)) return true
          const value = this.binding.get()
          this.binding.set(`${value.slice(0, state.cursor)}${event.char}${value.slice(state.cursor)}`)
          state.cursor += event.char.length
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'backspace') {
          if (isControlBlocked(this.options)) return true
          if (state.cursor > 0) {
            const value = this.binding.get()
            this.binding.set(`${value.slice(0, state.cursor - 1)}${value.slice(state.cursor)}`)
            state.cursor -= 1
          }
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'delete') {
          if (isControlBlocked(this.options)) return true
          const value = this.binding.get()
          if (state.cursor < value.length) this.binding.set(`${value.slice(0, state.cursor)}${value.slice(state.cursor + 1)}`)
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'left') {
          state.cursor = Math.max(0, state.cursor - 1)
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'right') {
          state.cursor = Math.min(this.binding.get().length, state.cursor + 1)
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'home') {
          state.cursor = 0
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'end') {
          state.cursor = this.binding.get().length
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'enter' && this.options.multiline) {
          if (isControlBlocked(this.options)) return true
          const value = this.binding.get()
          this.binding.set(`${value.slice(0, state.cursor)}\n${value.slice(state.cursor)}`)
          state.cursor += 1
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'enter' && this.options.onSubmit) {
          if (isControlBlocked(this.options)) return true
          this.options.onSubmit()
          this.setNeedsUpdate()
          return true
        }
        return false
      },
    })
    const focused = context.focusedId === id
    const value = this.binding.get()
    let x = bounds.x
    let remaining = bounds.width
    if (focused && remaining > 0) {
      context.buffer.write(x, bounds.y, '>', visible, controlForeground(context, this.options), context.fontWeight)
      x += 1
      remaining -= 1
    }
    if (remaining <= 0) return
    const text = value ? this.displayText(value) : this.options.placeholder || ''
    const color = value ? controlForeground(context, this.options) : isControlDisabled(this.options) ? 'gray' : 'secondary'
    if (this.options.multiline) {
      const lines = text.split('\n')
      const cursorPrefix = this.displayText(value.slice(0, state.cursor))
      const cursorParts = cursorPrefix.split('\n')
      const cursorLine = cursorParts.length - 1
      const cursorColumn = cursorParts[cursorLine]?.length ?? 0
      state.scroll = clamp(state.scroll, 0, Math.max(0, lines.length - bounds.height))
      if (focused && value) {
        if (cursorLine < state.scroll) state.scroll = cursorLine
        if (cursorLine >= state.scroll + bounds.height) state.scroll = cursorLine - bounds.height + 1
      }
      const prefixWidth = focused ? 1 : 0
      const textX = bounds.x + prefixWidth
      const lineWidth = Math.max(0, bounds.width - prefixWidth)
      for (let index = 0; index < bounds.height; index += 1) {
        const lineIndex = state.scroll + index
        const line = lines[lineIndex] ?? ''
        if (focused && index === 0) context.buffer.write(bounds.x, bounds.y + index, '>', visible, controlForeground(context, this.options), context.fontWeight)
        else if (focused) context.buffer.write(bounds.x, bounds.y + index, ' ', visible, controlForeground(context, this.options), context.fontWeight)
        context.buffer.write(textX, bounds.y + index, line.slice(0, lineWidth), visible, color, context.fontWeight)
      }
      if (focused && value && cursorLine >= state.scroll && cursorLine < state.scroll + bounds.height && lineWidth > 0) {
        const cursorX = textX + clamp(cursorColumn, 0, Math.max(0, lineWidth - 1))
        const cursorY = bounds.y + cursorLine - state.scroll
        const line = lines[cursorLine] ?? ''
        context.buffer.write(cursorX, cursorY, cursorColumn >= line.length ? '|' : line[cursorColumn] ?? '|', visible, color, 'bold')
      }
      return
    }
    if (focused && value) {
      state.scroll = clamp(state.scroll, 0, Math.max(0, value.length - remaining))
      if (state.cursor < state.scroll) state.scroll = state.cursor
      if (state.cursor > state.scroll + remaining - 1) state.scroll = state.cursor - remaining + 1
      context.buffer.write(x, bounds.y, text.slice(state.scroll, state.scroll + remaining), visible, color, context.fontWeight)
      const cursorX = x + clamp(state.cursor - state.scroll, 0, Math.max(0, remaining - 1))
      context.buffer.write(cursorX, bounds.y, state.cursor >= value.length ? '|' : text[state.cursor] ?? '|', visible, color, 'bold')
    } else {
      context.buffer.write(x, bounds.y, text.slice(0, remaining), visible, color, context.fontWeight)
    }
  }
}

export function TextField(binding: Binding<string>, options?: TextFieldOptions): ViewNode {
  return new TextFieldView(binding, options)
}
