import { BaseView, controlFocusId, type RenderContext, type ViewNode } from '../view/base'
import { intersection, type Rect, type Size } from '../types'
import { controlForeground, isControlBlocked, withLoadingLabel, type ButtonOptions } from '../view/control'

export class ButtonView extends BaseView {
  constructor(
    private readonly label: string,
    private readonly action: () => void,
    private readonly options: ButtonOptions = {},
  ) {
    super()
  }

  measure(): Size {
    return { width: withLoadingLabel(this.label, this.options).length + 2, height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = controlFocusId(context)
    if (!isControlBlocked(this.options)) {
      context.registerControl({ id, binding: 'enter', title: this.label })
    }
    context.registerFocus({
      id,
      bounds,
      activate: () => {
        if (isControlBlocked(this.options)) return
        this.action()
        this.setNeedsUpdate()
      },
    })
    const focused = context.focusedId === id
    const label = withLoadingLabel(this.label, this.options)
    context.buffer.write(
      bounds.x,
      bounds.y,
      `${label}`,
      visible,
      focused ? 'blue' : (controlForeground(context, this.options) ?? 'tint'),
      context.fontWeight,
    )
  }
}

export function Button(label: string, action: () => void, options?: ButtonOptions): ViewNode {
  return new ButtonView(label, action, options)
}
