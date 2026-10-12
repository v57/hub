import { expect, test } from 'bun:test'
import { MemoryTerminalDevice, Terminal } from './index'
import {
  MusicQueueApp,
  advanceMusicQueueClock,
  createMusicQueueState,
  formatMusicQueueTime,
  selectMusicQueueNext,
  selectMusicQueueTrack,
  type MusicQueueState,
  type Track,
} from './examples/music-queue'

const tracks: Track[] = [
  { id: 'one', title: 'One', artist: 'Test Artist', duration: 20 },
  { id: 'two', title: 'Two', artist: 'Test Artist', duration: 30 },
]

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function rendered(device: MemoryTerminalDevice): string {
  return stripAnsi(device.writes.at(-1) ?? '')
}

function progressLine(output: string): string {
  return output.split('\n').find(line => /^[#-]+$/.test(line.trim())) ?? ''
}

function runMusicQueue(state: MusicQueueState): { device: MemoryTerminalDevice; terminal: Terminal } {
  const device = new MemoryTerminalDevice({ width: 60, height: 12 })
  const terminal = new Terminal(device)
  terminal.display(() => MusicQueueApp(state, { tracks, clockIntervalMs: 20 }))
  return { device, terminal }
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  expect(predicate()).toBe(true)
}

test('music queue visible player task advances elapsed time and progress output', async () => {
  const state = createMusicQueueState({ selectedId: 'one', elapsed: 0, playing: true })
  const { device, terminal } = runMusicQueue(state)
  const initial = rendered(device)
  const initialProgress = progressLine(initial)

  try {
    await waitFor(() => state.elapsed > 0 && rendered(device) !== initial)
    const updated = rendered(device)

    expect(updated).toContain(formatMusicQueueTime(state.elapsed))
    expect(progressLine(updated)).not.toBe(initialProgress)
  } finally {
    terminal.stop()
  }
})

test('music queue paused playback does not advance on clock ticks', async () => {
  const state = createMusicQueueState({ selectedId: 'one', elapsed: 3, playing: false })
  const { device, terminal } = runMusicQueue(state)
  const initial = rendered(device)

  try {
    await Bun.sleep(180)

    expect(state.elapsed).toBe(3)
    expect(rendered(device)).toBe(initial)
  } finally {
    terminal.stop()
  }
})

test('music queue track changes reset elapsed time and rendered progress', async () => {
  const state = createMusicQueueState({ selectedId: 'one', elapsed: 7, playing: false })
  const { device, terminal } = runMusicQueue(state)

  try {
    selectMusicQueueNext(state, 1, tracks)
    terminal.setNeedsUpdate()
    await Bun.sleep(120)

    expect(state.selectedId).toBe('two')
    expect(state.elapsed).toBe(0)
    expect(rendered(device)).toContain('Two')
    expect(rendered(device)).toContain('0:00')

    state.elapsed = 6
    selectMusicQueueTrack(state, 'one')
    terminal.setNeedsUpdate()
    await Bun.sleep(120)

    expect(state.selectedId).toBe('one')
    expect(state.elapsed).toBe(0)
    expect(rendered(device)).toContain('One')
    expect(rendered(device)).toContain('0:00')
  } finally {
    terminal.stop()
  }
})

test('music queue clock wraps at the selected track duration', () => {
  const shortTracks: Track[] = [{ id: 'short', title: 'Short', artist: 'Test Artist', duration: 2 }]
  const state = createMusicQueueState({ selectedId: 'short', elapsed: 1, playing: true })

  expect(advanceMusicQueueClock(state, shortTracks)).toBe(true)
  expect(state.elapsed).toBe(0)
})
