import { BaseView, childContext, childRenderContext, isBinding, type LayoutContext, type RenderContext, type RuntimeHooks, type ViewNode } from '../view/base'
import { clamp, intersection, rect, type Binding, type KeyEvent, type ProposedSize, type Rect, type Size } from '../types'

export type ScrollOptions = {
  axis?: 'vertical' | 'horizontal'
  offset?: number | Binding<number>
  anchor?: 'top' | 'bottom' | 'leading' | 'trailing'
}

type ScrollState = {
  offset: number
  manual: boolean
}

export class ScrollViewNode extends BaseView {
  constructor(private readonly child: ViewNode, private readonly options: ScrollOptions = {}) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.scroll`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const child = this.child.measure(proposal, childContext(context, 'scroll'))
    return {
      width: proposal.width ?? child.width,
      height: proposal.height ?? child.height,
    }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return

    const childSize = this.child.measure(
      this.options.axis === 'horizontal' ? { height: bounds.height } : { width: bounds.width },
      childContext(context, 'scroll'),
    )

    let x = bounds.x
    let y = bounds.y
    const boundOffset = isBinding(this.options.offset) ? this.options.offset : undefined
    if (this.options.axis === 'horizontal') {
      const maxOffset = Math.max(0, childSize.width - bounds.width)
      const state = context.runtime?.getState<ScrollState>(context.path, () => ({
        offset: typeof this.options.offset === 'number' ? this.options.offset : this.options.anchor === 'trailing' ? maxOffset : 0,
        manual: typeof this.options.offset === 'number',
      }))
      const rawOffset = boundOffset?.get() ?? (!state?.manual && this.options.anchor === 'trailing' ? maxOffset : state?.offset) ?? 0
      const offset = clamp(rawOffset, 0, maxOffset)
      if (!boundOffset && state) state.offset = offset
      x -= offset
      if (maxOffset > 0) {
        context.registerFocus({
          id: context.path,
          bounds,
          fallback: true,
          handleKey: event => this.handleScrollKey(event, offset, maxOffset, bounds.width, boundOffset, state),
        })
      }
    } else {
      const maxOffset = Math.max(0, childSize.height - bounds.height)
      const state = context.runtime?.getState<ScrollState>(context.path, () => ({
        offset: typeof this.options.offset === 'number' ? this.options.offset : this.options.anchor === 'bottom' ? maxOffset : 0,
        manual: typeof this.options.offset === 'number',
      }))
      const rawOffset = boundOffset?.get() ?? (!state?.manual && this.options.anchor === 'bottom' ? maxOffset : state?.offset) ?? 0
      const offset = clamp(rawOffset, 0, maxOffset)
      if (!boundOffset && state) state.offset = offset
      y -= offset
      if (maxOffset > 0) {
        context.registerFocus({
          id: context.path,
          bounds,
          fallback: true,
          handleKey: event => this.handleScrollKey(event, offset, maxOffset, bounds.height, boundOffset, state),
        })
      }
    }

    this.child.render(rect(x, y, childSize.width, childSize.height), childRenderContext(context, 'scroll', visible))
  }

  private handleScrollKey(event: KeyEvent, current: number, maxOffset: number, pageSize: number, binding: Binding<number> | undefined, state: ScrollState | undefined): boolean {
    const horizontal = this.options.axis === 'horizontal'
    let next = current
    if ((!horizontal && event.key === 'down') || (horizontal && event.key === 'right')) next += 1
    else if ((!horizontal && event.key === 'up') || (horizontal && event.key === 'left')) next -= 1
    else if (event.key === 'pageDown') next += Math.max(1, pageSize - 1)
    else if (event.key === 'pageUp') next -= Math.max(1, pageSize - 1)
    else if (event.key === 'home') next = 0
    else if (event.key === 'end') next = maxOffset
    else return false

    next = clamp(next, 0, maxOffset)
    binding?.set(next)
    if (!binding && state) {
      state.offset = next
      state.manual = true
    }
    this.setNeedsUpdate()
    return true
  }
}

export function ScrollView(child: ViewNode, options?: ScrollOptions): ViewNode {
  return new ScrollViewNode(child, options)
}
