import type { HubRuntimeClient } from '../runtime'
import type { HubContext } from '../types/common'
import type { AppHeader } from '../types/runtime'
import type {
  AppAction,
  AppActionBody,
  AppActionExecutionOptions,
  AppActionExecutionResult,
  AppElement,
  AppElementType,
  AppInterface,
} from '../types/app-interface'

const elementTypes = new Set<AppElementType>([
  'text',
  'progress',
  'textField',
  'button',
  'slider',
  'picker',
  'files',
  'fileOperation',
  'list',
  'cell',
  'hstack',
  'vstack',
  'zstack',
  'spacer',
])

export class AppControl {
  constructor(private client: HubRuntimeClient) {}

  appInterface(path: string, context?: HubContext): AsyncIterable<AppInterface> {
    return mapValues(this.client.values(path, undefined, context), normalizeAppInterface)
  }

  watchInterface(path: string, context?: HubContext): AsyncIterable<AppInterface> {
    return this.appInterface(path, context)
  }

  async executeAction(action: AppAction, options: AppActionExecutionOptions = {}): Promise<AppActionExecutionResult> {
    const body = resolveActionBody(action, options.data, options.nestedData, options.extraData)
    const result = await this.client.send(action.path, body, options.context)
    const output = mapActionOutput(result, action.output)
    if (options.applyOutput !== false) {
      const target = options.nestedData ?? options.data
      if (target) Object.assign(target, output)
    }
    return { body, result, output }
  }
}

export function normalizeAppInterface(value: unknown): AppInterface {
  const warnings = new WarningCounter()
  const source = asRecord(value)
  if (!source) return { warnings: 0, raw: value }
  const top = normalizeOptionalElement(source.top, warnings)
  const bottom = normalizeOptionalElement(source.bottom, warnings)
  return {
    header: source.header === undefined ? undefined : normalizeAppHeader(source.header) ?? null,
    body: normalizeInterfaceBody(source.body, warnings),
    top,
    bottom,
    data: asRecord(source.data),
    warnings: warnings.count,
    raw: value,
  }
}

export function normalizeAppHeaders(value: unknown): AppHeader[] {
  return arrayValues(value).map(normalizeAppHeader).filter((header): header is AppHeader => Boolean(header))
}

export function normalizeAppHeader(value: unknown): AppHeader | undefined {
  const source = asRecord(value)
  const name = optionalString(source?.name)
  const path = optionalString(source?.path)
  if (!name || !path) return undefined
  const services = optionalNumber(source?.services)
  const isOnline = typeof source?.isOnline === 'boolean' ? source.isOnline : services === undefined || services !== 0
  return {
    id: path,
    type: 'app',
    name,
    path,
    services,
    isOnline,
    raw: value,
  }
}

export function normalizeAppElement(value: unknown): AppElement | undefined {
  return normalizeOptionalElement(value, new WarningCounter())
}

export function resolveActionBody(
  action: AppAction,
  data: Record<string, unknown> = {},
  nestedData?: Record<string, unknown>,
  extraData?: Record<string, unknown>,
): unknown {
  const source = nestedData ? { ...data, ...nestedData } : data
  const body = resolveActionBodyMapping(action.body, source)
  if (!extraData || Object.keys(extraData).length === 0) return body
  if (isPlainRecord(body)) return { ...body, ...extraData }
  if (body === undefined) return { ...extraData }
  return body
}

export function mapActionOutput(result: unknown, output?: AppActionBody): Record<string, unknown> {
  if (output === undefined) return isPlainRecord(result) ? { ...result } : {}
  if (typeof output === 'string') return { [output]: result }
  if (!isPlainRecord(result)) return {}
  const mapped = { ...result }
  for (const [sourceKey, targetKey] of Object.entries(output)) {
    if (!Object.prototype.hasOwnProperty.call(mapped, sourceKey)) continue
    const value = mapped[sourceKey]
    delete mapped[sourceKey]
    mapped[targetKey] = value
  }
  return mapped
}

export function actionFromElement(element: AppElement): AppAction | undefined {
  switch (element.type) {
    case 'button':
    case 'files':
    case 'fileOperation':
      return element.action
    case 'textField':
    case 'slider':
      return element.action
    default:
      return undefined
  }
}

function normalizeInterfaceBody(value: unknown, warnings: WarningCounter): AppInterface['body'] {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return normalizeElementArray(value, warnings)
  const record = asRecord(value)
  return record ? record : undefined
}

