import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ChimeEvent, ChimeSettings, ChimeSound } from '../types'
import {
  BUNDLED,
  DEFAULTS,
  EVENTS,
  EVENT_INFO,
  clampVolume,
  describeDuration,
  isBundled,
  isFilePath,
  isInQuietHours,
  normalize,
  parseDuration,
  parseQuietHours,
  soundLabel,
} from './settings'
import { POWERSHELL, PS_PLAY, PS_WRITE_AND_PLAY, fnv1a, fromBase64, posixPlayers, scaleWav, toBase64 } from './wav'

type Engine = EngineInterface
type Platform = 'windows' | 'mac' | 'linux' | 'wsl'
type PlayResult = { isPlayed: true } | { isPlayed: false; reason: string }

const PANE = 'chime'
const COMMAND = 'chime'
/** Two announcements closer than this are one: a permission prompt can raise
 *  both a tool hook and a Notification, and a turn can end with both. */
const DEBOUNCE_MS = 1500

const settingsAtom = atom({ plugin: 'chime', key: 'settings' } as const, DEFAULTS)
const snoozeAtom = atom({ plugin: 'chime', key: 'snoozeUntil' } as const, 0)
/** The picker's screen: `main`, an event's sound list, `volume` or `snooze`. */
const screenAtom = atom({ plugin: 'chime', key: 'screen' } as const, 'main')

const VOLUME_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const
/** How long the ring must rest on a sound before it plays, so arrowing past is quiet. */
const PREVIEW_DELAY_MS = 250

// Module state: a hot reload resets these, which is harmless.
let isInteractive = true
let turnStartedAt = 0
let lastPlayedAt = 0
const reportedFailures = new Set<string>()
let previewTimer: Timer | undefined
let lastPreview = { sound: '', volume: -1, at: 0 }

// ------------------------------------------------------------------ settings

async function saveSettings($: Engine, change: (s: ChimeSettings) => ChimeSettings): Promise<ChimeSettings> {
  const next = await update($, settingsAtom, s => normalize(change(s)))
  await $.store.set('settings', next)
  await refreshStatus($)
  return next
}

async function setSnooze($: Engine, until: number): Promise<void> {
  await update($, snoozeAtom, () => until)
  await $.store.set('snoozeUntil', until)
  await refreshStatus($)
  if (until > 0) {
    const left = until - (await $.clock.now())
    if (left > 0) $.clock.after(left + 500, () => void refreshStatus($))
  }
}

const clockTime = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** The status line says something only when Chime is not simply on. */
async function refreshStatus($: Engine): Promise<void> {
  const s = await read($, settingsAtom)
  const snoozeUntil = await read($, snoozeAtom)
  const now = await $.clock.now()
  if (!s.isEnabled) $.ui.status('chime off')
  else if (snoozeUntil > now) $.ui.status(`chime snoozed until ${clockTime(snoozeUntil)}`)
  else if (isInQuietHours(s.quietHours, new Date(now))) $.ui.status('chime quiet hours')
  else $.ui.status(undefined)
}

// ------------------------------------------------------------------ playing

/** Plays the sound set for `event`, unless something says to stay silent. */
async function announce($: Engine, event: ChimeEvent): Promise<void> {
  const s = await read($, settingsAtom)
  const now = await $.clock.now()
  if (!isInteractive || !s.isEnabled) return
  if ((await read($, snoozeAtom)) > now) return
  if (isInQuietHours(s.quietHours, new Date(now))) return
  if (now - lastPlayedAt < DEBOUNCE_MS) return
  if (!s.isPlayingOverSsh && (await isOverSsh($))) return
  lastPlayedAt = now
  await playSound($, s.sounds[event], s.volume)
}

async function playSound($: Engine, sound: string, volume: number): Promise<void> {
  const path = await resolveSound($, sound)
  if (!path) return
  const result = await play($, path, volume)
  if (!result.isPlayed && !reportedFailures.has(result.reason)) {
    reportedFailures.add(result.reason)
    $.ui.toast(`Chime could not play a sound: ${result.reason}`)
  }
}

