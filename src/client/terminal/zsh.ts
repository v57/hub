import { ansi256, displayWidth, type BackgroundColor, type FontWeight, type ForegroundColor } from './types'

export type TextStyle = {
  foregroundColor?: ForegroundColor
  backgroundColor?: BackgroundColor
  fontWeight?: FontWeight
}

export type StyledSegment = {
  text: string
  style?: TextStyle
}

export type ShellLine = {
  segments: StyledSegment[]
}

export type ShellFileKind = 'file' | 'directory' | 'symlink' | 'executable'

export type ListingEntry = {
  name: string
  kind: ShellFileKind
  size: number
  permissions: string
}

export type ShellEntry = ShellLine

export type ZshTerminalSettings = {
  homePath: string
  ps1: string
  clicolor: string
  lscolors: string
}

export type ZshTerminalState = {
  cwd: string
  input: string
  lines: ShellLine[]
}

export const ZSH_TERMINAL_SETTINGS: ZshTerminalSettings = {
  homePath: '/Users/display',
  ps1: '%B%F{143}%0~ %f%b',
  clicolor: '1',
  lscolors: 'ExFxBxDxCxegedabagacad',
}

export const ZSH_HOME_TREE: ListingEntry[] = [
  { name: 'Desktop', kind: 'directory', size: 160, permissions: 'drwxr-xr-x' },
  { name: 'Documents', kind: 'directory', size: 192, permissions: 'drwxr-xr-x' },
  { name: 'display', kind: 'directory', size: 224, permissions: 'drwxr-xr-x' },
  { name: 'README.md', kind: 'file', size: 4096, permissions: '-rw-r--r--' },
  { name: 'run-demo', kind: 'executable', size: 128, permissions: '-rwxr-xr-x' },
  { name: 'latest', kind: 'symlink', size: 7, permissions: 'lrwxr-xr-x' },
]

const defaultPromptStyle: TextStyle = { foregroundColor: ansi256(143), fontWeight: 'bold' }

export function createZshTerminalState(settings: Partial<ZshTerminalSettings> = {}): ZshTerminalState {
  const merged = { ...ZSH_TERMINAL_SETTINGS, ...settings }
  return { cwd: merged.homePath, input: '', lines: [] }
}

export function resetZshTerminalState(state: ZshTerminalState, settings: Partial<ZshTerminalSettings> = {}): void {
  const merged = { ...ZSH_TERMINAL_SETTINGS, ...settings }
  state.cwd = merged.homePath
  state.input = ''
  state.lines = []
}

export function displayCwd(cwd: string, homePath = ZSH_TERMINAL_SETTINGS.homePath): string {
  const normalizedHome = trimTrailingSlash(homePath)
  const normalizedCwd = trimTrailingSlash(cwd)
  if (normalizedCwd === normalizedHome) return '~'
  const prefix = `${normalizedHome}/`
  if (normalizedCwd.startsWith(prefix)) return normalizedCwd.split('/').filter(Boolean).at(-1) ?? '~'
  return normalizedCwd.split('/').filter(Boolean).at(-1) ?? '/'
}

export function formatZshPrompt(
  state: Pick<ZshTerminalState, 'cwd' | 'input'>,
  settings: Partial<ZshTerminalSettings> = {},
): StyledSegment[] {
  const merged = { ...ZSH_TERMINAL_SETTINGS, ...settings }
  const promptText = `${displayCwd(state.cwd, merged.homePath)} `
  return [{ text: promptText, style: defaultPromptStyle }, { text: state.input }]
}

export function promptVisibleWidth(segments: StyledSegment[]): number {
  return segments.reduce((sum, segment) => sum + displayWidth(segment.text), 0)
}

export function shellLineText(line: ShellLine): string {
  return line.segments.map(segment => segment.text).join('')
}

export function shellScrollbackText(state: Pick<ZshTerminalState, 'lines'>): string {
  return state.lines.map(shellLineText).join('\n')
}

export function parseLSColors(value: string): Partial<Record<ShellFileKind, TextStyle>> {
  return {
    directory: styleFromPair(value.slice(0, 2)),
    symlink: styleFromPair(value.slice(2, 4)),
    executable: styleFromPair(value.slice(8, 10)),
  }
}

export function styleForShellEntry(entry: Pick<ListingEntry, 'kind'>, settings: Partial<ZshTerminalSettings> = {}): TextStyle | undefined {
  const merged = { ...ZSH_TERMINAL_SETTINGS, ...settings }
  if (merged.clicolor !== '1') return undefined
  return parseLSColors(merged.lscolors)[entry.kind]
}

export function runZshCommand(
  state: ZshTerminalState,
  command: string,
  settings: Partial<ZshTerminalSettings> = {},
): ShellLine[] {
  const trimmed = command.trim()
  const merged = { ...ZSH_TERMINAL_SETTINGS, ...settings }
  const prompt = formatZshPrompt({ cwd: state.cwd, input: command }, merged)
  const lines: ShellLine[] = [{ segments: prompt }]

  if (trimmed === '') {
    state.lines.push(...lines)
    state.input = ''
    return lines
  }

  if (trimmed === 'pwd') {
    lines.push({ segments: [{ text: state.cwd }] })
  } else if (trimmed === 'clear') {
    state.lines = []
    state.input = ''
    return []
  } else if (trimmed === 'ls' || trimmed === 'ls -la' || trimmed === 'ls -al') {
    lines.push(...listHome(trimmed.includes('-l'), merged))
  } else if (trimmed === 'cd' || trimmed === 'cd ~') {
    state.cwd = merged.homePath
  } else if (trimmed.startsWith('cd ')) {
    const target = trimmed.slice(3).trim()
    state.cwd = target.startsWith('/') ? target : `${trimTrailingSlash(state.cwd)}/${target}`
  } else {
    const executable = trimmed.split(/\s+/)[0] ?? trimmed
    lines.push({ segments: [{ text: `zsh: command not found: ${executable}` }] })
  }

  state.lines.push(...lines)
  state.input = ''
  return lines
}

function listHome(long: boolean, settings: ZshTerminalSettings): ShellLine[] {
  return ZSH_HOME_TREE.map(entry => {
    const style = styleForShellEntry(entry, settings)
    const name = { text: entry.name, style }
    if (!long) return { segments: [name] }
    return {
      segments: [
        { text: `${entry.permissions} ${entry.size.toString().padStart(5)} ` },
        name,
      ],
    }
  })
}

function styleFromPair(pair: string): TextStyle | undefined {
  if (pair.length < 2) return undefined
  const foreground = colorFromLSColor(pair[0]!)
  const background = colorFromLSColor(pair[1]!)
  const style: TextStyle = {}
  if (foreground.color) style.foregroundColor = foreground.color
  if (foreground.bold) style.fontWeight = 'bold'
  if (background.color) style.backgroundColor = background.color
  return Object.keys(style).length > 0 ? style : undefined
}

function colorFromLSColor(value: string): { color?: ForegroundColor; bold?: boolean } {
  const bold = value >= 'A' && value <= 'H'
  const normalized = value.toLowerCase()
  if (normalized === 'x') return {}
  if (normalized === 'a') return { color: 'black', bold }
  if (normalized === 'b') return { color: 'red', bold }
  if (normalized === 'c') return { color: 'green', bold }
  if (normalized === 'd') return { color: 'yellow', bold }
  if (normalized === 'e') return { color: 'blue', bold }
  if (normalized === 'f') return { color: 'magenta', bold }
  if (normalized === 'g') return { color: 'cyan', bold }
  if (normalized === 'h') return { color: 'white', bold }
  return {}
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}
