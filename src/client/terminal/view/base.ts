import { RenderBuffer } from '../render'
import {
  alignChild,
  clamp,
  displayWidth,
  intersection,
  rect,
  truncateDisplay,
  type BackgroundColor,
  type Binding,
  type FocusCandidate,
  type FontWeight,
  type FrameOptions,
  type ForegroundColor,
  type KeyEvent,
  type KeyModifier,
  type ProposedSize,
  type Rect,
  type Size,
} from '../types'

export type RuntimeHooks = {
  setNeedsUpdate(): void
  requestFocus(id: string | undefined): void
  getState<T>(path: string, create: () => T): T
  markVisible(path: string, start?: () => AsyncIterator<unknown>): void
  markTaskVisible(path: string, id: unknown, run: (context: TaskContext) => Promise<void> | void): void
}

export type LayoutContext = {
  path: string
  runtime?: RuntimeHooks
}

export type RenderContext = LayoutContext & {
  buffer: RenderBuffer
  clip: Rect
  focusedId?: string
  focusId?: string
  foregroundColor?: ForegroundColor
  fontWeight?: FontWeight
  navigation?: NavigationController
  registerFocus(candidate: Omit<FocusCandidate, 'sourceOrder'>): void
  registerKeyHandler(handler: (event: KeyEvent) => boolean): void
  registerControl(control: RegisteredControl): void
  registerTabBar(handler: () => void): void
  registerTopLayer(render: () => void): void
}

export interface ViewNode {
  measure(proposal: ProposedSize, context: LayoutContext): Size
  render(bounds: Rect, context: RenderContext): void
  frame(options: FrameOptions): ViewNode
  foregroundColor(color: ForegroundColor): ViewNode
  fontWeight(weight: FontWeight): ViewNode
  padding(options?: PaddingOptions): ViewNode
  background(color: BackgroundColor): ViewNode
  contextMenu(actions: ContextMenuAction[]): ViewNode
  keyBinding(binding: KeyBinding | KeyBinding[], title: string, action: KeyBindingAction): ViewNode
  focusId(value: string | number): ViewNode
  id(value: string | number): ViewNode
  task(id: unknown, run: (context: TaskContext) => Promise<void> | void): ViewNode
  visible(value: boolean): ViewNode
  setNeedsUpdate(): void
  installRuntime(runtime: RuntimeHooks, path: string): void
}

export type ExpandedChild = {
  id: string
  view: ViewNode
}

export type ChildCollection = {
  expand(context: LayoutContext): ExpandedChild[]
}

export type ViewChild = ViewNode | ChildCollection

export abstract class BaseView implements ViewNode {
  protected runtime?: RuntimeHooks
  protected path = ''

  abstract measure(proposal: ProposedSize, context: LayoutContext): Size
  abstract render(bounds: Rect, context: RenderContext): void

  frame(options: FrameOptions): ViewNode {
    return new FrameView(this, options)
  }

  foregroundColor(color: ForegroundColor): ViewNode {
    return new ForegroundColorView(this, color)
  }

  fontWeight(weight: FontWeight): ViewNode {
    return new FontWeightView(this, weight)
  }

  padding(options: PaddingOptions = 1): ViewNode {
    return new PaddingView(this, options)
  }

  background(color: BackgroundColor): ViewNode {
    return new BackgroundView(this, color)
  }

  contextMenu(actions: ContextMenuAction[]): ViewNode {
    return new ContextMenuView(this, actions)
  }

  keyBinding(binding: KeyBinding | KeyBinding[], title: string, action: KeyBindingAction): ViewNode {
    return new KeyBindingView(this, binding, title, action)
  }

  focusId(value: string | number): ViewNode {
    return new FocusIdView(this, value)
  }

  id(value: string | number): ViewNode {
    return new IdentityView(this, value)
  }

  task(id: unknown, run: (context: TaskContext) => Promise<void> | void): ViewNode {
    return new TaskView(this, id, run)
  }

  visible(value: boolean): ViewNode {
    return new VisibleView(this, value)
  }

  installRuntime(runtime: RuntimeHooks, path: string): void {
    this.runtime = runtime
    this.path = path
  }

