import { BaseView, childContext, childRenderContext, type LayoutContext, type RenderContext, type ViewNode } from '../view/base'
import { intersection, rect, type ProposedSize, type Rect, type Size } from '../types'
import { itemArray, rowId, type ItemSource, type RowId, type RowItem } from '../view/collections'

export type GridColumnSpec =
  | { kind: 'fixed'; width: number }
  | { kind: 'flexible'; min?: number; max?: number; weight?: number }
  | { kind: 'adaptive'; min: number; max?: number }

export const GridColumn = {
  fixed: (width: number): GridColumnSpec => ({ kind: 'fixed', width }),
  flexible: (options: { min?: number; max?: number; weight?: number } = {}): GridColumnSpec => ({ kind: 'flexible', ...options }),
  adaptive: (min: number, max?: number): GridColumnSpec => ({ kind: 'adaptive', min, max }),
}

export type GridOptions = {
  rowSpacing?: number
  columnSpacing?: number
}

export class GridView<T> extends BaseView {
  constructor(
    private readonly items: ItemSource<T>,
    private readonly idFor: keyof T | ((item: T, index: number) => RowId),
    private readonly columns: GridColumnSpec[],
    private readonly builder: (item: T, index: number) => ViewNode,
    private readonly options: GridOptions = {},
    private readonly lazy = false,
  ) {
    super()
  }

  private rows(): RowItem<T>[] {
    return itemArray(this.items).map((item, index) => ({ id: rowId(item, index, this.idFor), item, index }))
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const columns = this.resolvedColumns(proposal.width)
    const rows = this.rows()
    if (columns.length === 0 || rows.length === 0) return { width: proposal.width ?? 0, height: 0 }
    const rowSpacing = this.options.rowSpacing ?? 0
    let height = 0
    for (let index = 0; index < rows.length; index += columns.length) {
      const rowItems = rows.slice(index, index + columns.length)
      const rowHeight = Math.max(...rowItems.map((item, offset) => this.builder(item.item, item.index).measure({ width: columns[offset] }, childContext(context, `cell:${item.id}`)).height), 1)
      height += rowHeight
      if (index + columns.length < rows.length) height += rowSpacing
    }
    const width = columns.reduce((sum, value) => sum + value, Math.max(0, columns.length - 1) * (this.options.columnSpacing ?? 1))
    return { width: proposal.width ?? width, height }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const columns = this.resolvedColumns(bounds.width)
    const rows = this.rows()
    if (columns.length === 0) return
    const columnSpacing = this.options.columnSpacing ?? 1
    const rowSpacing = this.options.rowSpacing ?? 0
    let y = bounds.y
    for (let index = 0; index < rows.length; index += columns.length) {
      const rowItems = rows.slice(index, index + columns.length)
      const views = rowItems.map(row => ({ row, view: this.builder(row.item, row.index) }))
      const rowHeight = Math.max(...views.map((entry, offset) => entry.view.measure({ width: columns[offset] }, childContext(context, `cell:${entry.row.id}`)).height), 1)
      const rowBounds = rect(bounds.x, y, bounds.width, rowHeight)
      const rowVisible = intersection(rowBounds, context.clip)
      if (rowVisible || !this.lazy) {
        let x = bounds.x
        views.forEach((entry, offset) => {
          const width = columns[offset] ?? 0
          const cellBounds = rect(x, y, width, rowHeight)
          if (intersection(cellBounds, context.clip)) {
            entry.view.installRuntime(context.runtime!, `${context.path}.cell:${entry.row.id}`)
            entry.view.render(cellBounds, childRenderContext(context, `cell:${entry.row.id}`, context.clip))
          }
          x += width + columnSpacing
        })
      }
      y += rowHeight + rowSpacing
    }
  }

  private resolvedColumns(width: number | undefined): number[] {
    const spacing = Math.max(0, this.columns.length - 1) * (this.options.columnSpacing ?? 1)
    const resolved: number[] = []
    for (const column of this.columns) {
      if (column.kind === 'adaptive') {
        const available = Math.max(0, width ?? column.min)
        const count = Math.max(1, Math.floor((available + (this.options.columnSpacing ?? 1)) / (column.min + (this.options.columnSpacing ?? 1))))
        const each = Math.min(column.max ?? Number.POSITIVE_INFINITY, Math.max(column.min, Math.floor((available - Math.max(0, count - 1) * (this.options.columnSpacing ?? 1)) / count)))
        for (let index = 0; index < count; index += 1) resolved.push(each)
      } else if (column.kind === 'fixed') resolved.push(Math.max(1, Math.floor(column.width)))
      else resolved.push(Math.max(1, Math.floor(column.min ?? 1)))
    }
    if (width === undefined) return resolved
    const flex = this.columns.map((column, index) => (column.kind === 'flexible' ? index : -1)).filter(index => index >= 0)
    const used = resolved.reduce((sum, value) => sum + value, spacing)
    let remaining = Math.max(0, width - used)
    const totalWeight = flex.reduce((sum, index) => sum + ((this.columns[index] as { weight?: number }).weight ?? 1), 0)
    for (const index of flex) {
      const column = this.columns[index] as { max?: number; weight?: number }
      const add = totalWeight > 0 ? Math.floor((remaining * (column.weight ?? 1)) / totalWeight) : 0
      resolved[index] = Math.min(column.max ?? Number.POSITIVE_INFINITY, resolved[index]! + add)
    }
    const total = resolved.reduce((sum, value) => sum + value, Math.max(0, resolved.length - 1) * (this.options.columnSpacing ?? 1))
    if (total > width && resolved.length > 0) resolved[resolved.length - 1] = Math.max(1, resolved[resolved.length - 1]! - (total - width))
    return resolved
  }
}

export function Grid<T>(
  items: ItemSource<T>,
  id: keyof T | ((item: T, index: number) => RowId),
  columns: GridColumnSpec[],
  builder: (item: T, index: number) => ViewNode,
  options?: GridOptions,
): ViewNode {
  return new GridView(items, id, columns, builder, options)
}

export function LazyGrid<T>(
  items: ItemSource<T>,
  id: keyof T | ((item: T, index: number) => RowId),
  columns: GridColumnSpec[],
  builder: (item: T, index: number) => ViewNode,
  options?: GridOptions,
): ViewNode {
  return new GridView(items, id, columns, builder, options, true)
}
