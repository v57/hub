import { BaseView, type RenderContext, type ViewNode } from '../view/base'
import { clamp01, intersection, type Binding, type ProgressBarStyle, type ProposedSize, type Rect, type Size } from '../types'

export type ProgressBarOptions = {
  style?: ProgressBarStyle
}

export class ProgressBarView extends BaseView {
  constructor(private readonly value: number | Binding<number>, private readonly options: ProgressBarOptions = {}) {
    super()
  }

  private progress(): number {
    return clamp01(typeof this.value === 'number' ? this.value : this.value.get())
  }

  measure(proposal: ProposedSize): Size {
    if (this.options.style === 'compact') return { width: 1, height: 1 }
    return { width: Math.max(1, proposal.width ?? 10), height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const progress = this.progress()
    if (this.options.style === 'compact') {
      context.buffer.write(bounds.x, bounds.y, progress >= 1 ? '#' : progress > 0 ? '+' : '.', visible, context.foregroundColor, context.fontWeight)
      return
    }

    const width = Math.max(1, bounds.width)
    const filled = Math.round(progress * width)
    context.buffer.write(bounds.x, bounds.y, `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`, visible, context.foregroundColor, context.fontWeight)
  }
}

export function ProgressBar(value: number | Binding<number>, options?: ProgressBarOptions): ViewNode {
  return new ProgressBarView(value, options)
}
