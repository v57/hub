import { BaseView, childContext, childRenderContext, type LayoutContext, type RenderContext, type TaskContext, type ViewNode } from '../view/base'
import { intersection, rect, type ProposedSize, type Rect, type Size } from '../types'
import { toView } from '../view/convert'

export class TaskHostView extends BaseView {
  constructor(private readonly taskId: unknown, private readonly run: (context: TaskContext) => Promise<void> | void) {
    super()
  }

  measure(): Size {
    return { width: 0, height: 1 }
  }

  render(bounds: Rect, context: RenderContext): void {
    if (!intersection(rect(bounds.x, bounds.y, Math.max(1, bounds.width), 1), context.clip)) return
    context.runtime?.markTaskVisible(context.path, this.taskId, this.run)
  }
}

export type AsyncValueState<T> = {
  status: 'loading' | 'success' | 'error'
  value?: T
  error?: unknown
  retry: number
}

export type AsyncValueOptions<T> = {
  loading?: ViewNode | string
  error?: (error: unknown, retry: () => void) => ViewNode | string
  initial?: T
}

export class AsyncValueView<T> extends BaseView {
  constructor(private readonly valueId: unknown, private readonly load: (context: TaskContext) => Promise<T>, private readonly renderValue: (value: T) => ViewNode | string, private readonly options: AsyncValueOptions<T> = {}) {
    super()
  }

  private state(context: LayoutContext): AsyncValueState<T> {
    return context.runtime?.getState<AsyncValueState<T>>(context.path, () =>
      this.options.initial === undefined ? { status: 'loading', retry: 0 } : { status: 'success', value: this.options.initial, retry: 0 },
    ) ?? { status: 'loading', retry: 0 }
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.childView(context).measure(proposal, childContext(context, 'value'))
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const state = this.state(context)
    context.runtime?.markTaskVisible(`${context.path}.loader`, `${String(this.valueId)}:${state.retry}`, async taskContext => {
      state.status = state.value === undefined ? 'loading' : state.status
      try {
        const value = await this.load(taskContext)
        if (taskContext.signal.aborted) return
        state.status = 'success'
        state.value = value
        state.error = undefined
      } catch (error) {
        if (taskContext.signal.aborted) return
        state.status = 'error'
        state.error = error
      }
      taskContext.setNeedsUpdate()
    })
    this.childView(context).render(bounds, childRenderContext(context, 'value', visible))
  }

  private childView(context: LayoutContext): ViewNode {
    const state = this.state(context)
    if (state.status === 'success') return toView(this.renderValue(state.value as T))
    if (state.status === 'error') {
      const retry = () => {
        state.retry += 1
        state.status = state.value === undefined ? 'loading' : state.status
        this.setNeedsUpdate()
      }
      return toView(this.options.error?.(state.error, retry) ?? `Error: ${String(state.error)}`)
    }
    return toView(this.options.loading ?? 'Loading...')
  }
}

export function TaskHost(id: unknown, run: (context: TaskContext) => Promise<void> | void): ViewNode {
  return new TaskHostView(id, run)
}

export function Timer(intervalMs: number, tick: (date: Date) => void, id: unknown = `timer:${intervalMs}`): ViewNode {
  return TaskHost(id, async context => {
    while (!context.signal.aborted) {
      await new Promise(resolve => setTimeout(resolve, Math.max(1, intervalMs)))
      if (context.signal.aborted) return
      tick(new Date())
      context.setNeedsUpdate()
    }
  })
}

export function AsyncValue<T>(id: unknown, load: (context: TaskContext) => Promise<T>, render: (value: T) => ViewNode | string, options?: AsyncValueOptions<T>): ViewNode {
  return new AsyncValueView(id, load, render, options)
}
