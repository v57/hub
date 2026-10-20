/** Helpers for page tests that drive the terminal UI. */
import { createHubClientView } from '../index'
import { MemoryTerminalDevice, Terminal } from '../terminal'
import { createClientPageState, type ClientPageState, type ClientRouteId } from './types'

export function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

export function plain(terminal: Terminal): string {
  return stripAnsi(terminal.renderToString())
}

type Candidate = { id: string; bounds: { x: number; y: number; width: number; height: number } }

/** Focuses the control whose on-screen bounds show `label`. */
function focusLabel(terminal: Terminal, label: string): void {
  const lines = plain(terminal).split('\n')
  // Smallest first: the navigation's escape handler spans the whole screen.
  const candidates = ((terminal as unknown as { candidates?: Candidate[] }).candidates ?? [])
    .slice()
    .sort((left, right) => left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height)
  for (const candidate of candidates) {
    const { x, y, width, height } = candidate.bounds
    const text = lines.slice(y, y + Math.max(height, 1)).map(line => line.slice(x, x + width)).join(' ')
    if (text.includes(label)) {
      terminal.focus(candidate.id)
      return
    }
  }
  throw new Error(`Could not focus ${label}. Last frame:\n${lines.join('\n')}`)
}

/** Frames flush at most every 100 ms; wait for one so the focus candidates are current. */
export const flush = () => Bun.sleep(150)

export async function press(client: ReturnType<typeof render>, label: string): Promise<void> {
  await flush()
  focusLabel(client.terminal, label)
  client.device.emitKey({ key: 'enter' })
  await flush()
}

export function render(state: Partial<ClientPageState>, path: ClientRouteId[]) {
  const pageState = createClientPageState(state)
  const device = new MemoryTerminalDevice({ width: 120, height: 80 })
  const terminal = new Terminal(device).controls(true)
  terminal.display(createHubClientView(pageState, path))
  return { device, terminal, state: pageState }
}
