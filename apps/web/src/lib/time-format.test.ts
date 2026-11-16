import { expect, test } from 'bun:test'
import { startsIn } from './tournament-formats'
import { clock } from './when'

const at = (ms: number) => new Date(ms).toISOString()

test('a clock shows minutes and seconds, past an hour too', () => {
  expect(clock(0)).toBe('0:00')
  expect(clock(247)).toBe('4:07')
  expect(clock(4_500)).toBe('75:00')
  expect(clock(-3)).toBe('0:00')
})

test('a tournament starts in minutes, hours, a day or days', () => {
  expect(startsIn(at(60_000), 60_000)).toBe('Starting now')
  expect(startsIn(at(30_000), 0)).toBe('Starts in 1m')
  expect(startsIn(at(23_520_000), 0)).toBe('Starts in 6h 32m')
  expect(startsIn(at(100_800_000), 0)).toBe('Starts in 1d 4h')
  expect(startsIn(at(259_200_000), 0)).toBe('Starts in 3 days')
})
