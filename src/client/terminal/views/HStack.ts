import { BaseView, childContext, childRenderContext, type LayoutContext, type RenderContext, type ViewChild, type ViewNode } from '../view/base'
import { rect, type CrossAlignment, type ProposedSize, type Rect, type Size } from '../types'
import { alignVertical, distributeFlex, expandChildren, flexMinLength, isFillWidth, isSpacer, type StackOptions } from '../view/layout'

export class HStackView extends BaseView {
  constructor(private readonly children: ViewChild[], private readonly options: StackOptions = {}) {
    super()
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const children = expandChildren(this.children, context)
    const spacing = this.options.spacing ?? 0
    let width = 0
    let height = 0
    const flexChildren = children.filter(child => isFillWidth(child.view))
    const fixedWidths = children.map(child =>
      isFillWidth(child.view) ? undefined : child.view.measure({ height: proposal.height }, childContext(context, child.id)).width,
    )
    const usedFixed = fixedWidths.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    const totalSpacing = Math.max(0, children.length - 1) * spacing
    const flexWidths =
      proposal.width !== undefined && flexChildren.length > 0
        ? distributeFlex(proposal.width - usedFixed - totalSpacing, flexChildren.map(child => flexMinLength(child.view, 'width')))
        : undefined
    let flexIndex = 0

    children.forEach((child, index) => {
      const flexWidth = isFillWidth(child.view) ? flexWidths?.[flexIndex++] : undefined
      const measured = child.view.measure({ width: flexWidth, height: proposal.height }, childContext(context, child.id))
      if (isSpacer(child.view) && flexWidth !== undefined) measured.width = flexWidth
      width += measured.width
      if (index > 0) width += spacing
      height = Math.max(height, measured.height)
    })
    return { width, height }
  }

  render(bounds: Rect, context: RenderContext): void {
    const children = expandChildren(this.children, context)
    const spacing = this.options.spacing ?? 0
    const flexChildren = children.filter(child => isFillWidth(child.view))
    const fixedWidths = children.map(child =>
      isFillWidth(child.view) ? undefined : child.view.measure({ height: bounds.height }, childContext(context, child.id)).width,
    )
    const usedFixed = fixedWidths.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    const totalSpacing = Math.max(0, children.length - 1) * spacing
    const flexWidths =
      flexChildren.length > 0 ? distributeFlex(bounds.width - usedFixed - totalSpacing, flexChildren.map(child => flexMinLength(child.view, 'width'))) : undefined
    let flexIndex = 0
    let x = bounds.x
    children.forEach(child => {
      child.view.installRuntime(context.runtime!, `${context.path}.${child.id}`)
      const flexWidth = isFillWidth(child.view) ? flexWidths?.[flexIndex++] : undefined
      const measured = child.view.measure({ width: flexWidth, height: bounds.height }, childContext(context, child.id))
      if (isSpacer(child.view) && flexWidth !== undefined) measured.width = flexWidth
      const y = alignVertical(bounds.y, bounds.height, measured.height, (this.options.alignment as CrossAlignment) ?? 'top')
      child.view.render(rect(x, y, measured.width, Math.min(measured.height, bounds.height)), childRenderContext(context, child.id, context.clip))
      x += measured.width + spacing
    })
  }
}

export function HStack(children: ViewChild[], options?: StackOptions): ViewNode {
  return new HStackView(children, options)
}