  setNeedsUpdate(): void {
    this.runtime?.setNeedsUpdate()
  }
}

export class ForegroundColorView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly color: ForegroundColor) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.foregroundColor`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.child.measure(proposal, childContext(context, 'foregroundColor'))
  }

  render(bounds: Rect, context: RenderContext): void {
    this.child.render(bounds, childRenderContext({ ...context, foregroundColor: this.color }, 'foregroundColor', context.clip))
  }
}

export class FontWeightView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly weight: FontWeight) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.fontWeight`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.child.measure(proposal, childContext(context, 'fontWeight'))
  }

  render(bounds: Rect, context: RenderContext): void {
    this.child.render(bounds, childRenderContext({ ...context, fontWeight: this.weight }, 'fontWeight', context.clip))
  }
}

export type EdgeInsets = {
  top: number
  right: number
  bottom: number
  left: number
}

export type PaddingOptions =
  | number
  | Partial<EdgeInsets> & {
      horizontal?: number
      vertical?: number
    }

export type TaskContext = {
  signal: AbortSignal
  setNeedsUpdate(): void
}

export type ContextMenuAction = {
  label: string
  action: () => void
}

type KeyBindingNamedKey = Exclude<KeyEvent['key'], 'char' | 'mouse' | 'raw'>

export type KeyBinding =
  | string
  | { key: KeyBindingNamedKey; modifiers?: KeyModifier[] }
  | { key: 'char'; char: string; modifiers?: KeyModifier[] }

export type KeyBindingAction = (event: KeyEvent) => void

export type RegisteredControl = {
  id: string
  binding: string
  title: string
  detail?: string
}

type NormalizedKeyBinding =
  | { key: KeyBindingNamedKey; modifiers: KeyModifier[] }
  | { key: 'char'; char: string; modifiers: KeyModifier[] }

type NormalizedKeyBindingKey =
  | { key: KeyBindingNamedKey }
  | { key: 'char'; char: string }


type ContextMenuState = {
  open: boolean
  selected: number
}

const modifierOrder: KeyModifier[] = ['shift', 'alt', 'ctrl', 'meta']

function normalizedModifiers(modifiers: KeyModifier[] | undefined): KeyModifier[] {
  return modifierOrder.filter(modifier => modifiers?.includes(modifier))
}

function sameModifiers(lhs: KeyModifier[], rhs: KeyModifier[]): boolean {
  return lhs.length === rhs.length && lhs.every((modifier, index) => modifier === rhs[index])
}

function normalizeKeyBinding(binding: KeyBinding): NormalizedKeyBinding | undefined {
  if (typeof binding === 'string') return parseKeyBinding(binding)
  if (binding.key === 'char') return { key: 'char', char: binding.char, modifiers: normalizedModifiers(binding.modifiers) }
  return { key: binding.key, modifiers: normalizedModifiers(binding.modifiers) }
}

function formatKeyBinding(binding: NormalizedKeyBinding): string {
  const key = binding.key === 'char' ? (binding.char === ' ' ? 'space' : binding.char) : binding.key
  return [...binding.modifiers, key].join('+')
}

function parseKeyBinding(value: string): NormalizedKeyBinding | undefined {
  const trimmed = value.trim()
  if (value === ' ') return { key: 'char', char: ' ', modifiers: [] }
  if (trimmed.length === 0) return undefined

  const parts = trimmed.split('+').map(part => part.trim()).filter(Boolean)
  const keyToken = parts.pop()
  if (!keyToken) return undefined

  const modifiers: KeyModifier[] = []
  for (const part of parts) {
    const modifier = modifierFromToken(part)
    if (!modifier) return undefined
    modifiers.push(modifier)
  }

  const key = keyFromToken(keyToken)
  if (!key) return undefined
  return { ...key, modifiers: normalizedModifiers(modifiers) } as NormalizedKeyBinding
}

function modifierFromToken(token: string): KeyModifier | undefined {
  const normalized = token.toLowerCase()
  if (normalized === 'shift') return 'shift'
  if (normalized === 'alt' || normalized === 'option') return 'alt'
  if (normalized === 'ctrl' || normalized === 'control') return 'ctrl'
  if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') return 'meta'
  return undefined
}

