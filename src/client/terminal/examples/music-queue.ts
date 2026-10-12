import { Button, ForEach, HStack, MemoryTerminalDevice, ProgressBar, ScrollView, Spacer, Terminal, Text, VStack, type TaskContext } from '../index'

export type Track = { id: string; title: string; artist: string; duration: number }
export type MusicQueueState = { selectedId: string; playing: boolean; elapsed: number }

export const musicQueueTracks: Track[] = [
  { id: 'one', title: 'First Frame', artist: 'Terminal Club', duration: 185 },
  { id: 'two', title: 'Focus Ring', artist: 'Layout Engine', duration: 214 },
  { id: 'three', title: 'Diff Patch', artist: 'Render Buffer', duration: 198 },
  { id: 'four', title: 'Async Iterator', artist: 'Task Runner', duration: 242 },
]

export function createMusicQueueState(overrides: Partial<MusicQueueState> = {}): MusicQueueState {
  return { selectedId: 'two', playing: true, elapsed: 42, ...overrides }
}

export function currentTrack(state: MusicQueueState, tracks: Track[] = musicQueueTracks): Track {
  return tracks.find(track => track.id === state.selectedId) ?? tracks[0]!
}

export function formatMusicQueueTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function advanceMusicQueueClock(state: MusicQueueState, tracks: Track[] = musicQueueTracks, seconds = 1): boolean {
  if (!state.playing) return false
  const duration = Math.max(1, currentTrack(state, tracks).duration)
  const nextElapsed = (Math.max(0, state.elapsed) + seconds) % duration
  const changed = nextElapsed !== state.elapsed
  state.elapsed = nextElapsed
  return changed
}

export function selectMusicQueueTrack(state: MusicQueueState, trackId: string): void {
  state.selectedId = trackId
  state.elapsed = 0
}

export function selectMusicQueueNext(state: MusicQueueState, step: number, tracks: Track[] = musicQueueTracks): void {
  if (tracks.length === 0) return
  const index = Math.max(0, tracks.findIndex(track => track.id === state.selectedId))
  selectMusicQueueTrack(state, tracks[(index + step + tracks.length) % tracks.length]!.id)
}

function playerClockTask(state: MusicQueueState, tracks: Track[], intervalMs: number) {
  return async (context: TaskContext) => {
    while (!context.signal.aborted) {
      await Bun.sleep(intervalMs)
      if (context.signal.aborted) return
      if (advanceMusicQueueClock(state, tracks)) context.setNeedsUpdate()
    }
  }
}

function TrackRow(state: MusicQueueState, track: Track) {
  const selected = track.id === state.selectedId
  return Button(`${selected ? '*' : ' '} ${track.title} - ${track.artist}`, () => {
    selectMusicQueueTrack(state, track.id)
  })
    .frame({ maxWidth: -1, alignment: 'leading' })
    .foregroundColor(selected ? 'cyan' : 'primary')
    .id(track.id)
}

export function MusicQueueApp(state: MusicQueueState, options: { tracks?: Track[]; clockIntervalMs?: number } = {}) {
  const tracks = options.tracks ?? musicQueueTracks
  const track = currentTrack(state, tracks)
  return VStack(
    [
      Text('Music Queue').fontWeight('bold').foregroundColor('cyan'),
      VStack(
        [
          HStack([Text(track.title).fontWeight('bold'), Spacer({ minLength: 1 }), Text(state.playing ? 'Playing' : 'Paused').foregroundColor(state.playing ? 'green' : 'yellow')]),
          Text(track.artist).foregroundColor('secondary'),
          ProgressBar(state.elapsed / Math.max(1, track.duration)).frame({ maxWidth: -1 }),
          HStack([Text(formatMusicQueueTime(state.elapsed)), Spacer({ minLength: 1 }), Text(formatMusicQueueTime(track.duration))]),
          HStack(
            [
              Button('Prev', () => selectMusicQueueNext(state, -1, tracks)),
              Button(state.playing ? 'Pause' : 'Play', () => {
                state.playing = !state.playing
              }),
              Button('Next', () => selectMusicQueueNext(state, 1, tracks)),
            ],
            { spacing: 1 },
          ),
        ],
        { spacing: 1 },
      ).padding(1).task('player-clock', playerClockTask(state, tracks, options.clockIntervalMs ?? 1000)),
      ScrollView(
        VStack([
          ForEach(
            tracks,
            item => item.id,
            item => TrackRow(state, item),
          ),
        ]),
        { axis: 'vertical' },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 })
}

export async function runMusicQueueExample(smoke = false): Promise<void> {
  const state = createMusicQueueState()
  if (smoke) {
    const device = new MemoryTerminalDevice({ width: 80, height: 20 })
    const terminal = new Terminal(device)
    terminal.display(() => MusicQueueApp(state, { clockIntervalMs: 20 }))
    const initial = device.writes.at(-1) ?? ''
    await Bun.sleep(180)
    const updated = device.writes.at(-1) ?? ''
    terminal.stop()
    process.stdout.write(`${initial}\n---\n${updated}`)
    return
  }

  new Terminal().display(() => MusicQueueApp(state))
}

if (import.meta.main) void runMusicQueueExample(process.env.DISPLAY_SMOKE === '1')
