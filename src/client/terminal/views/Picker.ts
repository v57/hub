import { BaseView, controlFocusId, type RenderContext, type ViewNode } from '../view/base'
import { intersection, type Binding, type Rect, type Size } from '../types'
import { controlForeground, isControlBlocked, withLoadingLabel, type PickerOptions } from '../view/control'

export class PickerView<T> extends BaseView {
  constructor(private readonly label: string, private readonly options: T[], private readonly binding: Binding<T>, private readonly controlOptions: PickerOptions = {}) {
    super()
  }

  private current(): string {
    return withLoadingLabel(`${this.label}: ${this.options.length === 0 ? '-' : String(this.binding.get())}`, this.controlOptions)
  }

  measure(): Size {
    return { width: this.current().length + 2, height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = controlFocusId(context)
    context.registerFocus({
      id,
      bounds,
      activate: () => {
        if (isControlBlocked(this.controlOptions)) return
        if (this.options.length === 0) return
        const currentIndex = Math.max(0, this.options.findIndex(item => Object.is(item, this.binding.get())))
        this.binding.set(this.options[(currentIndex + 1) % this.options.length]!)
        this.setNeedsUpdate()
      },
    })
    const prefix = context.focusedId === id ? '> ' : ''
    context.buffer.write(bounds.x, bounds.y, `${prefix}${this.current()}`.slice(0, bounds.width), visible, controlForeground(context, this.controlOptions), context.fontWeight)
  }
}

export function Picker<T>(label: string, options: T[], binding: Binding<T>, controlOptions?: PickerOptions): ViewNode {
  return new PickerView(label, options, binding, controlOptions)
}
