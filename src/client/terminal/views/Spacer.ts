import { BaseView, type ViewNode } from '../view/base'
import type { Size } from '../types'

export type SpacerOptions = {
  minLength?: number
}

export class SpacerView extends BaseView {
  constructor(readonly options: SpacerOptions = {}) {
    super()
  }

  measure(): Size {
    return { width: 0, height: 0 }
  }

  render(): void {}

  minLength(): number {
    return Math.max(0, Math.floor(this.options.minLength ?? 0))
  }
}

export function Spacer(options?: SpacerOptions): ViewNode {
  return new SpacerView(options)
}
