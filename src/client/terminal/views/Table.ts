import { BaseView, controlFocusId, type LayoutContext, type RenderContext, type ViewNode } from '../view/base'
import { clamp, displayWidth, intersection, rect, truncateDisplay, type Binding, type KeyEvent, type ProposedSize, type Rect, type Size } from '../types'
import { clampedRow, itemArray, rowId, selectedRow, type ItemSource, type RowId, type RowItem, type SelectionState } from '../view/collections'

export type TableColumn<T> = {
  header: string
  width?: number | 'content' | { flexible: number; min?: number; max?: number }
  cell: keyof T | ((row: T, index: number) => string | number)
}

export type TableOptions<T> = {
  selection?: Binding<RowId | undefined>
  onActivate?: (row: T, index: number) => void
}

export class TableView<T> extends BaseView {
  constructor(
    private readonly rowsSource: ItemSource<T>,
    private readonly idFor: keyof T | ((item: T, index: number) => RowId),
    private readonly columns: TableColumn<T>[],
    private readonly options: TableOptions<T> = {},
  ) {
    super()
  }

  private rows(): RowItem<T>[] {
    return itemArray(this.rowsSource).map((item, index) => ({ id: rowId(item, index, this.idFor), item, index }))
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return { width: proposal.width ?? this.columnWidths(this.rows(), proposal.width, context).reduce((sum, value) => sum + value, Math.max(0, this.columns.length - 1)), height: this.rows().length + 2 }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const rows = this.rows()
    const widths = this.columnWidths(rows, bounds.width, context)
    const selected = this.selected(context, rows)
    context.buffer.write(bounds.x, bounds.y, this.renderCells(this.columns.map(column => column.header), widths), visible, context.foregroundColor ?? 'tint', 'bold')
    context.buffer.write(bounds.x, bounds.y + 1, widths.map(width => '-'.repeat(width)).join(' '), visible, context.foregroundColor ?? 'secondary', context.fontWeight)

    rows.forEach((row, index) => {
      const y = bounds.y + index + 2
      const rowBounds = rect(bounds.x, y, bounds.width, 1)
      const rowVisible = intersection(rowBounds, context.clip)
      if (!rowVisible) return
      const focusId = `${context.path}.row:${row.id}`
      context.registerFocus({
        id: focusId,
        bounds: rowBounds,
        activate: () => {
          this.setSelected(context, rows, index)
          this.options.onActivate?.(row.item, row.index)
        },
        handleKey: event => this.handleTableKey(event, context, rows, index, bounds.height - 2),
      })
      if (row.id === selected) context.buffer.fill(rowBounds, 'gray', rowVisible)
      const cells = this.columns.map(column => this.cellValue(column, row.item, row.index))
      context.buffer.write(bounds.x, y, this.renderCells(cells, widths), rowVisible, context.foregroundColor, context.fontWeight)
    })
  }

  private cellValue(column: TableColumn<T>, row: T, index: number): string {
    const value = typeof column.cell === 'function' ? column.cell(row, index) : row[column.cell]
    return String(value ?? '')
  }

  private columnWidths(rows: RowItem<T>[], available: number | undefined, _context: LayoutContext): number[] {
    const widths = this.columns.map(column => {
      if (typeof column.width === 'number') return Math.max(1, Math.floor(column.width))
      if (column.width === 'content' || column.width === undefined) {
        return Math.max(displayWidth(column.header), ...rows.map(row => displayWidth(this.cellValue(column, row.item, row.index))), 1)
      }
      return Math.max(1, Math.floor(column.width.min ?? 1))
    })
    if (available === undefined) return widths
    const spacing = Math.max(0, this.columns.length - 1)
    const flexIndexes = this.columns.map((column, index) => (typeof column.width === 'object' ? index : -1)).filter(index => index >= 0)
    const fixed = widths.reduce((sum, width) => sum + width, 0) + spacing
    let remaining = Math.max(0, available - fixed)
    const totalFlex = flexIndexes.reduce((sum, index) => sum + ((this.columns[index]!.width as { flexible: number }).flexible || 1), 0)
    for (const index of flexIndexes) {
      const column = this.columns[index]!.width as { flexible: number; max?: number }
      const add = totalFlex > 0 ? Math.floor((remaining * (column.flexible || 1)) / totalFlex) : 0
      widths[index] = Math.min(column.max ?? Number.POSITIVE_INFINITY, widths[index]! + add)
    }
    const total = widths.reduce((sum, width) => sum + width, spacing)
    if (total > available && widths.length > 0) widths[widths.length - 1] = Math.max(1, widths[widths.length - 1]! - (total - available))
    return widths
  }

  private renderCells(cells: string[], widths: number[]): string {
    return cells.map((cell, index) => truncateDisplay(cell, widths[index] ?? 1, 'clip').padEnd(widths[index] ?? 1)).join(' ')
  }

  private selected(context: LayoutContext, rows: RowItem<T>[]): RowId | undefined {
    const state = context.runtime?.getState<SelectionState>(context.path, () => ({}))
    return selectedRow(this.options.selection, state, rows)
  }

  private setSelected(context: RenderContext, rows: RowItem<T>[], index: number): void {
    const row = clampedRow(rows, index)
    if (!row) return
    this.options.selection?.set(row.id)
    const state = context.runtime?.getState<SelectionState>(context.path, () => ({}))
    if (state) state.selected = row.id
    context.runtime?.requestFocus(`${context.path}.row:${row.id}`)
    this.setNeedsUpdate()
  }

  private handleTableKey(event: KeyEvent, context: RenderContext, rows: RowItem<T>[], index: number, pageSize: number): boolean {
    let next = index
    if (event.key === 'down') next += 1
    else if (event.key === 'up') next -= 1
    else if (event.key === 'pageDown') next += Math.max(1, pageSize - 1)
    else if (event.key === 'pageUp') next -= Math.max(1, pageSize - 1)
    else if (event.key === 'home') next = 0
    else if (event.key === 'end') next = rows.length - 1
    else if (event.key === 'enter') {
      this.setSelected(context, rows, index)
      this.options.onActivate?.(rows[index]!.item, rows[index]!.index)
      return true
    } else return false
    this.setSelected(context, rows, next)
    return true
  }
}

export function Table<T>(
  rows: ItemSource<T>,
  id: keyof T | ((item: T, index: number) => RowId),
  columns: TableColumn<T>[],
  options?: TableOptions<T>,
): ViewNode {
  return new TableView(rows, id, columns, options)
}
