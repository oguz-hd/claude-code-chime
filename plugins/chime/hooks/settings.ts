import type { ChimeEvent, ChimeSettings, ChimeSound } from '../types'

export const EVENTS: readonly ChimeEvent[] = ['done', 'waiting', 'error', 'idle']

export const EVENT_INFO: Record<ChimeEvent, { label: string; when: string }> = {
  done: { label: 'Done', when: 'Claude finished and handed the turn back to you' },
  waiting: { label: 'Waiting', when: 'Claude needs a permission, an answer or a plan approval' },
  error: { label: 'Error', when: 'the turn ended on an API error (rate limit, overload, auth)' },
  idle: { label: 'Idle', when: 'the prompt has sat unanswered for a while (a reminder)' },
}

/** The bundled sounds are grouped into these categories, in the order the picker lists them. */
export const CATEGORIES: readonly { id: string; label: string; note: string }[] = [
  { id: 'victory', label: 'Victory', note: 'fanfares and "all done" flourishes' },
  { id: 'retro', label: 'Retro', note: '8-bit game sounds' },
  { id: 'bells', label: 'Bells', note: 'doorbells, chimes and mallets' },
  { id: 'cartoon', label: 'Cartoon', note: 'silly and playful' },
  { id: 'tech', label: 'Tech', note: 'beeps, pings and sci-fi' },
  { id: 'calm', label: 'Calm', note: 'soft and unobtrusive' },
]

type Bundled = { id: string; label: string; note: string; category: string }

/** The bundled sounds, grouped by category in the order the picker lists them. */
export const BUNDLED: readonly Bundled[] = [
  { id: 'tada', label: 'Ta-da', note: 'a short pickup note, then a bright chord', category: 'victory' },
  { id: 'fanfare', label: 'Fanfare', note: 'three brass hits, then a chord', category: 'victory' },
  { id: 'success', label: 'Success', note: 'pleasant rising two-note ding', category: 'victory' },

  { id: 'coin', label: 'Coin', note: '8-bit coin pickup', category: 'retro' },
  { id: 'level-up', label: 'Level up', note: 'rising 8-bit arpeggio', category: 'retro' },
  { id: 'power-up', label: 'Power up', note: 'stepped upward sweep', category: 'retro' },
  { id: 'one-up', label: '1-up', note: 'extra-life jingle', category: 'retro' },
  { id: 'blip', label: 'Blip', note: 'one tiny menu beep', category: 'retro' },
  { id: 'laser', label: 'Laser', note: 'zap sliding down', category: 'retro' },
  { id: 'game-over', label: 'Game over', note: 'descending 8-bit sigh', category: 'retro' },

  { id: 'doorbell', label: 'Doorbell', note: 'ding-dong', category: 'bells' },
  { id: 'ding', label: 'Ding', note: 'a single bright bell', category: 'bells' },
  { id: 'glockenspiel', label: 'Glockenspiel', note: 'four rising bell notes', category: 'bells' },
  { id: 'wind-chimes', label: 'Wind chimes', note: 'scattered high bells', category: 'bells' },
  { id: 'gong', label: 'Gong', note: 'deep, slow-fading strike', category: 'bells' },
  { id: 'music-box', label: 'Music box', note: 'tinkling six-note tune', category: 'bells' },

  { id: 'boing', label: 'Boing', note: 'cartoon spring', category: 'cartoon' },
  { id: 'rubber-duck', label: 'Rubber duck', note: 'two squeaks', category: 'cartoon' },
  { id: 'slide-whistle', label: 'Slide whistle', note: 'whistle sliding up', category: 'cartoon' },
  { id: 'sad-trombone', label: 'Sad trombone', note: 'wah wah wah waaah', category: 'cartoon' },
  { id: 'bubble-pop', label: 'Bubble pop', note: 'three quick bubbles', category: 'cartoon' },
  { id: 'cuckoo', label: 'Cuckoo', note: 'cuckoo-clock call, twice', category: 'cartoon' },
  { id: 'whoosh', label: 'Whoosh', note: 'airy swoosh', category: 'cartoon' },

  { id: 'microwave', label: 'Microwave', note: 'beep beep beep', category: 'tech' },
  { id: 'robot', label: 'Robot', note: 'beep-boop chirps', category: 'tech' },
  { id: 'sonar', label: 'Sonar', note: 'ping with fading echoes', category: 'tech' },
  { id: 'scanner', label: 'Scanner', note: 'wobbling radar sweep', category: 'tech' },
  { id: 'computer', label: 'Computer', note: 'four two-tone beeps', category: 'tech' },

  { id: 'singing-bowl', label: 'Singing bowl', note: 'long, soft ring', category: 'calm' },
  { id: 'water-drop', label: 'Water drop', note: 'two soft drips', category: 'calm' },
  { id: 'harp', label: 'Harp', note: 'gentle rising strum', category: 'calm' },
  { id: 'marimba', label: 'Marimba', note: 'three warm wooden notes', category: 'calm' },
]

