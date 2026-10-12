import { BaseView, controlFocusId, type RenderContext, type ViewNode } from '../view/base'
import { intersection, type ForegroundColor, type Rect, type Size } from '../types'
import { controlForeground, isControlBlocked, withLoadingLabel, type ButtonOptions, type ControlOptions } from '../view/control'
import { Text } from './Text'
import { VStack } from './VStack'

export type ClipboardLike = {
  writeText(text: string): Promise<void> | void
}

export type CopyButtonOptions = ButtonOptions & {
  clipboard?: ClipboardLike
  fallback?: (text: string) => void
  copiedLabel?: string
  errorLabel?: string
}

type CopyButtonState = {
  copied: boolean
  error: boolean
}

export class CopyButtonView extends BaseView {
  constructor(
    private readonly label: string,
    private readonly text: string | (() => string),
    private readonly options: CopyButtonOptions = {},
  ) {
    super()
  }

  measure(): Size {
    const width = Math.max(
      this.label.length,
      (this.options.copiedLabel ?? 'Copied').length,
      (this.options.errorLabel ?? 'Copy failed').length,
    )
    return { width: width + 2, height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = controlFocusId(context)
    const state = context.runtime?.getState<CopyButtonState>(context.path, () => ({ copied: false, error: false })) ?? { copied: false, error: false }
    if (!isControlBlocked(this.options)) {
      context.registerControl({ id, binding: 'enter', title: this.label })
    }
    context.registerFocus({
      id,
      bounds,
      activate: () => {
        if (isControlBlocked(this.options)) return
        const value = typeof this.text === 'function' ? this.text() : this.text
        void this.copy(value, state)
      },
    })
    const focused = context.focusedId === id
    const label = withLoadingLabel(this.currentLabel(state), this.options)
    context.buffer.write(bounds.x, bounds.y, focused ? `>${label}<` : `[${label}]`, visible, state.error ? 'red' : state.copied ? 'green' : controlForeground(context, this.options) ?? 'tint', context.fontWeight)
  }

  private currentLabel(state: CopyButtonState): string {
    if (state.error) return this.options.errorLabel ?? 'Copy failed'
    if (state.copied) return this.options.copiedLabel ?? 'Copied'
    return this.label
  }

  private async copy(text: string, state: CopyButtonState): Promise<void> {
    try {
      const clipboard = this.options.clipboard ?? defaultClipboard()
      if (clipboard) await clipboard.writeText(text)
      else this.options.fallback?.(text)
      state.copied = true
      state.error = false
    } catch {
      state.copied = false
      state.error = true
    }
    this.setNeedsUpdate()
  }
}

export type StatusBadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'muted'

export function CopyButton(label: string, text: string | (() => string), options?: CopyButtonOptions): ViewNode {
  return new CopyButtonView(label, text, options)
}

export function StatusBadge(label: string, tone: StatusBadgeTone = 'default'): ViewNode {
  return Text(`[${label}]`).foregroundColor(toneColor(tone))
}

export function PanelSection(title: string, children: ViewNode[], options: ControlOptions = {}): ViewNode {
  return VStack([
    Text(title).fontWeight('bold').foregroundColor(options.role === 'destructive' ? 'red' : 'primary'),
    ...children,
  ], { spacing: 1 }).frame({ maxWidth: -1, alignment: 'topLeading' })
}

function toneColor(tone: StatusBadgeTone): ForegroundColor {
  if (tone === 'success') return 'green'
  if (tone === 'warning') return 'yellow'
  if (tone === 'danger') return 'red'
  if (tone === 'muted') return 'secondary'
  return 'cyan'
}

function defaultClipboard(): ClipboardLike | undefined {
  const navigator = (globalThis as typeof globalThis & { navigator?: { clipboard?: ClipboardLike } }).navigator
  return navigator?.clipboard
}
