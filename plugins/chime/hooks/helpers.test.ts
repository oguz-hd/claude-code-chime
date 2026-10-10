import { describe, expect, test } from 'claude-code/testing'

import { BUNDLED, CATEGORIES, DEFAULTS, categoryOf, findCategory, soundsIn, isFilePath, isInQuietHours, normalize, parseDuration, parseQuietHours } from './settings'
import { fromBase64, scaleWav, toBase64 } from './wav'

const at = (h: number, m: number) => new Date(2026, 0, 1, h, m)

describe('quiet hours', () => {
  test('parses HH:MM-HH:MM and rejects the rest', () => {
    expect(parseQuietHours('22:00-08:30')).toEqual({ from: 1320, to: 510 })
    expect(parseQuietHours('9:05 - 17:00')).toEqual({ from: 545, to: 1020 })
    expect(parseQuietHours('25:00-08:00')).toBeNull()
    expect(parseQuietHours('night')).toBeNull()
  })

  test('a range that wraps midnight', () => {
    expect(isInQuietHours('22:00-08:00', at(23, 30))).toBe(true)
    expect(isInQuietHours('22:00-08:00', at(7, 59))).toBe(true)
    expect(isInQuietHours('22:00-08:00', at(8, 0))).toBe(false)
    expect(isInQuietHours('22:00-08:00', at(15, 0))).toBe(false)
  })

  test('a daytime range, and an empty or zero-length one', () => {
    expect(isInQuietHours('12:00-13:00', at(12, 30))).toBe(true)
    expect(isInQuietHours('12:00-13:00', at(13, 0))).toBe(false)
    expect(isInQuietHours('', at(12, 0))).toBe(false)
    expect(isInQuietHours('10:00-10:00', at(10, 0))).toBe(false)
  })
})

describe('durations', () => {
  test('bare numbers are minutes', () => {
    expect(parseDuration('30')).toBe(30 * 60_000)
    expect(parseDuration('2h')).toBe(120 * 60_000)
    expect(parseDuration('1h30m')).toBe(90 * 60_000)
    expect(parseDuration('45min')).toBe(45 * 60_000)
    expect(parseDuration('soon')).toBeNull()
  })
})

describe('settings', () => {
  test('missing or broken values fall back to the defaults', () => {
    expect(normalize(undefined)).toEqual(DEFAULTS)
    expect(normalize({ volume: 'loud', sounds: { done: 'kazoo' } })).toEqual(DEFAULTS)
  })

  test('valid values survive, the volume is clamped', () => {
    const s = normalize({ volume: 140, sounds: { waiting: 'boing', error: 'off', idle: 'C:\\x\\ping.wav' } })
    expect(s.volume).toBe(100)
    expect(s.sounds).toEqual({ done: 'tada', waiting: 'boing', error: 'off', idle: 'C:\\x\\ping.wav' })
  })

  test('file paths on every platform', () => {
    for (const p of ['/home/a/x.wav', '~/x.wav', 'C:\\x.wav', 'D:/x.wav', '\\\\nas\\x.wav']) {
      expect(isFilePath(p)).toBe(true)
    }
    expect(isFilePath('tada')).toBe(false)
  })
})

/** A minimal 16-bit mono WAV holding `samples`. */
function wav16(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(bytes.buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, 44100, true)
  v.setUint32(28, 88200, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true))
  return bytes
}

describe('WAV scaling', () => {
  test('scales 16-bit samples and leaves the header alone', () => {
    const src = wav16([1000, -1000, 32767, -32768])
    const out = scaleWav(src, 0.5)
    expect(out).not.toBeNull()
    const v = new DataView(out!.buffer)
    expect([0, 1, 2, 3].map(i => v.getInt16(44 + i * 2, true))).toEqual([500, -500, 16384, -16384])
    expect([...out!.subarray(0, 44)]).toEqual([...src.subarray(0, 44)])
    expect(new DataView(src.buffer).getInt16(44, true)).toBe(1000) // the source is untouched
  })

  test('refuses what is not a WAV it can scale', () => {
    expect(scaleWav(new Uint8Array([1, 2, 3]), 0.5)).toBeNull()
    const compressed = wav16([0, 0])
    new DataView(compressed.buffer).setUint16(20, 2, true) // ADPCM
    expect(scaleWav(compressed, 0.5)).toBeNull()
  })

  test('base64 round trip', () => {
    const bytes = wav16([1, 2, 3, -4])
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes])
  })
})

describe('sound catalog', () => {
  test('every sound has a known category and ids are unique', () => {
    const ids = BUNDLED.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const b of BUNDLED) expect(CATEGORIES.some(c => c.id === b.category)).toBe(true)
  })

  test('every category has sounds, and a category list shows the sounds it owns', () => {
    for (const c of CATEGORIES) expect(soundsIn(c.id).length).toBeGreaterThan(0)
    expect(soundsIn('retro').map(b => b.id)).toContain('coin')
    expect(categoryOf('tada')).toBe('victory')
    expect(categoryOf('off')).toBeUndefined()
    expect(categoryOf('/x/y.wav')).toBeUndefined()
  })

  test('findCategory takes an id or a label in any case', () => {
    expect(findCategory('Retro')?.id).toBe('retro')
    expect(findCategory(' CALM ')?.id).toBe('calm')
    expect(findCategory('nope')).toBeUndefined()
  })
})
