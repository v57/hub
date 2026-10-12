import { existsSync } from 'node:fs'
import { EmbeddedTerminal, HStack, Spacer, Terminal, Text, VStack, type EmbeddedTerminalHandle } from '../index'

export const ZSH_TERMINAL_ENV = {
  CLICOLOR: '1',
  LSCOLORS: 'ExFxBxDxCxegedabagacad',
  PROMPT_EOL_MARK: '',
  PS1: '%B%F{143}%0~ %f%b',
} as const

type TerminalRunOptions = {
  cwd?: string
  shell?: string
}

const terminalName = 'xterm-256color'
const smokeScript = ['print -r -- DISPLAY_TERMINAL_LAYOUT_SMOKE', 'pwd', 'exit', ''].join('\r')

export function resolveZshShell(shell = process.env.SHELL): string {
  if (shell?.split('/').at(-1) === 'zsh') return shell
  if (existsSync('/bin/zsh')) return '/bin/zsh'
  return 'zsh'
}

export async function runTerminalExample(smoke = false, options: TerminalRunOptions = {}): Promise<number> {
  const terminal = new Terminal()
  const shell = resolveZshShell(options.shell)
  let resolveReady!: (handle: EmbeddedTerminalHandle) => void
  let resolveExit!: (code: number) => void
  const ready = new Promise<EmbeddedTerminalHandle>(resolve => {
    resolveReady = resolve
  })
  const exited = new Promise<number>(resolve => {
    resolveExit = resolve
  })

  terminal.display(() =>
    VStack(
      [
        HStack([Text('Time').fontWeight('bold'), Spacer({ minLength: 2 }), Text(clock()).foregroundColor('green')]),
        EmbeddedTerminal([shell, '-f'], {
          cwd: options.cwd ?? process.cwd(),
          env: {
            ...process.env,
            TERM: terminalName,
            ...ZSH_TERMINAL_ENV,
          },
          name: terminalName,
          restartKey: shell,
          onReady: resolveReady,
          onExit: code => {
            setTimeout(() => {
              terminal.stop()
              resolveExit(code)
            }, 120)
          },
        }).frame({ maxWidth: -1, maxHeight: -1 }),
      ],
      { spacing: 1 },
    ).frame({ maxWidth: -1, maxHeight: -1 }),
  )

  if (smoke) {
    const handle = await ready
    await sleep(50)
    handle.write(smokeScript)
  }

  return await exited
}

export const runZshTerminalExample = runTerminalExample

async function* clock(): AsyncIterable<string> {
  while (true) {
    yield new Date().toLocaleTimeString()
    await sleep(500)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

if (import.meta.main) {
  const code = await runTerminalExample(process.env.DISPLAY_SMOKE === '1')
  process.exitCode = code
}