function keyFromToken(token: string): NormalizedKeyBindingKey | undefined {
  const normalized = token.toLowerCase()
  if (normalized === 'space') return { key: 'char', char: ' ' }
  if (normalized === 'esc') return { key: 'escape' }
  if (normalized === 'return') return { key: 'enter' }
  if (normalized === 'del') return { key: 'delete' }
  if (normalized === 'pageup') return { key: 'pageUp' }
  if (normalized === 'pagedown') return { key: 'pageDown' }

  const named = new Set<KeyBindingNamedKey>(['up', 'down', 'left', 'right', 'pageUp', 'pageDown', 'home', 'end', 'delete', 'enter', 'tab', 'backspace', 'escape', 'ctrl-c'])
  const namedMatch = [...named].find(key => key.toLowerCase() === normalized)
  if (namedMatch) return { key: namedMatch }

  const chars = [...token]
  if (chars.length === 1) return { key: 'char', char: chars[0]! }
  return undefined
}

function matchesKeyBinding(event: KeyEvent, binding: NormalizedKeyBinding): boolean {
  if (event.key === 'mouse' || event.key === 'raw') return false
  if (event.key !== binding.key) return false
  if (event.key === 'char' && binding.key === 'char' && event.char !== binding.char) return false
  return sameModifiers(normalizedModifiers(event.modifiers), binding.modifiers)
}

export type NavigationRouteValue = string | number

export type NavigationController<T extends NavigationRouteValue = NavigationRouteValue> = {
  path: T[]
  push(value: T): void
  pop(): void
}

function insets(options: PaddingOptions): EdgeInsets {
  if (typeof options === 'number') {
    const value = Math.max(0, Math.floor(options))
    return { top: value, right: value, bottom: value, left: value }
  }
  const horizontal = Math.max(0, Math.floor(options.horizontal ?? 0))
  const vertical = Math.max(0, Math.floor(options.vertical ?? 0))
  return {
    top: Math.max(0, Math.floor(options.top ?? vertical)),
    right: Math.max(0, Math.floor(options.right ?? horizontal)),
    bottom: Math.max(0, Math.floor(options.bottom ?? vertical)),
    left: Math.max(0, Math.floor(options.left ?? horizontal)),
  }
}

export class PaddingView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly options: PaddingOptions) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.padding`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const inset = insets(this.options)
    const child = this.child.measure(
      {
        width: proposal.width === undefined ? undefined : Math.max(0, proposal.width - inset.left - inset.right),
        height: proposal.height === undefined ? undefined : Math.max(0, proposal.height - inset.top - inset.bottom),
      },
      childContext(context, 'padding'),
    )
    return {
      width: child.width + inset.left + inset.right,
      height: child.height + inset.top + inset.bottom,
    }
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const inset = insets(this.options)
    const childBounds = rect(
      bounds.x + inset.left,
      bounds.y + inset.top,
      Math.max(0, bounds.width - inset.left - inset.right),
      Math.max(0, bounds.height - inset.top - inset.bottom),
    )
    this.child.render(childBounds, childRenderContext(context, 'padding', visible))
  }
}

export class BackgroundView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly color: BackgroundColor) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.background`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.child.measure(proposal, childContext(context, 'background'))
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    context.buffer.fill(bounds, this.color, visible)
    this.child.render(bounds, childRenderContext(context, 'background', visible))
  }
}

export class IdentityView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly value: string | number) {
    super()
  }

  private identityPath(path: string): string {
    const parent = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : path
    return `${parent}.id:${String(this.value)}`
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, this.identityPath(path))
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const path = this.identityPath(context.path)
    return this.child.measure(proposal, { ...context, path })
  }

  render(bounds: Rect, context: RenderContext): void {
    const path = this.identityPath(context.path)
    this.child.render(bounds, { ...context, path })
  }
}