/** Fire and forget: a hook never waits for a sound to finish. */
const later = (work: Promise<unknown>) => void work.catch(() => undefined)

// ------------------------------------------------------------------ platform and players

let platform: Promise<Platform> | undefined

function detectPlatform($: Engine): Promise<Platform> {
  platform ??= (async (): Promise<Platform> => {
    if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
    if ((await $.env.get('WSL_DISTRO_NAME')) !== undefined) return 'wsl'
    if (await $.fs.exists('/usr/bin/afplay')) return 'mac'
    return 'linux'
  })()
  return platform
}

/** True when the session was reached over SSH, so a sound would play on the remote machine. */
async function isOverSsh($: Engine): Promise<boolean> {
  return (
    (await $.env.get('SSH_CONNECTION')) !== undefined ||
    (await $.env.get('SSH_TTY')) !== undefined ||
    (await $.env.get('SSH_CLIENT')) !== undefined
  )
}

async function homeDir($: Engine): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
}

async function tempDir($: Engine): Promise<string> {
  return (await $.env.get('TEMP')) ?? (await $.env.get('TMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
}

/** The file a sound setting points at, or null for `off`. */
async function resolveSound($: Engine, sound: ChimeSound): Promise<string | null> {
  if (sound === 'off') return null
  if (isBundled(sound)) return `${$.plugin.root}/sounds/${sound}.wav`
  if (/^~[\\/]/.test(sound)) return `${await homeDir($)}${sound.slice(1)}`
  return sound
}


/**
 * Plays `path` at `volume` (0-100) and resolves once the sound has finished.
 * Never rejects: a failure comes back as `{ isPlayed: false, reason }`.
 */
async function play($: Engine, path: string, volume: number): Promise<PlayResult> {
  const gain = Math.min(1, Math.max(0, volume / 100))
  if (gain === 0) return { isPlayed: true }
  try {
    if (!(await $.fs.exists(path))) return { isPlayed: false, reason: `sound file not found: ${path}` }
    switch (await detectPlatform($)) {
      case 'windows':
        return await playOnWindows($, path, gain)
      case 'mac':
        return await runPlayer($, ['afplay', '-v', gain.toFixed(2), path])
      case 'linux':
        return await playOnPosix($, path, gain)
      case 'wsl': {
        const posix = await playOnPosix($, path, gain)
        return posix.isPlayed ? posix : await playOnWindowsFromWsl($, path)
      }
    }
  } catch (error) {
    return { isPlayed: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

async function runPlayer($: Engine, argv: string[], stdin?: string): Promise<PlayResult> {
  const { exitCode, stderr } = await $.process.run(argv, { stdin, timeoutMs: 20_000 })
  if (exitCode === 0) return { isPlayed: true }
  const detail = stderr.trim().split(/\r?\n/)[0] ?? ''
  return { isPlayed: false, reason: `${argv[0]} exited with ${exitCode}${detail ? `: ${detail}` : ''}` }
}

async function playOnWindows($: Engine, path: string, gain: number): Promise<PlayResult> {
  if (!/\.wav$/i.test(path)) {
    return { isPlayed: false, reason: `Windows plays .wav files only; convert ${path} to .wav` }
  }
  if (gain >= 0.999) return runPlayer($, [...POWERSHELL, PS_PLAY, path])

  const stat = await $.fs.stat(path)
  const key = fnv1a(`${path}|${stat.size}|${stat.mtimeMs}|${gain.toFixed(3)}`)
  const cached = `${await tempDir($)}\\claude-chime\\${key}.wav`
  if (await $.fs.exists(cached)) return runPlayer($, [...POWERSHELL, PS_PLAY, cached])

  const { base64 } = await $.fs.read(path, { as: 'bytes' })
  const scaled = scaleWav(fromBase64(base64), gain)
  if (!scaled) return runPlayer($, [...POWERSHELL, PS_PLAY, path]) // a WAV encoding we cannot scale
  return runPlayer($, [...POWERSHELL, PS_WRITE_AND_PLAY, cached], toBase64(scaled))
}

let posixPlayer: number | undefined

async function playOnPosix($: Engine, path: string, gain: number): Promise<PlayResult> {
  const players = posixPlayers(path, gain)
  const order = posixPlayer === undefined ? players.map((_, i) => i) : [posixPlayer]
  const failures: string[] = []
  for (const i of order) {
    const argv = players[i]
    if (!argv) continue
    try {
      const result = await runPlayer($, argv)
      if (result.isPlayed) {
        posixPlayer = i
        return result
      }
      failures.push(result.reason)
    } catch {
      failures.push(`${argv[0]} not found`)
    }
  }
  if (posixPlayer !== undefined) {
    posixPlayer = undefined // the remembered player broke; search again next time
    return playOnPosix($, path, gain)
  }
  return {
    isPlayed: false,
    reason: `no working audio player (tried pw-play, paplay, ffplay, aplay): ${failures.join('; ')}`,
  }
}

async function playOnWindowsFromWsl($: Engine, path: string): Promise<PlayResult> {
  if (!/\.wav$/i.test(path)) return { isPlayed: false, reason: 'no Linux audio player, and Windows plays .wav only' }
  const { exitCode, stdout } = await $.process.run(['wslpath', '-w', path])
  if (exitCode !== 0) return { isPlayed: false, reason: 'wslpath could not translate the sound path' }
  return runPlayer($, [...POWERSHELL, PS_PLAY, stdout.trim()])
}

// ------------------------------------------------------------------ picker helpers

const pad = (text: string, width: number) => (text.length >= width ? `${text} ` : text.padEnd(width))

const nearestStep = (volume: number) => Math.min(100, Math.max(10, Math.round(volume / 10) * 10))

/** The ring's landing key in a sound list, for the sound an event has now. */
const focusKeyForSound = (sound: string) =>
  sound === 'off' ? 'sound:off' : isBundled(sound) ? `sound:${sound}` : `sound:${BUNDLED[0]?.id ?? 'tada'}`

/** What the volume screen plays: the done sound, or the first event's that is not silent. */
function previewSoundFor(s: ChimeSettings): string {
  const sound = [s.sounds.done, s.sounds.waiting, s.sounds.error, s.sounds.idle].find(x => x !== 'off')
  return sound ?? 'tada'
}

function cancelPreview(): void {
  previewTimer?.cancel()
  previewTimer = undefined
}

function schedulePreview($: Engine, key: string): void {
  cancelPreview()
  previewTimer = $.clock.after(PREVIEW_DELAY_MS, () => later(runPreview($, key)))
}

async function runPreview($: Engine, key: string): Promise<void> {
  const s = await read($, settingsAtom)
  let sound: string
  let volume = s.volume
  if (key.startsWith('sound:')) sound = key.slice('sound:'.length)
  else if (key.startsWith('vol:')) {
    sound = previewSoundFor(s)
    volume = Number(key.slice('vol:'.length))
  } else return
  if (sound === 'off') return
  lastPreview = { sound, volume, at: Date.now() }
  await playSound($, sound, volume)
}

/** True when the browse preview just played this, so Enter need not play it again. */
const wasJustPreviewed = (sound: string, volume: number) =>
  lastPreview.sound === sound && lastPreview.volume === volume && Date.now() - lastPreview.at < 3000

async function testSounds($: Engine, only?: ChimeEvent): Promise<void> {
  const s = await read($, settingsAtom)
  for (const event of only ? [only] : EVENTS) {
    if (s.sounds[event] === 'off') continue
    await playSound($, s.sounds[event], s.volume)
    await $.clock.sleep(400)
  }
}

// ------------------------------------------------------------------ hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    const stored = await $.store.get('settings')
    await update($, settingsAtom, () => normalize(stored))
    const snoozeUntil = Number((await $.store.get('snoozeUntil')) ?? 0)
    await update($, snoozeAtom, () => (Number.isFinite(snoozeUntil) ? snoozeUntil : 0))
    await $.command.register({
      name: COMMAND,
      description: 'Sounds for when Claude finishes or needs you: pick sounds, volume, snooze',
      argumentHint: '[status|test|volume N|done SOUND|on|off|snooze 1h|help]',
      immediate: true,
    })
    await refreshStatus($)
    return next(e)
  })

  // The turn's start, for the minimum-length rule. The earliest start since
  // the last stop counts, so a subagent's turn starting mid-way changes nothing.
  on('turn.start', async ($, e, next) => {
    if (turnStartedAt === 0) turnStartedAt = await $.clock.now()
    return next(e)
  })

  // Done: the main agent stopped and no Stop hook sent it back to work.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block !== undefined) return result

    const startedAt = turnStartedAt
    turnStartedAt = 0
    const s = await read($, settingsAtom)
    const seconds = startedAt ? ((await $.clock.now()) - startedAt) / 1000 : Infinity
    if (seconds >= s.minTurnSeconds) later(announce($, 'done'))
    return result
  })

  // Error: the turn ended on an API error instead of a reply.
  on('classic.StopFailure', async ($, e, next) => {
    turnStartedAt = 0
    later(announce($, 'error'))
    return next(e)
  })

  // Waiting / idle: Claude Code's own notifications.
  on('classic.Notification', async ($, e, next) => {
    const type = e.notification_type
    if (type === 'idle_prompt') later(announce($, 'idle'))
    else if (type !== 'auth_success') later(announce($, 'waiting'))
    return next(e)
  })

  // Waiting, also for the dialogs that raise no notification of their own.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    later(announce($, 'waiting'))
    return next(e)
  })
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    later(announce($, 'waiting'))
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const text = await runCommand($, e.args)
    return text ? { text } : {}
  })

  // Moving the ring onto a sound or a volume previews it, as a theme picker
  // previews themes: the person browses by ear and presses Enter to keep one.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny === undefined && e.origin.kind === 'person' && e.element) {
      schedulePreview($, e.element)
    }
    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, settingsAtom)
    const screen = await read($, screenAtom)
    const snoozeUntil = await read($, snoozeAtom)
    const now = await $.clock.now()
    const isSnoozed = snoozeUntil > now

    /** Switch screens and put the ring on `key` in the new one. */
    const go = (to: string, key: string) => async () => {
      cancelPreview()
      await update($, screenAtom, () => to)
      // Best effort: the ring cannot move while the pane does not hold the keys.
      await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
    }
    const footer = (keys: string) => (
      <Box marginTop={1}>
        <Text dimColor>{keys}</Text>
      </Box>
    )

    // ---- a sound list for one event
    if (EVENTS.includes(screen as ChimeEvent)) {
      const event = screen as ChimeEvent
      const current = s.sounds[event]
      const keep = (sound: string) => async () => {
        cancelPreview()
        await saveSettings($, x => ({ ...x, sounds: { ...x.sounds, [event]: sound } }))
        if (!wasJustPreviewed(sound, s.volume)) later(playSound($, sound, s.volume))
        await go('main', `event:${event}`)()
      }
      return (
        <Box flexDirection="column">
          <Text bold>{EVENT_INFO[event].label} sound</Text>
          <Text dimColor>Plays when {EVENT_INFO[event].when}.</Text>
          <Box flexDirection="column" marginTop={1}>
            {BUNDLED.map((sound, i) => (
              <Button
                key={`sound:${sound.id}`}
                plain
                hotkey={String((i + 1) % 10)}
                autoFocus={current === sound.id ? true : undefined}
                label={`${pad(sound.label + (current === sound.id ? ' ✓' : ''), 16)}${sound.note}`}
                onPress={keep(sound.id)}
              />
            ))}
            <Button
              key="sound:off"
              plain
              hotkey="s"
              label={`${pad('Silent' + (current === 'off' ? ' ✓' : ''), 16)}no sound for this event`}
              onPress={keep('off')}
            />
          </Box>
          {isFilePath(current) && (
            <Box marginTop={1}>
              <Text>Using your file: {current}</Text>
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            <Button key="back" plain hotkey="b" label="Back" onPress={go('main', `event:${event}`)} />
          </Box>
          {footer(`↑↓ listen · Enter keep · b back · Esc close · own file: /chime ${event} ~/sound.wav`)}
        </Box>
      )
    }

    // ---- volume
    if (screen === 'volume') {
      const keep = (volume: number) => async () => {
        cancelPreview()
        const saved = await saveSettings($, x => ({ ...x, volume }))
        const sample = previewSoundFor(saved)
        if (!wasJustPreviewed(sample, volume)) later(playSound($, sample, volume))
        await go('main', 'open:volume')()
      }
      return (
        <Box flexDirection="column">
          <Text bold>Volume</Text>
          <Text dimColor>Move to hear each level; your done sound plays at it.</Text>
          <Box flexDirection="column" marginTop={1}>
            {VOLUME_STEPS.map((v, i) => (
              <Button
                key={`vol:${v}`}
                plain
                hotkey={String((i + 1) % 10)}
                autoFocus={nearestStep(s.volume) === v ? true : undefined}
                label={`${pad(String(v), 5)}${'█'.repeat(v / 10)}${'░'.repeat(10 - v / 10)}${s.volume === v ? '  ✓' : ''}`}
                onPress={keep(v)}
              />
            ))}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Button key="back" plain hotkey="b" label="Back" onPress={go('main', 'open:volume')} />
          </Box>
          {footer('↑↓ listen · Enter keep · b back · Esc close')}
        </Box>
      )
    }

    // ---- snooze
    if (screen === 'snooze') {
      const choose = (until: () => number) => async () => {
        await setSnooze($, until())
        await go('main', 'open:snooze')()
      }
      const tomorrowAt8 = () => {
        const d = new Date(now)
        d.setDate(d.getDate() + 1)
        d.setHours(8, 0, 0, 0)
        return d.getTime()
      }
      const options: { key: string; label: string; until: () => number }[] = [
        { key: 'snooze:15', label: 'For 15 minutes', until: () => now + 15 * 60_000 },
        { key: 'snooze:30', label: 'For 30 minutes', until: () => now + 30 * 60_000 },
        { key: 'snooze:60', label: 'For 1 hour', until: () => now + 60 * 60_000 },
        { key: 'snooze:120', label: 'For 2 hours', until: () => now + 120 * 60_000 },
        { key: 'snooze:tomorrow', label: 'Until tomorrow 08:00', until: tomorrowAt8 },
      ]
      return (
        <Box flexDirection="column">
          <Text bold>Snooze</Text>
          <Text dimColor>{isSnoozed ? `Silent until ${clockTime(snoozeUntil)}.` : 'Stay silent for a while.'}</Text>
          <Box flexDirection="column" marginTop={1}>
            {options.map((o, i) => (
              <Button
                key={o.key}
                plain
                hotkey={String(i + 1)}
                autoFocus={i === 2 ? true : undefined}
                label={o.label}
                onPress={choose(o.until)}
              />
            ))}
            {isSnoozed && <Button key="snooze:off" plain hotkey="w" label="Wake up now" onPress={choose(() => 0)} />}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Button key="back" plain hotkey="b" label="Back" onPress={go('main', 'open:snooze')} />
          </Box>
          {footer('↑↓ move · Enter choose · b back · Esc close')}
        </Box>
      )
    }

    // ---- main
    const notes: string[] = []
    if (s.quietHours) notes.push(`Quiet hours ${s.quietHours}`)
    if (s.minTurnSeconds) notes.push(`"Done" after turns of ${s.minTurnSeconds} s or more`)
    if (!s.isPlayingOverSsh && (await isOverSsh($))) notes.push('SSH session: silent (/chime ssh on)')
    return (
      <Box flexDirection="column">
        <Text bold>Chime</Text>
        <Text dimColor>Sounds for when Claude finishes or needs you.</Text>
        <Box flexDirection="column" marginTop={1}>
          {EVENTS.map((event, i) => (
            <Button
              key={`event:${event}`}
              plain
              hotkey={String(i + 1)}
              autoFocus={i === 0 ? true : undefined}
              label={`${pad(EVENT_INFO[event].label, 10)}${soundLabel(s.sounds[event])}`}
              onPress={go(event, focusKeyForSound(s.sounds[event]))}
            />
          ))}
          <Button
            key="open:volume"
            plain
            hotkey="5"
            label={`${pad('Volume', 10)}${s.volume}`}
            onPress={go('volume', `vol:${nearestStep(s.volume)}`)}
          />
          <Button
            key="toggle"
            plain
            hotkey="6"
            label={`${pad('Chime', 10)}${s.isEnabled ? 'on' : 'off'}`}
            onPress={() => saveSettings($, x => ({ ...x, isEnabled: !x.isEnabled }))}
          />
          <Button
            key="open:snooze"
            plain
            hotkey="7"
            label={`${pad('Snooze', 10)}${isSnoozed ? `until ${clockTime(snoozeUntil)}` : 'off'}`}
            onPress={go('snooze', 'snooze:60')}
          />
          <Button
            key="test"
            plain
            hotkey="8"
            label={`${pad('Test', 10)}play every sound`}
            onPress={() => later(testSounds($))}
          />
        </Box>
        {notes.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor>{notes.join(' · ')}</Text>
          </Box>
        )}
        {footer('↑↓ move · Enter open · 1-8 jump · Esc close · /chime help for more')}
      </Box>
    )
  })
}

