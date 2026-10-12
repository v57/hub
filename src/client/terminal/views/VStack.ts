import { BaseView, childContext, childRenderContext, type LayoutContext, type RenderContext, type ViewChild, type ViewNode } from '../view/base'
import { rect, type ProposedSize, type Rect, type Size, type StackAlignment } from '../types'
import { alignCross, distributeFlex, expandChildren, flexMinLength, isFillHeight, isSpacer, type StackOptions } from '../view/layout'

export class VStackView extends BaseView {
  constructor(private readonly children: ViewChild[], private readonly options: StackOptions = {}) {
    super()
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const children = expandChildren(this.children, context)
    const spacing = this.options.spacing ?? 0
    let width = 0
    let height = 0
    const flexChildren = children.filter(child => isFillHeight(child.view))
    const fixedHeights = children.map(child =>
      isFillHeight(child.view) ? undefined : child.view.measure({ width: proposal.width }, childContext(context, child.id)).height,
    )
    const usedFixed = fixedHeights.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    const totalSpacing = Math.max(0, children.length - 1) * spacing
    const flexHeights =
      proposal.height !== undefined && flexChildren.length > 0
        ? distributeFlex(proposal.height - usedFixed - totalSpacing, flexChildren.map(child => flexMinLength(child.view, 'height')))
        : undefined
    let flexIndex = 0

    children.forEach((child, index) => {
      const flexHeight = isFillHeight(child.view) ? flexHeights?.[flexIndex++] : undefined
      const measured = child.view.measure({ width: proposal.width, height: flexHeight }, childContext(context, child.id))
      if (isSpacer(child.view) && flexHeight !== undefined) measured.height = flexHeight
      width = Math.max(width, measured.width)
      height += measured.height
      if (index > 0) height += spacing
    })
    return { width, height }
  }

  render(bounds: Rect, context: RenderContext): void {
    const children = expandChildren(this.children, context)
    const spacing = this.options.spacing ?? 0
    const flexChildren = children.filter(child => isFillHeight(child.view))
    const fixedHeights = children.map(child =>
      isFillHeight(child.view) ? undefined : child.view.measure({ width: bounds.width }, childContext(context, child.id)).height,
    )
    const usedFixed = fixedHeights.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    const totalSpacing = Math.max(0, children.length - 1) * spacing
    const flexHeights =
      flexChildren.length > 0 ? distributeFlex(bounds.height - usedFixed - totalSpacing, flexChildren.map(child => flexMinLength(child.view, 'height'))) : undefined
    let flexIndex = 0
    let y = bounds.y
    children.forEach(child => {
      child.view.installRuntime(context.runtime!, `${context.path}.${child.id}`)
      const flexHeight = isFillHeight(child.view) ? flexHeights?.[flexIndex++] : undefined
      const measured = child.view.measure({ width: bounds.width, height: flexHeight }, childContext(context, child.id))
      if (isSpacer(child.view) && flexHeight !== undefined) measured.height = flexHeight
      const x = alignCross(bounds.x, bounds.width, measured.width, (this.options.alignment as StackAlignment) ?? 'leading')
      child.view.render(rect(x, y, Math.min(measured.width, bounds.width), measured.height), childRenderContext(context, child.id, context.clip))
      y += measured.height + spacing
    })
  }
}

export function VStack(children: ViewChild[], options?: StackOptions): ViewNode {
  return new VStackView(children, options)
}
