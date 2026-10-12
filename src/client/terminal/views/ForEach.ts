import type { ExpandedChild, LayoutContext, ViewNode } from '../view/base'

export class ForEachView<T> {
  constructor(
    private readonly items: T[] | (() => T[]),
    private readonly id: keyof T | ((item: T, index: number) => string | number),
    private readonly builder: (item: T, index: number) => ViewNode,
  ) {}

  expand(_context: LayoutContext): ExpandedChild[] {
    const items = typeof this.items === 'function' ? this.items() : this.items
    return items.map((item, index) => {
      const rawId = typeof this.id === 'function' ? this.id(item, index) : item[this.id]
      return { id: String(rawId), view: this.builder(item, index) }
    })
  }
}

export function ForEach<T>(
  items: T[] | (() => T[]),
  id: keyof T | ((item: T, index: number) => string | number),
  builder: (item: T, index: number) => ViewNode,
): ForEachView<T> {
  return new ForEachView(items, id, builder)
}
