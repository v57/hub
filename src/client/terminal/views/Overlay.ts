import { BaseView, type RenderContext, type ViewNode } from '../view/base'
import { clamp, displayWidth, intersection, rect, truncateDisplay, type Binding, type ForegroundColor, type Rect, type Size } from '../types'

export type OverlayAction = {
  label: string
  action?: () => void
  role?: 'default' | 'cancel' | 'destructive'
}

export type OverlayOptions = {
  title?: string
  message?: string
  actions?: OverlayAction[]
}

type OverlayState = {
  selected: number
  previousFocus?: string
  wasOpen: boolean
  query: string
}

export class OverlayView extends BaseView {
  constructor(private readonly open: Binding<boolean>, private readonly kind: 'alert' | 'dialog' | 'sheet' | 'command', private readonly content: ViewNode | string | undefined, private readonly options: OverlayOptions = {}) {
    super()
  }

  measure(): Size {
    return { width: 0, height: 0 }
  }

  render(_bounds: Rect, context: RenderContext): void {
    const state = context.runtime?.getState<OverlayState>(context.path, () => ({ selected: 0, wasOpen: false, query: '' }))
    if (!state) return
    if (this.open.get() && !state.wasOpen) {
      state.previousFocus = context.focusedId
      context.runtime?.requestFocus(context.path)
    }
    state.wasOpen = this.open.get()
    if (!this.open.get()) return

    const actions = this.actions(state)
    state.selected = clamp(state.selected, 0, Math.max(0, actions.length - 1))
    context.registerFocus({
      id: context.path,
      bounds: context.clip,
      handleKey: event => {
        if (event.key === 'escape') {
          this.close(context, state)
          return true
        }
        if (event.key === 'down') {
          state.selected = clamp(state.selected + 1, 0, Math.max(0, actions.length - 1))
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'up') {
          state.selected = clamp(state.selected - 1, 0, Math.max(0, actions.length - 1))
          this.setNeedsUpdate()
          return true
        }
        if (this.kind === 'command' && event.key === 'char') {
          state.query += event.char
          state.selected = 0
          this.setNeedsUpdate()
          return true
        }
        if (this.kind === 'command' && event.key === 'backspace') {
          state.query = state.query.slice(0, -1)
          state.selected = 0
          this.setNeedsUpdate()
          return true
        }
        if (event.key === 'enter') {
          actions[state.selected]?.action?.()
          this.close(context, state)
          return true
        }
        return true
      },
    })
    context.runtime?.requestFocus(context.path)
    context.registerTopLayer(() => this.renderOverlay(context, state, actions))
  }

  private actions(state: OverlayState): OverlayAction[] {
    if (this.kind !== 'command') return this.options.actions ?? [{ label: 'OK' }]
    const query = state.query.toLowerCase()
    return (this.options.actions ?? []).filter(action => action.label.toLowerCase().includes(query))
  }

  private close(context: RenderContext, state: OverlayState): void {
    this.open.set(false)
    state.wasOpen = false
    context.runtime?.requestFocus(state.previousFocus)
    this.setNeedsUpdate()
  }

  private renderOverlay(context: RenderContext, state: OverlayState, actions: OverlayAction[]): void {
    const contentLines = this.contentLines(state)
    const actionLines = actions.length === 0 ? ['(empty)'] : actions.map((action, index) => `${index === state.selected ? '>' : ' '} ${action.label}`)
    const title = this.options.title ?? (this.kind === 'command' ? 'Command Palette' : this.kind[0]!.toUpperCase() + this.kind.slice(1))
    const lines = [title, ...contentLines, ...actionLines]
    const width = Math.min(context.clip.width, Math.max(12, ...lines.map(line => displayWidth(line) + 4)))
    const height = Math.min(context.clip.height, lines.length + 2)
    const x = context.clip.x + Math.max(0, Math.floor((context.clip.width - width) / 2))
    const y = this.kind === 'sheet' ? context.clip.y + Math.max(0, context.clip.height - height) : context.clip.y + Math.max(0, Math.floor((context.clip.height - height) / 2))
    const bounds = rect(x, y, width, height)
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    context.buffer.fill(context.clip, 'black', context.clip)
    context.buffer.write(x, y, `+${'-'.repeat(Math.max(0, width - 2))}+`, visible, 'tint', context.fontWeight)
    for (let index = 0; index < height - 2; index += 1) {
      const line = lines[index] ?? ''
      const color: ForegroundColor | undefined = index === 0 ? 'tint' : actions[index - 1 - contentLines.length]?.role === 'destructive' ? 'red' : context.foregroundColor
      context.buffer.write(x, y + index + 1, `|${truncateDisplay(line, width - 2, 'clip').padEnd(width - 2)}|`, visible, color, index === 0 ? 'bold' : context.fontWeight)
    }
    context.buffer.write(x, y + height - 1, `+${'-'.repeat(Math.max(0, width - 2))}+`, visible, 'tint', context.fontWeight)
  }

  private contentLines(state: OverlayState): string[] {
    const lines: string[] = []
    if (this.options.message) lines.push(...this.options.message.split(/\r?\n/))
    if (this.kind === 'command') lines.push(`/${state.query}`)
    if (typeof this.content === 'string') lines.push(...this.content.split(/\r?\n/))
    return lines
  }
}

export function Alert(open: Binding<boolean>, options?: OverlayOptions): ViewNode {
  return new OverlayView(open, 'alert', undefined, options)
}

export function Dialog(open: Binding<boolean>, content: ViewNode | string, options?: OverlayOptions): ViewNode {
  return new OverlayView(open, 'dialog', content, options)
}

export function Sheet(open: Binding<boolean>, content: ViewNode | string, options?: OverlayOptions): ViewNode {
  return new OverlayView(open, 'sheet', content, options)
}

export function CommandPalette(open: Binding<boolean>, commands: OverlayAction[], options?: Omit<OverlayOptions, 'actions'>): ViewNode {
  return new OverlayView(open, 'command', undefined, { ...options, actions: commands })
}