export class FocusIdView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly value: string | number) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.focusId`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.child.measure(proposal, childContext(context, 'focusId'))
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const id = String(this.value)
    const focusContext: RenderContext = {
      ...context,
      focusId: id,
      registerFocus: candidate => context.registerFocus({ ...candidate, id }),
    }
    this.child.render(bounds, childRenderContext(focusContext, 'focusId', visible))
  }
}

export class TaskView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly taskId: unknown, private readonly run: (context: TaskContext) => Promise<void> | void) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.task`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.child.measure(proposal, childContext(context, 'task'))
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    context.runtime?.markTaskVisible(context.path, this.taskId, this.run)
    this.child.render(bounds, childRenderContext(context, 'task', visible))
  }
}

export class VisibleView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly isVisible: boolean) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.visible`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.child.measure(proposal, childContext(context, 'visible'))
  }

  render(bounds: Rect, context: RenderContext): void {
    if (!this.isVisible) return
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    this.child.render(bounds, childRenderContext(context, 'visible', visible))
  }
}

export class ContextMenuView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly actions: ContextMenuAction[]) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.contextMenu`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.child.measure(proposal, childContext(context, 'contextMenu'))
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    const state = context.runtime?.getState<ContextMenuState>(context.path, () => ({ open: false, selected: 0 })) ?? { open: false, selected: 0 }
    state.selected = clamp(state.selected, 0, Math.max(0, this.actions.length - 1))

    let registered = 0
    const menuContext: RenderContext = {
      ...context,
      registerFocus: candidate => {
        registered += 1
        context.registerFocus(this.withContextMenu(candidate, state))
      },
    }

    this.child.render(bounds, childRenderContext(menuContext, 'contextMenu', visible))
    if (registered === 0) {
      const fallback = { id: controlFocusId(context), bounds }
      context.registerFocus(this.withContextMenu(fallback, state))
      if (context.focusedId === fallback.id) context.buffer.fill(bounds, 'gray', visible)
    }
    if (state.open) context.registerTopLayer(() => this.renderMenu(bounds, context, state))
  }

  private withContextMenu(candidate: Omit<FocusCandidate, 'sourceOrder'>, state: ContextMenuState): Omit<FocusCandidate, 'sourceOrder'> {
    return {
      ...candidate,
      handleKey: event => {
        if (state.open) {
          if (event.key === 'char' && event.char === ' ') {
            state.open = false
            this.setNeedsUpdate()
            return true
          }
          if (event.key === 'down') {
            state.selected = clamp(state.selected + 1, 0, Math.max(0, this.actions.length - 1))
            this.setNeedsUpdate()
            return true
          }
          if (event.key === 'up') {
            state.selected = clamp(state.selected - 1, 0, Math.max(0, this.actions.length - 1))
            this.setNeedsUpdate()
            return true
          }
          if (event.key === 'enter') {
            const action = this.actions[state.selected]
            state.open = false
            action?.action()
            this.setNeedsUpdate()
            return true
          }
          return true
        }

        if (event.key === 'char' && event.char === ' ') {
          if (this.actions.length > 0) state.open = true
          state.selected = 0
          this.setNeedsUpdate()
          return true
        }

        return candidate.handleKey?.(event) ?? false
      },
    }
  }

  private renderMenu(bounds: Rect, context: RenderContext, state: ContextMenuState): void {
    if (this.actions.length === 0) return
    const labels = this.actions.map((action, index) => `${index === state.selected ? '>' : ' '} ${action.label}`)
    const width = Math.max(4, Math.max(...labels.map(label => displayWidth(label))) + 2)
    const height = this.actions.length + 2
    const maxX = context.clip.x + context.clip.width - width
    const maxY = context.clip.y + context.clip.height - height
    const x = clamp(bounds.x, context.clip.x, Math.max(context.clip.x, maxX))
    const belowY = bounds.y + Math.max(1, bounds.height)
    const y = belowY <= maxY ? belowY : clamp(bounds.y - height, context.clip.y, Math.max(context.clip.y, maxY))
    const menuBounds = rect(x, y, width, height)
    const visible = intersection(menuBounds, context.clip)
    if (!visible) return

    context.buffer.write(x, y, `+${'-'.repeat(Math.max(0, width - 2))}+`, visible, context.foregroundColor ?? 'tint', context.fontWeight)
    labels.forEach((label, index) => {
      const line = `|${truncateDisplay(label, width - 2, 'clip').padEnd(width - 2)}|`
      context.buffer.write(x, y + index + 1, line, visible, context.foregroundColor ?? 'tint', context.fontWeight)
    })
    context.buffer.write(x, y + height - 1, `+${'-'.repeat(Math.max(0, width - 2))}+`, visible, context.foregroundColor ?? 'tint', context.fontWeight)
  }
}

