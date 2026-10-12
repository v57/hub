import { BaseView, childContext, childRenderContext, type LayoutContext, type RenderContext, type ViewNode } from '../view/base'
import { clamp, intersection, rect, type Binding, type KeyEvent, type ProposedSize, type Rect, type Size } from '../types'
import { itemArray, rowId, selectedRow, type ItemSource, type RowBuilder, type RowId, type RowItem, type SelectionState } from '../view/collections'
import { toView } from '../view/convert'

export type ListOptions<T> = {
  selection?: Binding<RowId | undefined>
  onActivate?: (item: T, index: number) => void
  spacing?: number
  empty?: ViewNode | string
}

export class ListView<T> extends BaseView {
  constructor(
    private readonly items: ItemSource<T>,
    private readonly idFor: keyof T | ((item: T, index: number) => RowId),
    private readonly row: RowBuilder<T>,
    private readonly options: ListOptions<T> = {},
  ) {
    super()
  }

  private rows(): RowItem<T>[] {
    return itemArray(this.items).map((item, index) => ({ id: rowId(item, index, this.idFor), item, index }))
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const rows = this.rows()
    if (rows.length === 0) return this.emptyView().measure(proposal, childContext(context, 'empty'))
    const spacing = this.options.spacing ?? 0
    let width = 0
    let height = Math.max(0, rows.length - 1) * spacing
    const selected = this.selected(context, rows)
    for (const row of rows) {
      const view = toView(this.row(row.item, row.index, row.id === selected))
      const measured = view.measure({ width: proposal.width }, childContext(context, `row:${row.id}`))
      width = Math.max(width, measured.width)
      height += measured.height
    }
    return { width: proposal.width ?? width, height }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const rows = this.rows()
    if (rows.length === 0) {
      this.emptyView().render(bounds, childRenderContext(context, 'empty', visible))
      return
    }

    const selected = this.selected(context, rows)
    const spacing = this.options.spacing ?? 0
    let y = bounds.y
    rows.forEach((row, rowIndex) => {
      const selectedRow = row.id === selected
      const child = toView(this.row(row.item, row.index, selectedRow))
      child.installRuntime(context.runtime!, `${context.path}.row:${row.id}`)
      const measured = child.measure({ width: bounds.width }, childContext(context, `row:${row.id}`))
      const rowBounds = rect(bounds.x, y, bounds.width, measured.height)
      const rowVisible = intersection(rowBounds, context.clip)
      const focusId = `${context.path}.row:${row.id}`
      if (rowVisible) {
        context.registerFocus({
          id: focusId,
          bounds: rowBounds,
          activate: () => {
            this.setSelected(context, rows, rowIndex)
            this.options.onActivate?.(row.item, row.index)
          },
          handleKey: event => this.handleListKey(event, context, rows, rowIndex, bounds.height),
        })
        if (selectedRow) context.buffer.fill(rowBounds, 'gray', rowVisible)
        child.render(rowBounds, {
          ...childRenderContext(context, `row:${row.id}`, rowVisible),
          registerFocus: () => {},
          focusedId: undefined,
        })
      }
      y += measured.height + spacing
    })
  }

  private emptyView(): ViewNode {
    return toView(this.options.empty ?? '')
  }

  private selected(context: LayoutContext, rows: RowItem<T>[]): RowId | undefined {
    const state = context.runtime?.getState<SelectionState>(context.path, () => ({}))
    return selectedRow(this.options.selection, state, rows)
  }

  private setSelected(context: RenderContext | LayoutContext, rows: RowItem<T>[], index: number): void {
    const row = rows[clamp(index, 0, Math.max(0, rows.length - 1))]
    if (!row) return
    this.options.selection?.set(row.id)
    const state = context.runtime?.getState<SelectionState>(context.path, () => ({}))
    if (state) state.selected = row.id
    context.runtime?.requestFocus(`${context.path}.row:${row.id}`)
    this.setNeedsUpdate()
  }

  private handleListKey(event: KeyEvent, context: RenderContext, rows: RowItem<T>[], index: number, pageSize: number): boolean {
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

export function List<T>(
  items: ItemSource<T>,
  id: keyof T | ((item: T, index: number) => RowId),
  row: RowBuilder<T>,
  options?: ListOptions<T>,
): ViewNode {
  return new ListView(items, id, row, options)
}
