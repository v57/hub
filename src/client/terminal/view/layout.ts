import { childContext, isChildCollection, type LayoutContext, type ViewChild, type ViewNode } from './base'
import { FrameView } from './base'
import { SpacerView } from '../views/Spacer'
import type { CrossAlignment, StackAlignment } from '../types'

export type StackOptions = {
  spacing?: number
  alignment?: StackAlignment | CrossAlignment
}

export function expandChildren(children: ViewChild[], context: LayoutContext) {
  const expanded: { id: string; view: ViewNode }[] = []
  children.forEach((child, index) => {
    if (isChildCollection(child)) {
      expanded.push(...child.expand(childContext(context, `forEach${index}`)).map(item => ({ id: `forEach${index}.${item.id}`, view: item.view })))
    } else {
      expanded.push({ id: String(index), view: child })
    }
  })
  return expanded
}

export function alignCross(x: number, width: number, childWidth: number, alignment: StackAlignment): number {
  if (alignment === 'trailing') return x + width - childWidth
  if (alignment === 'center') return x + Math.floor((width - childWidth) / 2)
  return x
}

export function alignVertical(y: number, height: number, childHeight: number, alignment: CrossAlignment): number {
  if (alignment === 'bottom') return y + height - childHeight
  if (alignment === 'center') return y + Math.floor((height - childHeight) / 2)
  return y
}

export function isFillWidth(view: ViewNode): boolean {
  return isSpacer(view) || (view instanceof FrameView && view.fillsWidth())
}

export function isFillHeight(view: ViewNode): boolean {
  return isSpacer(view) || (view instanceof FrameView && view.fillsHeight())
}

export function isSpacer(view: ViewNode): view is SpacerView {
  return view instanceof SpacerView
}

export function flexMinLength(view: ViewNode, _axis: 'width' | 'height'): number {
  return view instanceof SpacerView ? view.minLength() : 0
}

export function distributeFlex(total: number, minimums: number[]): number[] {
  if (minimums.length === 0) return []
  const cleanMinimums = minimums.map(value => Math.max(0, Math.floor(value)))
  const minTotal = cleanMinimums.reduce((sum, value) => sum + value, 0)
  if (total <= minTotal) {
    let remaining = Math.max(0, Math.floor(total))
    return cleanMinimums.map(value => {
      const assigned = Math.min(value, remaining)
      remaining -= assigned
      return assigned
    })
  }
  const extra = Math.max(0, Math.floor(total - minTotal))
  const share = Math.floor(extra / minimums.length)
  let remainder = extra % minimums.length
  return cleanMinimums.map(value => value + share + (remainder-- > 0 ? 1 : 0))
}