export class KeyBindingView extends BaseView {
  private readonly bindings: NormalizedKeyBinding[]
  private readonly controlBinding?: string

  constructor(private readonly child: ViewNode, binding: KeyBinding | KeyBinding[], private readonly title: string, private readonly action: KeyBindingAction) {
    super()
    this.bindings = (Array.isArray(binding) ? binding : [binding])
      .map(normalizeKeyBinding)
      .filter((value): value is NormalizedKeyBinding => value !== undefined)
    this.controlBinding = this.bindings[0] ? formatKeyBinding(this.bindings[0]) : undefined
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.keyBinding`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    return this.child.measure(proposal, childContext(context, 'keyBinding'))
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return
    if (this.bindings.length > 0) {
      if (this.controlBinding) context.registerControl({ id: controlFocusId(context), binding: this.controlBinding, title: this.title })
      context.registerKeyHandler(event => {
        if (!this.bindings.some(binding => matchesKeyBinding(event, binding))) return false
        this.action(event)
        this.setNeedsUpdate()
        return true
      })
    }
    this.child.render(bounds, childRenderContext(context, 'keyBinding', visible))
  }
}

export class FrameView extends BaseView {
  constructor(private readonly child: ViewNode, private readonly options: FrameOptions) {
    super()
  }

  override installRuntime(runtime: RuntimeHooks, path: string): void {
    super.installRuntime(runtime, path)
    this.child.installRuntime(runtime, `${path}.frame`)
  }

  measure(proposal: ProposedSize, context: LayoutContext): Size {
    const maxWidth = this.options.maxWidth === -1 ? proposal.width : this.options.maxWidth
    const maxHeight = this.options.maxHeight === -1 ? proposal.height : this.options.maxHeight
    const child = this.child.measure({ width: maxWidth ?? proposal.width, height: maxHeight ?? proposal.height }, childContext(context, 'frame'))

    let width = this.options.width ?? child.width
    let height = this.options.height ?? child.height

    if (maxWidth !== undefined) width = maxWidth
    if (maxHeight !== undefined) height = maxHeight
    if (this.options.minWidth !== undefined) width = Math.max(width, this.options.minWidth)
    if (this.options.minHeight !== undefined) height = Math.max(height, this.options.minHeight)

    return {
      width: Math.max(0, Math.floor(width)),
      height: Math.max(0, Math.floor(height)),
    }
  }

  fillsWidth(): boolean {
    return this.options.maxWidth === -1
  }

  fillsHeight(): boolean {
    return this.options.maxHeight === -1
  }

  render(bounds: Rect, context: RenderContext): void {
    const visible = intersection(bounds, context.clip)
    if (!visible) return

    const measured = this.child.measure({ width: bounds.width, height: bounds.height }, childContext(context, 'frame'))
    const childBounds = alignChild(bounds, measured, this.options.alignment)
    this.child.render(childBounds, childRenderContext(context, 'frame', visible))
  }
}

export function childContext<T extends LayoutContext>(context: T, id: string): T {
  return { ...context, path: `${context.path}.${id}` }
}

export function childRenderContext(context: RenderContext, id: string, clip: Rect): RenderContext {
  return { ...context, path: `${context.path}.${id}`, clip }
}

export function controlFocusId(context: RenderContext): string {
  return context.focusId ?? context.path
}

export function isBinding<T>(value: unknown): value is Binding<T> {
  return Boolean(value && typeof value === 'object' && typeof (value as Binding<T>).get === 'function' && typeof (value as Binding<T>).set === 'function')
}

export function isViewNode(value: unknown): value is ViewNode {
  return Boolean(value && typeof value === 'object' && typeof (value as ViewNode).measure === 'function' && typeof (value as ViewNode).render === 'function')
}

export function isChildCollection(value: ViewChild): value is ChildCollection {
  return !isViewNode(value) && Boolean(value && typeof (value as ChildCollection).expand === 'function')
}
