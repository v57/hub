import { expect, test } from 'bun:test'
import { RenderBuffer } from './render'
import { ansi256 } from './types'

test('RenderBuffer writes and clips deterministically', () => {
  const buffer = new RenderBuffer({ width: 5, height: 2 })

  buffer.write(1, 0, 'abcd', { x: 2, y: 0, width: 2, height: 1 })

  expect(buffer.toString()).toBe('  bc \n     ')
})

test('RenderBuffer copyFrom copies source rectangle', () => {
  const source = new RenderBuffer({ width: 4, height: 1 })
  const target = new RenderBuffer({ width: 4, height: 1 })

  source.write(0, 0, 'abcd')
  target.copyFrom(source, { x: 1, y: 0, width: 2, height: 1 }, 0, 0)

  expect(target.toString()).toBe('bc  ')
})

test('RenderBuffer emits ANSI foreground colors without affecting plain output', () => {
  const buffer = new RenderBuffer({ width: 4, height: 1 })

  buffer.write(0, 0, 'Hi', undefined, 'tint')

  expect(buffer.toString()).toBe('Hi  ')
  expect(buffer.toAnsiString()).toBe('\x1b[38;5;208mHi\x1b[39m  ')
})

test('RenderBuffer emits ANSI 256 foreground colors without affecting plain output', () => {
  const buffer = new RenderBuffer({ width: 4, height: 1 })

  buffer.write(0, 0, 'Hi', undefined, ansi256(143))

  expect(buffer.toString()).toBe('Hi  ')
  expect(buffer.toAnsiString()).toBe('\x1b[38;5;143mHi\x1b[39m  ')
})

test('RenderBuffer emits ANSI font weights without affecting plain output', () => {
  const buffer = new RenderBuffer({ width: 4, height: 1 })

  buffer.write(0, 0, 'Hi', undefined, undefined, 'bold')

  expect(buffer.toString()).toBe('Hi  ')
  expect(buffer.toAnsiString()).toBe('\x1b[1mHi\x1b[22m  ')
})

test('RenderBuffer fills backgrounds and accounts for wide characters', () => {
  const buffer = new RenderBuffer({ width: 4, height: 1 })

  buffer.fill({ x: 0, y: 0, width: 4, height: 1 }, 'blue')
  buffer.write(0, 0, '界A')

  expect(buffer.toString()).toBe('界 A ')
  expect(buffer.toAnsiString()).toBe('\x1b[44m界 A \x1b[49m')
})

test('RenderBuffer emits ANSI 256 backgrounds and resets at boundaries', () => {
  const buffer = new RenderBuffer({ width: 4, height: 1 })

  buffer.fill({ x: 0, y: 0, width: 2, height: 1 }, ansi256(143))
  buffer.write(0, 0, 'AB')
  buffer.write(2, 0, 'CD')

  expect(buffer.toString()).toBe('ABCD')
  expect(buffer.toAnsiString()).toBe('\x1b[48;5;143mAB\x1b[49mCD')
})

test('ansi256 rejects invalid indexes', () => {
  expect(() => ansi256(-1)).toThrow(RangeError)
  expect(() => ansi256(256)).toThrow(RangeError)
  expect(() => ansi256(1.5)).toThrow(RangeError)
})
