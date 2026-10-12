import { BaseView, childRenderContext, type LayoutContext, type RenderContext, type ViewNode } from '../view/base'
import { clamp, displayWidth, intersection, rect, type Binding, type KeyEvent, type ProposedSize, type Rect, type Size } from '../types'
import { itemArray, rowId, selectedRow, type ItemSource, type RowId, type RowItem, type SelectionState } from '../view/collections'
import { toView } from '../view/convert'

export type OutlineOptions<T> = {
  id: keyof T | ((item: T, index: number) => RowId)
  children: keyof T | ((item: T) => T[] | undefined)
  expanded?: Binding<Set<RowId> | RowId[]>
  selection?: Binding<RowId | undefined>
  onActivate?: (item: T, index: number) => void
}

type OutlineRow<T> = RowItem<T> & {
  depth: number
  expandable: boolean
  expanded: boolean
}

export class OutlineGroupView<T> extends BaseView {
  constructor(private readonly items: ItemSource<T>, private readonly row: (item: T, depth: number, expanded: boolean) => ViewNode | string | number, private readonly options: OutlineOptions<T>) {
    super()
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const rows = this.rows(context)
    return { width: proposal.width ?? Math.max(0, ...rows.map(row => displayWidth(this.prefix(row)) + row.depth * 2 + 8)), height: rows.length }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const rows = this.rows(context)
    const selected = this.selected(context, rows)
    rows.forEach((row, index) => {
      const y = bounds.y + index
      const rowBounds = rect(bounds.x, y, bounds.width, 1)
      const rowVisible = intersection(rowBounds, context.clip)
      if (!rowVisible) return
      const focusId = `${context.path}.row:${row.id}`
      context.registerFocus({
        id: focusId,
        bounds: rowBounds,
        activate: () => this.activate(context, rows, index),
        handleKey: event => this.handleOutlineKey(event, context, rows, index),
      })
      if (row.id === selected) context.buffer.fill(rowBounds, 'gray', rowVisible)
      const prefix = `${'  '.repeat(row.depth)}${this.prefix(row)}`
      context.buffer.write(bounds.x, y, prefix.slice(0, bounds.width), rowVisible, context.foregroundColor, context.fontWeight)
      const child = toView(this.row(row.item, row.depth, row.expanded))
      child.installRuntime(context.runtime!, `${context.path}.row:${row.id}`)
      child.render(rect(bounds.x + displayWidth(prefix), y, Math.max(0, bounds.width - displayWidth(prefix)), 1), {
        ...childRenderContext(context, `row:${row.id}`, rowVisible),
        registerFocus: () => {},
        focusedId: undefined,
      })
    })
  }

  private rows(context: LayoutContext): OutlineRow<T>[] {
    const expanded = this.expandedSet(context)
    const output: OutlineRow<T>[] = []
    const visit = (items: T[], depth: number) => {
      items.forEach((item, index) => {
        const id = rowId(item, index, this.options.id)
        const children = this.children(item)
        const open = expanded.has(id)
        output.push({ id, item, index: output.length, depth, expandable: children.length > 0, expanded: open })
        if (open) visit(children, depth + 1)
      })
    }
    visit(itemArray(this.items), 0)
    return output
  }

  private children(item: T): T[] {
    const value = typeof this.options.children === 'function' ? this.options.children(item) : (item[this.options.children] as T[] | undefined)
    return value ?? []
  }

  private prefix(row: OutlineRow<T>): string {
    if (!row.expandable) return '  '
    return row.expanded ? 'v ' : '> '
  }

  private expandedSet(context: LayoutContext): Set<RowId> {
    const state = context.runtime?.getState<{ expanded: Set<RowId> }>(`${context.path}.expanded`, () => ({ expanded: new Set<RowId>() }))
    const value = this.options.expanded?.get()
    if (value instanceof Set) return value
    if (Array.isArray(value)) return new Set(value)
    return state?.expanded ?? new Set<RowId>()
  }

  private setExpanded(context: LayoutContext, next: Set<RowId>): void {
    const current = this.options.expanded?.get()
    if (current instanceof Set) this.options.expanded?.set(new Set(next))
    else if (Array.isArray(current)) this.options.expanded?.set([...next])
    else {
      const state = context.runtime?.getState<{ expanded: Set<RowId> }>(`${context.path}.expanded`, () => ({ expanded: new Set<RowId>() }))
      if (state) state.expanded = next
    }
  }

  private selected(context: LayoutContext, rows: OutlineRow<T>[]): RowId | undefined {
    const state = context.runtime?.getState<SelectionState>(context.path, () => ({}))
    return selectedRow(this.options.selection, state, rows)
  }

  private setSelected(context: RenderContext, rows: OutlineRow<T>[], index: number): void {
    const row = rows[clamp(index, 0, Math.max(0, rows.length - 1))]
    if (!row) return
    this.options.selection?.set(row.id)
    const state = context.runtime?.getState<SelectionState>(context.path, () => ({}))
    if (state) state.selected = row.id
    context.runtime?.requestFocus(`${context.path}.row:${row.id}`)
    this.setNeedsUpdate()
  }

  private activate(context: RenderContext, rows: OutlineRow<T>[], index: number): void {
    const row = rows[index]
    if (!row) return
    this.setSelected(context, rows, index)
    if (row.expandable) this.toggle(context, row)
    else this.options.onActivate?.(row.item, row.index)
  }

  private toggle(context: LayoutContext, row: OutlineRow<T>, force?: boolean): void {
    const next = new Set(this.expandedSet(context))
    const open = force ?? !next.has(row.id)
    if (open) next.add(row.id)
    else next.delete(row.id)
    this.setExpanded(context, next)
    this.setNeedsUpdate()
  }

  private handleOutlineKey(event: KeyEvent, context: RenderContext, rows: OutlineRow<T>[], index: number): boolean {
    const row = rows[index]
    if (!row) return false
    if (event.key === 'down') this.setSelected(context, rows, index + 1)
    else if (event.key === 'up') this.setSelected(context, rows, index - 1)
    else if (event.key === 'home') this.setSelected(context, rows, 0)
    else if (event.key === 'end') this.setSelected(context, rows, rows.length - 1)
    else if (event.key === 'right' && row.expandable) this.toggle(context, row, true)
    else if (event.key === 'left' && row.expandable && row.expanded) this.toggle(context, row, false)
    else if (event.key === 'enter') this.activate(context, rows, index)
    else return false
    return true
  }
}

export function OutlineGroup<T>(
  items: ItemSource<T>,
  row: (item: T, depth: number, expanded: boolean) => ViewNode | string | number,
  options: OutlineOptions<T>,
): ViewNode {
  return new OutlineGroupView(items, row, options)
}
