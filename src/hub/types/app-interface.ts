import type { HubContext } from './common'
import type { AppHeader } from './runtime'

export type AppElementType =
  | 'text'
  | 'progress'
  | 'textField'
  | 'button'
  | 'slider'
  | 'picker'
  | 'files'
  | 'fileOperation'
  | 'list'
  | 'cell'
  | 'hstack'
  | 'vstack'
  | 'zstack'
  | 'spacer'

export type AppActionBody = string | Record<string, string>

export interface AppAction {
  path: string
  body?: AppActionBody
  output?: AppActionBody
  raw?: unknown
}

export interface AppElementBase {
  type: AppElementType
  id?: string
  raw?: unknown
}

export interface AppTextElement extends AppElementBase {
  type: 'text'
  value: string
  secondary: boolean
}

export interface AppProgressElement extends AppElementBase {
  type: 'progress'
  value: string
  min: number
  max: number
}

export interface AppTextFieldElement extends AppElementBase {
  type: 'textField'
  value: string
  placeholder: string
  action?: AppAction
}

export interface AppButtonElement extends AppElementBase {
  type: 'button'
  title: string
  action: AppAction
}

export interface AppSliderElement extends AppElementBase {
  type: 'slider'
  value: string
  defaultValue?: number
  min: number
  max: number
  step?: number
  action?: AppAction
}

export interface AppPickerElement extends AppElementBase {
  type: 'picker'
  options: string[]
  selected: string
}

export interface AppFilesElement extends AppElementBase {
  type: 'files'
  title?: AppElement
  value: string
  action: AppAction
}

export interface AppFileOperationElement extends AppElementBase {
  type: 'fileOperation'
  title?: AppElement
  format?: string
  action: AppAction
}

export interface AppListElement extends AppElementBase {
  type: 'list'
  data: string
  content: AppElement
}

export interface AppCellElement extends AppElementBase {
  type: 'cell'
  title?: AppElement
  subtitle?: AppElement
}

export interface AppStackElement extends AppElementBase {
  type: 'hstack' | 'vstack'
  spacing?: number
  content: AppElement[]
}

export interface AppZStackElement extends AppElementBase {
  type: 'zstack'
  content: AppElement[]
}

export interface AppSpacerElement extends AppElementBase {
  type: 'spacer'
}

export type AppElement =
  | AppTextElement
  | AppProgressElement
  | AppTextFieldElement
  | AppButtonElement
  | AppSliderElement
  | AppPickerElement
  | AppFilesElement
  | AppFileOperationElement
  | AppListElement
  | AppCellElement
  | AppStackElement
  | AppZStackElement
  | AppSpacerElement

export type AppInterfaceBody = AppElement[] | Record<string, unknown>

export interface AppInterface {
  header?: AppHeader | null
  body?: AppInterfaceBody
  top?: AppElement
  bottom?: AppElement
  data?: Record<string, unknown>
  warnings: number
  raw?: unknown
}

export interface AppActionExecutionOptions {
  data?: Record<string, unknown>
  nestedData?: Record<string, unknown>
  extraData?: Record<string, unknown>
  context?: HubContext
  applyOutput?: boolean
}

export interface AppActionExecutionResult {
  body: unknown
  result: unknown
  output: Record<string, unknown>
}
