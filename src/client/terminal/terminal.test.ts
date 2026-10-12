import { expect, test } from 'bun:test'
import { MemoryTerminalDevice, Terminal, Text, type KeyEvent, type Size, type TerminalDevice } from './index'
import type { Cleanup } from './types'

class RecordingProcessDevice implements TerminalDevice {
  readonly order: string[] = []
  readonly writes: string[] = []
  private readonly keyCallbacks = new Set<(event: KeyEvent) => void>()
  private readonly resizeCallbacks = new Set<() => void>()

  constructor(private readonly size: Size = { width: 8, height: 2 }) {}

  getSize(): Size {
    return this.size
  }

  write(text: string): void {
    this.writes.push(text)
  }

  onResize(callback: () => void): Cleanup {
    this.resizeCallbacks.add(callback)
    return () => {
      this.order.push('resize:cleanup')
      this.resizeCallbacks.delete(callback)
    }
  }

  onKey(callback: (event: KeyEvent) => void): Cleanup {
    this.keyCallbacks.add(callback)
    return () => {
      this.order.push('key:cleanup')
      this.keyCallbacks.delete(callback)
    }
  }

  setRawMode(enabled: boolean): void {
    this.order.push(`raw:${enabled ? 'on' : 'off'}`)
  }

  requestInterruptExit(): void {
    this.order.push('exit')
  }

  emitKey(event: KeyEvent): void {
    for (const callback of this.keyCallbacks) callback(event)
  }
}

function pendingAsyncText(order: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          order.push('async:next')
          return new Promise<IteratorResult<string>>(() => {})
        },
        return() {
          order.push('async:return')
          return Promise.resolve({ done: true, value: undefined })
        },
      }
    },
  }
}

test('Ctrl+C runs cleanup before requesting interrupt exit', async () => {
  const device = new RecordingProcessDevice()
  const terminal = new Terminal(device)

  terminal.display(() =>
    Text(pendingAsyncText(device.order)).task('cleanup', context => {
      context.signal.addEventListener('abort', () => {
        device.order.push('task:abort')
      })
    }),
  )

  await Promise.resolve()
  device.emitKey({ key: 'ctrl-c' })

  const exitIndex = device.order.indexOf('exit')
  expect(exitIndex).toBeGreaterThan(-1)
  expect(device.order.indexOf('resize:cleanup')).toBeLessThan(exitIndex)
  expect(device.order.indexOf('key:cleanup')).toBeLessThan(exitIndex)
  expect(device.order.indexOf('raw:off')).toBeLessThan(exitIndex)
  expect(device.order.indexOf('async:return')).toBeLessThan(exitIndex)
  expect(device.order.indexOf('task:abort')).toBeLessThan(exitIndex)
})

test('Ctrl+C key binding consumes interrupt before process exit hook', () => {
  const device = new RecordingProcessDevice()
  const terminal = new Terminal(device)
  let handled = 0

  terminal.display(() =>
    Text('Run').keyBinding('ctrl-c', 'Interrupt', () => {
      handled += 1
    }),
  )

  device.emitKey({ key: 'ctrl-c', raw: '\u0003' })

  expect(handled).toBe(1)
  expect(device.order).not.toContain('exit')
})

test('Ctrl+C on memory device stops without process exit hook', async () => {
  const device = new MemoryTerminalDevice({ width: 4, height: 1 })
  const terminal = new Terminal(device)
  let value = 'Run'

  terminal.display(() => Text(value))
  expect(device.writes.at(-1)).toBe('Run ')

  device.emitKey({ key: 'ctrl-c' })
  value = 'Next'
  terminal.setNeedsUpdate()
  await Bun.sleep(120)

  expect(device.writes.at(-1)).toBe('Run ')
  expect('requestInterruptExit' in device).toBe(false)
})

test('Direct terminal.stop does not request interrupt exit', () => {
  const device = new RecordingProcessDevice()
  const terminal = new Terminal(device)

  terminal.display(() => Text('Run'))
  terminal.stop()

  expect(device.order).not.toContain('exit')
})
