import { expect, test } from 'bun:test'
import {
  EmbeddedTerminal,
  MemoryTerminalDevice,
  RenderBuffer,
  Terminal,
  TerminalScreenBuffer,
  type EmbeddedTerminalProcess,
  type EmbeddedTerminalSpawnOptions,
  type EmbeddedTerminalSpawner,
} from './index'

class ExitMemoryTerminalDevice extends MemoryTerminalDevice {
  exitRequests = 0

  requestInterruptExit(): void {
    this.exitRequests += 1
  }
}

type FakeProcess = EmbeddedTerminalProcess & {
  writes: string[]
  resizes: { cols: number; rows: number }[]
  spawnSize: { cols: number; rows: number }
  killed: boolean
  emit(data: string): void
  exit(code: number): void
}

function createFakeSpawner(): { spawn: EmbeddedTerminalSpawner; process(): FakeProcess } {
  let current: FakeProcess | undefined
  const encoder = new TextEncoder()
  const spawn: EmbeddedTerminalSpawner = (_command: string[], options: EmbeddedTerminalSpawnOptions) => {
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>(resolve => {
      resolveExit = resolve
    })
    current = {
      writes: [],
      resizes: [],
      spawnSize: { cols: options.cols, rows: options.rows },
      killed: false,
      terminal: {
        write(data) {
          current?.writes.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
        },
        resize(cols, rows) {
          current?.resizes.push({ cols, rows })
        },
      },
      exited,
      kill() {
        current!.killed = true
        resolveExit(143)
      },
      emit(data: string) {
        options.onData(encoder.encode(data))
      },
      exit(code: number) {
        resolveExit(code)
      },
    }
    return current
  }

  return {
    spawn,
    process() {
      if (!current) throw new Error('fake process was not spawned')
      return current
    },
  }
}

test('TerminalScreenBuffer parses line clearing and styled output', () => {
  const screen = new TerminalScreenBuffer({ width: 8, height: 2 })
  screen.write('abc\r\x1b[Kx')

  expect(screen.toString()).toBe('x       \n        ')

  const styled = new TerminalScreenBuffer({ width: 4, height: 1 })
  styled.write('\x1b[1;38;5;143mHi\x1b[0m')
  const buffer = new RenderBuffer({ width: 4, height: 1 })
  styled.renderTo(buffer, buffer.bounds, buffer.bounds)

  expect(buffer.toAnsiString()).toBe('\x1b[1m\x1b[38;5;143mHi\x1b[22m\x1b[39m  ')
})

test('EmbeddedTerminal renders child output inside Display bounds', async () => {
  const fake = createFakeSpawner()
  const device = new MemoryTerminalDevice({ width: 6, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() => EmbeddedTerminal(['fake'], { spawn: fake.spawn }).frame({ maxWidth: -1, maxHeight: -1 }))
  await Promise.resolve()
  fake.process().emit('hi')
  await Bun.sleep(120)

  expect(device.writes.at(-1)).toBe('hi    \n      ')
})

test('EmbeddedTerminal forwards raw keys including Ctrl+C without outer exit', async () => {
  const fake = createFakeSpawner()
  const device = new ExitMemoryTerminalDevice({ width: 6, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() => EmbeddedTerminal(['fake'], { spawn: fake.spawn }).frame({ maxWidth: -1, maxHeight: -1 }))
  await Promise.resolve()

  device.emitKey({ key: 'char', char: 'a', raw: 'a' })
  device.emitKey({ key: 'ctrl-c', raw: '\u0003' })

  expect(fake.process().writes).toEqual(['a', '\u0003'])
  expect(device.exitRequests).toBe(0)
})

test('EmbeddedTerminal uses layout size for spawn, resize, and cleanup', async () => {
  const fake = createFakeSpawner()
  const device = new MemoryTerminalDevice({ width: 5, height: 2 })
  const terminal = new Terminal(device)

  terminal.display(() => EmbeddedTerminal(['fake'], { spawn: fake.spawn }).frame({ maxWidth: -1, maxHeight: -1 }))
  await Promise.resolve()

  expect(fake.process().spawnSize).toEqual({ cols: 5, rows: 2 })

  device.setSize({ width: 7, height: 3 })
  await Bun.sleep(120)

  expect(fake.process().resizes.at(-1)).toEqual({ cols: 7, rows: 3 })

  terminal.stop()
  expect(fake.process().killed).toBe(true)
})