/** The bundled sounds of one category, in listing order. */
export const soundsIn = (category: string) => BUNDLED.filter(b => b.category === category)

/** The category a sound belongs to, or undefined for `off` and file paths. */
export const categoryOf = (sound: ChimeSound) => BUNDLED.find(b => b.id === sound)?.category

/** Finds a category by id or label, ignoring case. */
export const findCategory = (text: string) => {
  const t = text.trim().toLowerCase()
  return CATEGORIES.find(c => c.id === t || c.label.toLowerCase() === t)
}

export const DEFAULTS: ChimeSettings = {
  isEnabled: true,
  volume: 60,
  sounds: { done: 'tada', waiting: 'doorbell', error: 'sad-trombone', idle: 'off' },
  minTurnSeconds: 0,
  quietHours: '',
  isPlayingOverSsh: false,
}

export const isBundled = (sound: ChimeSound) => BUNDLED.some(b => b.id === sound)

/** True for `/x`, `~/x`, `C:\x`, `C:/x` and `\\server\share`. */
export const isFilePath = (sound: ChimeSound) =>
  /^(\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/.test(sound)

export const soundLabel = (sound: ChimeSound) =>
  sound === 'off' ? 'off' : (BUNDLED.find(b => b.id === sound)?.label ?? sound)

export const clampVolume = (n: number) => Math.round(Math.min(100, Math.max(0, n)))

/**
 * Fills in what a stored value lacks and drops what no longer fits, so a
 * settings file from an older or newer version still loads.
 */
export function normalize(raw: unknown): ChimeSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<ChimeSettings>
  const sounds = { ...DEFAULTS.sounds }
  for (const event of EVENTS) {
    const value = s.sounds?.[event]
    if (typeof value === 'string' && (value === 'off' || isBundled(value) || isFilePath(value))) {
      sounds[event] = value
    }
  }
  return {
    isEnabled: typeof s.isEnabled === 'boolean' ? s.isEnabled : DEFAULTS.isEnabled,
    volume: typeof s.volume === 'number' && Number.isFinite(s.volume) ? clampVolume(s.volume) : DEFAULTS.volume,
    sounds,
    minTurnSeconds:
      typeof s.minTurnSeconds === 'number' && s.minTurnSeconds >= 0 ? Math.round(s.minTurnSeconds) : 0,
    quietHours: typeof s.quietHours === 'string' && parseQuietHours(s.quietHours) ? s.quietHours : '',
    isPlayingOverSsh: s.isPlayingOverSsh === true,
  }
}

/** `22:00-07:30` to minutes after midnight, or null when malformed. */
export function parseQuietHours(text: string): { from: number; to: number } | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(text)
  if (!m) return null
  const [h1 = 0, m1 = 0, h2 = 0, m2 = 0] = m.slice(1).map(Number)
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null
  return { from: h1 * 60 + m1, to: h2 * 60 + m2 }
}

/** Whether `date` (local time) falls inside the range; a range may wrap midnight. */
export function isInQuietHours(text: string, date: Date): boolean {
  const range = parseQuietHours(text)
  if (!range || range.from === range.to) return false
  const now = date.getHours() * 60 + date.getMinutes()
  return range.from < range.to
    ? now >= range.from && now < range.to
    : now >= range.from || now < range.to
}

/** `30`, `30m`, `2h`, `1h30m` to milliseconds, or null. A bare number is minutes. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase()
  if (/^\d+$/.test(t)) return Number(t) * 60_000
  const m = /^(?:(\d+)h)?\s*(?:(\d+)m(?:in)?)?$/.exec(t)
  if (!m || (!m[1] && !m[2])) return null
  return (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60_000
}

export function describeDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
