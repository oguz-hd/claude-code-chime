/** A moment Chime can announce. */
export type ChimeEvent = 'done' | 'waiting' | 'error' | 'idle'

/**
 * What plays for one event: a bundled sound's id (`tada`), `off`, or the
 * absolute path of an audio file of the user's own.
 */
export type ChimeSound = string

export type ChimeSettings = {
  /** Master switch. */
  isEnabled: boolean
  /** 0 to 100. */
  volume: number
  sounds: Record<ChimeEvent, ChimeSound>
  /** The done sound plays only for turns at least this long (0 = always). */
  minTurnSeconds: number
  /** `HH:MM-HH:MM` in local time, or empty for none. */
  quietHours: string
  /** Whether to play in a session reached over SSH (the sound plays on the remote machine). */
  isPlayingOverSsh: boolean
}

declare module 'claude-code' {
  interface PluginState {
    chime: {
      settings: ChimeSettings
      /** The picker's screen: `main`, an event's sound list, `volume` or `snooze`. */
      screen: string
      /** Epoch ms until which Chime stays silent; 0 when not snoozed. */
      snoozeUntil: number
    }
  }
}