// ------------------------------------------------------------------ /chime

const HELP = `Chime plays a sound when Claude finishes, needs you, or fails.

  /chime                      open the sound picker
  /chime status               show the settings
  /chime test [event]         play one event's sound, or all of them
  /chime list                 list the bundled sounds
  /chime play SOUND           preview a sound
  /chime EVENT SOUND          set a sound: EVENT is done, waiting, error or idle;
                              SOUND is a bundled name, off, or a file path
  /chime volume 0-100         set the volume
  /chime on | off             turn Chime on or off
  /chime snooze 30m | 2h | off   stay silent for a while
  /chime quiet 22:00-08:00 | off   no sounds during these hours (local time)
  /chime min SECONDS          only chime "done" after turns at least this long
  /chime ssh on | off         also play in sessions reached over SSH
  /chime reset                back to the defaults`

async function runCommand($: Engine, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const value = args.trim().slice(verb.length).trim()
  const word = verb.toLowerCase()

  if (word === '') {
    cancelPreview()
    await update($, screenAtom, () => 'main')
    await $.ui.open({ id: PANE, title: 'Chime', focus: true, closeOnEscape: true, holdToasts: true, rows: 18 })
    return ''
  }
  if (word === 'help') return HELP
  if (word === 'status') return statusText($)

  if (word === 'list') {
    return ['Bundled sounds:', ...BUNDLED.map(b => `  ${b.id.padEnd(14)} ${b.note}`), '  off            silence'].join('\n')
  }

  if (word === 'play') {
    if (!isBundled(value) && !isFilePath(value)) return `Unknown sound "${value}". Try /chime list.`
    const s = await read($, settingsAtom)
    later(playSound($, value, s.volume))
    return `Playing ${soundLabel(value)} at volume ${s.volume}.`
  }

  if (word === 'test') {
    const s = await read($, settingsAtom)
    const only = EVENTS.includes(value as ChimeEvent) ? (value as ChimeEvent) : undefined
    const events = only ? [only] : EVENTS
    later(testSounds($, only))
    return events.map(ev => `${EVENT_INFO[ev].label}: ${soundLabel(s.sounds[ev])}`).join(', ')
  }

  if (EVENTS.includes(word as ChimeEvent)) {
    const event = word as ChimeEvent
    if (!value) return `${EVENT_INFO[event].label} plays ${soundLabel((await read($, settingsAtom)).sounds[event])}.`
    const sound = isBundled(value.toLowerCase()) || value.toLowerCase() === 'off' ? value.toLowerCase() : value
    if (sound !== 'off' && !isBundled(sound)) {
      if (!isFilePath(sound)) return `Unknown sound "${value}". Use a name from /chime list, off, or an absolute file path.`
      const path = await resolveSound($, sound)
      if (!path || !(await $.fs.exists(path))) return `No file at ${sound}.`
    }
    const s = await saveSettings($, x => ({ ...x, sounds: { ...x.sounds, [event]: sound } }))
    later(playSound($, sound, s.volume))
    return `${EVENT_INFO[event].label} now plays ${soundLabel(sound)}.`
  }

  if (word === 'volume' || word === 'vol') {
    const n = Number(value)
    if (!value || !Number.isFinite(n)) return `Volume is ${(await read($, settingsAtom)).volume}. Set it with /chime volume 0-100.`
    const s = await saveSettings($, x => ({ ...x, volume: clampVolume(n) }))
    later(playSound($, s.sounds.done === 'off' ? 'tada' : s.sounds.done, s.volume))
    return `Volume set to ${s.volume}.`
  }

  if (word === 'on' || word === 'off') {
    await saveSettings($, x => ({ ...x, isEnabled: word === 'on' }))
    return word === 'on' ? 'Chime is on.' : 'Chime is off. Turn it back on with /chime on.'
  }

  if (word === 'snooze') {
    if (value === 'off' || value === '0') {
      await setSnooze($, 0)
      return 'Snooze cleared.'
    }
    const ms = parseDuration(value || '1h')
    if (!ms) return 'Give a duration such as 30m, 2h or 1h30m.'
    await setSnooze($, (await $.clock.now()) + ms)
    return `Snoozed for ${describeDuration(ms)}.`
  }

  if (word === 'quiet') {
    if (value === 'off' || value === '') {
      await saveSettings($, x => ({ ...x, quietHours: '' }))
      return 'Quiet hours cleared.'
    }
    if (!parseQuietHours(value)) return 'Give the hours as HH:MM-HH:MM, for example 22:00-08:00.'
    await saveSettings($, x => ({ ...x, quietHours: value.replace(/\s+/g, '') }))
    return `No sounds from ${value.replace(/\s+/g, '').replace('-', ' to ')} (local time).`
  }

  if (word === 'min') {
    const n = Number(value)
    if (!value || !Number.isFinite(n) || n < 0) return 'Give a number of seconds, for example /chime min 20 (0 = every turn).'
    const s = await saveSettings($, x => ({ ...x, minTurnSeconds: Math.round(n) }))
    return s.minTurnSeconds ? `"Done" now plays only after turns of ${s.minTurnSeconds} s or more.` : '"Done" plays after every turn.'
  }

  if (word === 'ssh') {
    if (value !== 'on' && value !== 'off') return 'Use /chime ssh on or /chime ssh off.'
    await saveSettings($, x => ({ ...x, isPlayingOverSsh: value === 'on' }))
    return value === 'on' ? 'Chime also plays in SSH sessions (on the remote machine).' : 'Chime stays silent in SSH sessions.'
  }

  if (word === 'reset') {
    await saveSettings($, () => DEFAULTS)
    await setSnooze($, 0)
    return 'Chime is back to its defaults.'
  }

  return `Unknown option "${verb}".\n\n${HELP}`
}

async function statusText($: Engine): Promise<string> {
  const s = await read($, settingsAtom)
  const snoozeUntil = await read($, snoozeAtom)
  const now = await $.clock.now()
  const lines = [
    `Chime is ${s.isEnabled ? 'on' : 'off'}, volume ${s.volume}.`,
    ...EVENTS.map(ev => `  ${EVENT_INFO[ev].label.padEnd(8)} ${soundLabel(s.sounds[ev])}`),
  ]
  if (snoozeUntil > now) lines.push(`Snoozed until ${clockTime(snoozeUntil)}.`)
  if (s.quietHours) lines.push(`Quiet hours: ${s.quietHours}.`)
  if (s.minTurnSeconds) lines.push(`"Done" only after turns of ${s.minTurnSeconds} s or more.`)
  if (await isOverSsh($)) lines.push(s.isPlayingOverSsh ? 'SSH session: playing on the remote machine.' : 'SSH session: silent (/chime ssh on to change).')
  if (!isInteractive) lines.push('Not an interactive session: silent.')
  return lines.join('\n')
}
