import {
  BaseView,
  childContext,
  childRenderContext,
  controlFocusId,
  type LayoutContext,
  type NavigationController,
  type NavigationRouteValue,
  type RenderContext,
  type ViewNode,
} from '../view/base'
import { intersection, type Binding, type ProposedSize, type Rect, type Size } from '../types'

function routeKey(value: NavigationRouteValue): string {
  return encodeURIComponent(String(value))
}

export class NavigationStackView<T extends NavigationRouteValue> extends BaseView {
  constructor(
    private readonly pathBinding: Binding<T[]>,
    private readonly root: () => ViewNode,
    private readonly destination: (value: T) => ViewNode,
  ) {
    super()
  }

  private active(): { segment: string; view: ViewNode } {
    const path = this.pathBinding.get()
    const value = path.at(-1)
    if (value === undefined) return { segment: 'navigation.root', view: this.root() }
    return { segment: `navigation.route:${routeKey(value)}`, view: this.destination(value) }
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const active = this.active()
    return active.view.measure(proposal, childContext(context, active.segment))
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return

    const active = this.active()
    active.view.installRuntime(context.runtime!, `${context.path}.${active.segment}`)
    if (this.pathBinding.get().length > 0) {
      context.registerFocus({
        id: `${context.path}.navigation.escape`,
        bounds,
        fallback: true,
        handleKey: event => {
          if (event.key !== 'escape') return false
          const path = this.pathBinding.get()
          if (path.length === 0) return false
          this.pathBinding.set(path.slice(0, -1))
          this.setNeedsUpdate()
          return true
        },
      })
    }
    const controller: NavigationController<T> = {
      path: this.pathBinding.get(),
      push: value => {
        this.pathBinding.set([...this.pathBinding.get(), value])
        this.setNeedsUpdate()
      },
      pop: () => {
        this.pathBinding.set(this.pathBinding.get().slice(0, -1))
        this.setNeedsUpdate()
      },
    }

    active.view.render(
      bounds,
      childRenderContext(
        {
          ...context,
          navigation: controller as NavigationController,
        },
        active.segment,
        visible,
      ),
    )
  }
}

export class NavigationLinkView<T extends NavigationRouteValue> extends BaseView {
  constructor(
    private readonly label: string,
    private readonly value: T,
    private readonly detail?: string,
  ) {
    super()
  }

  measure(): Size {
    return { width: this.label.length + 3, height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = controlFocusId(context)
    context.registerControl({ id, binding: 'enter', title: this.label, detail: this.detail })
    context.registerFocus({
      id,
      bounds,
      activate: () => {
        context.navigation?.push(this.value)
        this.setNeedsUpdate()
      },
    })
    const focused = context.focusedId === id
    context.buffer.write(
      bounds.x,
      bounds.y,
      `${this.label}`,
      visible,
      focused ? 'blue' : (context.foregroundColor ?? 'tint'),
      context.fontWeight,
    )
  }
}

export class NavigationBackButtonView extends BaseView {
  constructor(private readonly label = 'Back') {
    super()
  }

  measure(): Size {
    return { width: this.label.length + 3, height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = controlFocusId(context)
    context.registerControl({ id, binding: 'enter', title: this.label })
    context.registerFocus({
      id,
      bounds,
      activate: () => {
        context.navigation?.pop()
        this.setNeedsUpdate()
      },
    })
    const focused = context.focusedId === id
    context.buffer.write(
      bounds.x,
      bounds.y,
      focused ? `<${this.label}<` : `<${this.label}]`,
      visible,
      context.foregroundColor ?? 'tint',
      context.fontWeight,
    )
  }
}

export function NavigationStack<T extends NavigationRouteValue>(
  path: Binding<T[]>,
  root: () => ViewNode,
  destination: (value: T) => ViewNode,
): ViewNode {
  return new NavigationStackView(path, root, destination)
}

export function NavigationLink<T extends NavigationRouteValue>(label: string, value: T, detail?: string): ViewNode {
  return new NavigationLinkView(label, value, detail)
}

export function NavigationBackButton(label?: string): ViewNode {
  return new NavigationBackButtonView(label)
}
