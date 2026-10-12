import { Text } from '../views/Text'
import { isViewNode, type ViewNode } from './base'

export function toView(value: ViewNode | string | number): ViewNode {
  return isViewNode(value) ? value : Text(value)
}
