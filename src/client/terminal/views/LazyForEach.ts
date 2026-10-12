import { BaseView, childRenderContext, type RenderContext, type ViewNode } from '../view/base'
import { clamp, intersection, rect, type Binding, type ProposedSize, type Rect, type Size } from '../types'
import { itemArray, rowId, type ItemSource, type RowBuilder, type RowId, type RowItem } from '../view/collections'
import { toView } from '../view/convert'

export type LazyForEachOptions<T> = {
  rowHeight?: number
  spacing?: number
  selection?: Binding<RowId | undefined>
  onActivate?: (item: T, index: number) => void
}

export class LazyForEachView<T> extends BaseView {
  constructor(
    private readonly items: ItemSource<T>,
    private readonly idFor: keyof T | ((item: T, index: number) => RowId),
    private readonly row: RowBuilder<T>,
    private readonly options: LazyForEachOptions<T> = {},
  ) {
    super()
  }

  private rows(): RowItem<T>[] {
    return itemArray(this.items).map((item, index) => ({ id: rowId(item, index, this.idFor), item, index }))
  }

  measure(proposal: ProposedSize): Size {
    const rows = this.rows()
    const rowHeight = Math.max(1, Math.floor(this.options.rowHeight ?? 1))
    const spacing = Math.max(0, Math.floor(this.options.spacing ?? 0))
    return { width: proposal.width ?? 1, height: rows.length * rowHeight + Math.max(0, rows.length - 1) * spacing }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const rows = this.rows()
    const rowHeight = Math.max(1, Math.floor(this.options.rowHeight ?? 1))
    const spacing = Math.max(0, Math.floor(this.options.spacing ?? 0))
    const step = rowHeight + spacing
    const start = clamp(Math.floor((visible.y - bounds.y) / step), 0, rows.length)
    const end = clamp(Math.ceil((visible.y + visible.height - bounds.y) / step), 0, rows.length)
    for (let index = start; index < end; index += 1) {
      const row = rows[index]!
      const selected = Object.is(this.options.selection?.get(), row.id)
      const child = toView(this.row(row.item, row.index, selected))
      const y = bounds.y + index * step
      const rowBounds = rect(bounds.x, y, bounds.width, rowHeight)
      const rowVisible = intersection(rowBounds, context.clip)
      if (!rowVisible) continue
      const focusId = `${context.path}.row:${row.id}`
      context.registerFocus({
        id: focusId,
        bounds: rowBounds,
        activate: () => {
          this.options.selection?.set(row.id)
          this.options.onActivate?.(row.item, row.index)
        },
      })
      if (selected) context.buffer.fill(rowBounds, 'gray', rowVisible)
      child.installRuntime(context.runtime!, `${context.path}.row:${row.id}`)
      child.render(rowBounds, {
        ...childRenderContext(context, `row:${row.id}`, rowVisible),
        registerFocus: () => {},
        focusedId: undefined,
      })
    }
  }
}

export function LazyForEach<T>(
  items: ItemSource<T>,
  id: keyof T | ((item: T, index: number) => RowId),
  builder: RowBuilder<T>,
  options?: LazyForEachOptions<T>,
): ViewNode {
  return new LazyForEachView(items, id, builder, options)
}
