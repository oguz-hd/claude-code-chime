// Pure helpers for playing sounds: no engine calls here (`$` stays in register.tsx).

// Windows: System.Media.SoundPlayer ships with every Windows and needs nothing
// installed, but it plays .wav only and has no volume control. So the volume is
// applied to the samples, and the scaled copy is cached in %TEMP%.

export const POWERSHELL = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
export const PS_PLAY = '& { (New-Object Media.SoundPlayer $args[0]).PlaySync() }'
export const PS_WRITE_AND_PLAY =
  '& { $o = $args[0]; [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($o)); ' +
  '[IO.File]::WriteAllBytes($o, [Convert]::FromBase64String([Console]::In.ReadToEnd())); ' +
  '(New-Object Media.SoundPlayer $o).PlaySync() }'

// Linux (and WSL with WSLg): the first player that is installed and works wins.
export const posixPlayers = (path: string, gain: number): string[][] => [
  ['pw-play', `--volume=${gain.toFixed(2)}`, path],
  ['paplay', `--volume=${Math.round(gain * 65536)}`, path],
  ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(Math.round(gain * 100)), path],
  ['aplay', '-q', path], // no volume control
]

// --------------------------------------------------------------------- WAV

/**
 * Returns a copy of a RIFF/WAVE file with every sample multiplied by `gain`,
 * or null for an encoding it does not handle (compressed WAV). Handles 8-, 16-,
 * 24- and 32-bit PCM and 32-bit float, including WAVE_FORMAT_EXTENSIBLE.
 */
export function scaleWav(bytes: Uint8Array, gain: number): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null

  let format = 0
  let bits = 0
  let dataStart = -1
  let dataEnd = -1
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      bits = view.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true)
    } else if (id === 'data') {
      dataStart = body
      dataEnd = Math.min(bytes.length, body + size)
    }
    at = body + size + (size % 2)
  }
  if (dataStart < 0 || bits === 0) return null

  const out = bytes.slice()
  const o = new DataView(out.buffer)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)))
  if (format === 1 && bits === 16) {
    for (let i = dataStart; i + 1 < dataEnd; i += 2) o.setInt16(i, clamp(o.getInt16(i, true) * gain, -32768, 32767), true)
  } else if (format === 1 && bits === 8) {
    for (let i = dataStart; i < dataEnd; i++) o.setUint8(i, clamp((o.getUint8(i) - 128) * gain + 128, 0, 255))
  } else if (format === 1 && bits === 24) {
    for (let i = dataStart; i + 2 < dataEnd; i += 3) {
      let v = o.getUint8(i) | (o.getUint8(i + 1) << 8) | (o.getUint8(i + 2) << 16)
      if (v & 0x800000) v -= 0x1000000
      v = clamp(v * gain, -0x800000, 0x7fffff)
      o.setUint8(i, v & 0xff)
      o.setUint8(i + 1, (v >> 8) & 0xff)
      o.setUint8(i + 2, (v >> 16) & 0xff)
    }
  } else if (format === 1 && bits === 32) {
    for (let i = dataStart; i + 3 < dataEnd; i += 4) o.setInt32(i, clamp(o.getInt32(i, true) * gain, -2147483648, 2147483647), true)
  } else if (format === 3 && bits === 32) {
    for (let i = dataStart; i + 3 < dataEnd; i += 4) o.setFloat32(i, o.getFloat32(i, true) * gain, true)
  } else {
    return null
  }
  return out
}

// --------------------------------------------------------------------- helpers

export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