function normalizeElementArray(values: unknown[], warnings: WarningCounter): AppElement[] {
  const elements: AppElement[] = []
  for (const value of values) {
    const element = normalizeOptionalElement(value, warnings)
    if (element) elements.push(element)
  }
  return elements
}

function normalizeOptionalElement(value: unknown, warnings: WarningCounter): AppElement | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return { type: 'text', value, secondary: false, raw: value }
  const source = asRecord(value)
  const type = optionalString(source?.type)
  if (!source || !type || !elementTypes.has(type as AppElementType)) {
    warnings.add()
    return undefined
  }
  const elementType = type as AppElementType
  const id = optionalString(source.id)
  const base = { id, raw: value }
  switch (elementType) {
    case 'text':
      return { ...base, type: elementType, value: stringValue(source.value), secondary: booleanValue(source.secondary) }
    case 'progress':
      return { ...base, type: elementType, value: stringValue(source.value), min: numberValue(source.min, 0), max: numberValue(source.max, 1) }
    case 'textField':
      return { ...base, type: elementType, value: stringValue(source.value), placeholder: stringValue(source.placeholder), action: normalizeAction(source.action, warnings) }
    case 'button': {
      const action = normalizeAction(source.action, warnings)
      if (!action) return invalid(warnings)
      return { ...base, type: elementType, title: stringValue(source.title), action }
    }
    case 'slider':
      return {
        ...base,
        type: elementType,
        value: stringValue(source.value),
        defaultValue: optionalNumber(source.defaultValue),
        min: numberValue(source.min, 0),
        max: numberValue(source.max, 1),
        step: optionalNumber(source.step),
        action: normalizeAction(source.action, warnings),
      }
    case 'picker':
      return { ...base, type: elementType, options: stringArray(source.options), selected: stringValue(source.selected) }
    case 'files': {
      const action = normalizeAction(source.action, warnings)
      if (!action) return invalid(warnings)
      return {
        ...base,
        type: elementType,
        title: normalizeOptionalElement(source.title, warnings),
        value: stringValue(source.value),
        action,
      }
    }
    case 'fileOperation': {
      const action = normalizeAction(source.action, warnings)
      if (!action) return invalid(warnings)
      return {
        ...base,
        type: elementType,
        title: normalizeOptionalElement(source.title, warnings),
        format: optionalString(source.format),
        action,
      }
    }
    case 'list': {
      const content = normalizeOptionalElement(source.content, warnings)
      if (!content) return invalid(warnings)
      return { ...base, type: elementType, data: stringValue(source.data), content }
    }
    case 'cell':
      return {
        ...base,
        type: elementType,
        title: normalizeOptionalElement(source.title, warnings),
        subtitle: normalizeOptionalElement(source.subtitle, warnings),
      }
    case 'hstack':
    case 'vstack':
      return { ...base, type: elementType, spacing: optionalNumber(source.spacing), content: normalizeElementArray(arrayValues(source.content), warnings) }
    case 'zstack':
      return { ...base, type: elementType, content: normalizeElementArray(arrayValues(source.content), warnings) }
    case 'spacer':
      return { ...base, type: elementType }
  }
}

function normalizeAction(value: unknown, warnings: WarningCounter): AppAction | undefined {
  if (value === undefined || value === null) return undefined
  const source = asRecord(value)
  const path = optionalString(source?.path)
  if (!source || !path) {
    warnings.add()
    return undefined
  }
  return {
    path,
    body: normalizeActionBody(source.body),
    output: normalizeActionBody(source.output),
    raw: value,
  }
}

function normalizeActionBody(value: unknown): AppActionBody | undefined {
  if (typeof value === 'string') return value
  const source = asRecord(value)
  if (!source) return undefined
  const output: Record<string, string> = {}
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === 'string') output[key] = entry
  }
  return output
}

function resolveActionBodyMapping(body: AppActionBody | undefined, data: Record<string, unknown>): unknown {
  if (body === undefined) return undefined
  if (typeof body === 'string') return data[body]
  const output: Record<string, unknown> = {}
  for (const [targetKey, sourceKey] of Object.entries(body)) {
    if (Object.prototype.hasOwnProperty.call(data, sourceKey)) output[targetKey] = data[sourceKey]
  }
  return output
}

function invalid(warnings: WarningCounter): undefined {
  warnings.add()
  return undefined
}

class WarningCounter {
  count = 0

  add(): void {
    this.count += 1
  }
}

async function* mapValues<T, U>(values: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  for await (const value of values) yield map(value)
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return record ? Object.values(record) : []
}

function stringArray(value: unknown): string[] {
  return arrayValues(value).filter((item): item is string => typeof item === 'string')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(asRecord(value))
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}
