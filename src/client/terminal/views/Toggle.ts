import { BaseView, controlFocusId, type RenderContext, type ViewNode } from '../view/base'
import { intersection, type Binding, type Rect, type Size } from '../types'
import { controlForeground, isControlBlocked, withLoadingLabel, type ToggleOptions } from '../view/control'

export class ToggleView extends BaseView {
  constructor(private readonly label: string, private readonly binding: Binding<boolean>, private readonly options: ToggleOptions = {}) {
    super()
  }

  measure(): Size {
    return { width: withLoadingLabel(this.label, this.options).length + 5, height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = controlFocusId(context)
    context.registerFocus({
      id,
      bounds,
      activate: () => {
        if (isControlBlocked(this.options)) return
        this.binding.set(!this.binding.get())
        this.setNeedsUpdate()
      },
    })
    const mark = this.binding.get() ? 'x' : ' '
    const prefix = context.focusedId === id ? '>' : ''
    context.buffer.write(bounds.x, bounds.y, `${prefix}[${mark}] ${withLoadingLabel(this.label, this.options)}`.slice(0, bounds.width), visible, controlForeground(context, this.options), context.fontWeight)
  }
}

export function Toggle(label: string, binding: Binding<boolean>, options?: ToggleOptions): ViewNode {
  return new ToggleView(label, binding, options)
}
