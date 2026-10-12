import type { Binding, ForegroundColor } from '../types'
import type { RenderContext } from './base'

export type ControlOptions = {
  disabled?: boolean | Binding<boolean>
  loading?: boolean | Binding<boolean>
  loadingLabel?: string
  allowLoadingActivation?: boolean
  role?: 'default' | 'cancel' | 'destructive'
  help?: string
}

export type ButtonOptions = ControlOptions
export type ToggleOptions = ControlOptions
export type PickerOptions = ControlOptions
export type TabBarOptions = ControlOptions

function optionEnabled(value: boolean | Binding<boolean> | undefined): boolean {
  return typeof value === 'boolean' ? value : value?.get() ?? false
}

export function isControlDisabled(options: ControlOptions | undefined): boolean {
  return optionEnabled(options?.disabled)
}

export function isControlLoading(options: ControlOptions | undefined): boolean {
  return optionEnabled(options?.loading)
}

export function isControlBlocked(options: ControlOptions | undefined): boolean {
  return isControlDisabled(options) || (isControlLoading(options) && !options?.allowLoadingActivation)
}

export function controlForeground(context: RenderContext, options: ControlOptions | undefined): ForegroundColor | undefined {
  if (isControlDisabled(options)) return 'gray'
  if (isControlLoading(options)) return 'secondary'
  if (options?.role === 'destructive') return 'red'
  return context.foregroundColor
}

export function withLoadingLabel(label: string, options: ControlOptions | undefined): string {
  return isControlLoading(options) ? `${options?.loadingLabel ?? '...'} ${label}` : label
}
