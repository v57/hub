import { clamp } from '../types'
import type { Binding } from '../types'
import type { ViewNode } from './base'

export type RowId = string | number
export type ItemSource<T> = T[] | (() => T[])
export type RowBuilder<T> = (item: T, index: number, selected: boolean) => ViewNode | string | number

export type SelectionState = {
  selected?: RowId
}

export type RowItem<T> = {
  id: RowId
  item: T
  index: number
}

export function itemArray<T>(items: ItemSource<T>): T[] {
  return typeof items === 'function' ? items() : items
}

export function rowId<T>(item: T, index: number, id: keyof T | ((item: T, index: number) => RowId)): RowId {
  return typeof id === 'function' ? id(item, index) : (item[id] as RowId)
}

export function selectedRow<T>(binding: Binding<RowId | undefined> | undefined, state: SelectionState | undefined, rows: RowItem<T>[]): RowId | undefined {
  const current = binding?.get() ?? state?.selected
  const match = rows.find(row => Object.is(row.id, current)) ?? rows[0]
  if (match && !Object.is(current, match.id)) {
    binding?.set(match.id)
    if (state) state.selected = match.id
  }
  return match?.id
}

export function clampedRow<T>(rows: RowItem<T>[], index: number): RowItem<T> | undefined {
  return rows[clamp(index, 0, Math.max(0, rows.length - 1))]
}
