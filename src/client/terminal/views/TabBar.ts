import { BaseView, controlFocusId, type RenderContext, type ViewNode } from '../view/base'
import { intersection, type Binding, type Rect, type Size } from '../types'
import { controlForeground, isControlBlocked, withLoadingLabel, type TabBarOptions } from '../view/control'

export class TabBarView<T> extends BaseView {
  constructor(private readonly tabs: T[], private readonly binding: Binding<T>, private readonly options: TabBarOptions = {}) {
    super()
  }

  private rendered(): string {
    if (this.tabs.length === 0) return '[empty]'
    const rendered = this.tabs.map(tab => (Object.is(tab, this.binding.get()) ? `[${String(tab)}]` : ` ${String(tab)} `)).join(' ')
    return withLoadingLabel(rendered, this.options)
  }

  private advance(): void {
    if (isControlBlocked(this.options)) return
    if (this.tabs.length === 0) return
    const currentIndex = Math.max(0, this.tabs.findIndex(tab => Object.is(tab, this.binding.get())))
    this.binding.set(this.tabs[(currentIndex + 1) % this.tabs.length]!)
    this.setNeedsUpdate()
  }

  measure(): Size {
    return { width: this.rendered().length, height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = controlFocusId(context)
    context.registerTabBar(() => this.advance())
    context.registerFocus({ id, bounds, activate: () => this.advance() })
    context.buffer.write(bounds.x, bounds.y, this.rendered().slice(0, bounds.width), visible, controlForeground(context, this.options), context.fontWeight)
  }
}

export function TabBar<T>(tabs: T[], binding: Binding<T>, options?: TabBarOptions): ViewNode {
  return new TabBarView(tabs, binding, options)
}
