# Chime for Claude Code

Chime plays a sound when Claude Code finishes a turn, stops to wait for you, or hits an error. Start a long task, switch to another window, and come back when you hear it.

- **Ten original sounds** (ta-da, coin, level up, doorbell, microwave, boing, rubber duck, robot, slide whistle, sad trombone), synthesized from scratch and free to use (CC0).
- **Your own sound files** for any event.
- **A picker pane** to try each sound and keep it, plus a `/chime` command for everything else.
- **Volume, snooze, quiet hours**, and a minimum turn length so quick replies stay silent.
- **Windows, macOS and Linux**, with nothing to install beyond Claude Code.

## Install

Chime is a Claude Code **mod**: a plugin built on function hooks. In Claude Code, run:

```
/plugin marketplace add oguz-hd/claude-code-chime
/plugin install chime@claude-code-chime
```

Restart Claude Code. Type `/chime test` to hear the current sounds.

> Mods use Claude Code's function hooks, which are in early access and may change between releases. If `/chime` is not listed after a restart, update Claude Code (`claude update`) and check `/plugin` for an error next to Chime.

## When it plays

| Event | Default sound | Plays when |
| --- | --- | --- |
| Done | Ta-da | Claude finishes and hands the turn back to you |
| Waiting | Doorbell | Claude needs a permission, asks you a question (AskUserQuestion), or wants a plan approved |
| Error | Sad trombone | The turn ends on an API error, such as a rate limit or an overloaded server |
| Idle | off | The prompt has sat unanswered for a while (Claude Code's idle reminder) |

Chime stays silent:

- after a turn that a Stop hook sent back to work (it waits for the real end of the turn);
- for subagents (only the main conversation counts);
- in non-interactive runs (`claude -p`, the SDK);
- in sessions reached over SSH, where the sound would play on the remote machine (turn it on with `/chime ssh on`);
- while snoozed, during quiet hours, or when turned off;
- when two events arrive within 1.5 seconds of each other, which plays one sound instead of two.

## Changing sounds

Type `/chime` to open the picker. It works from the keyboard like Claude Code's own menus:

| Key | Does |
| --- | --- |
| ↑ ↓ | move between rows |
| Enter | open a row, or keep the highlighted choice |
| 1–9, 0 | jump straight to a numbered row |
| b | back to the main screen |
| Esc | close the picker |

In a sound list, resting on a sound plays it, so you can browse by ear and press Enter on the one you like. The volume list does the same at each level.

```
Chime
Sounds for when Claude finishes or needs you.

1: Done      Ta-da
2: Waiting   Doorbell
3: Error     Sad trombone
4: Idle      off
5: Volume    60
6: Chime     on
7: Snooze    off
8: Test      play every sound

↑↓ move · Enter open · 1-8 jump · Esc close · /chime help for more
```

Or use the command directly:

```
/chime done coin                  bundled sound
/chime waiting ~/sounds/ping.wav  your own file
/chime error off                  silence one event
/chime volume 40                  0-100
/chime snooze 45m                 also 2h, 1h30m, off
/chime quiet 22:00-08:00          no sounds at night (local time); off to clear
/chime min 20                     "done" only after turns of 20 s or more
/chime test                       play every event's sound
/chime status                     show the settings
/chime help                       everything else
```

Settings are kept per user across sessions and projects.

### Your own sounds

Give an absolute path or one starting with `~/`.

- **Windows** plays `.wav` files only (8-, 16-, 24- or 32-bit PCM, or 32-bit float).
- **macOS** plays anything `afplay` does: `.wav`, `.mp3`, `.m4a`, `.aiff` and more.
- **Linux** plays what your player supports; `.wav` works everywhere.

Short sounds (under two seconds) work best.

## How it plays sound

| Platform | Player | Volume |
| --- | --- | --- |
| Windows | PowerShell and `System.Media.SoundPlayer`, part of every Windows | Chime scales the samples itself and caches the result in `%TEMP%\claude-chime` |
| macOS | `afplay` | `afplay -v` |
| Linux | the first that works of `pw-play`, `paplay`, `ffplay`, `aplay` | the player's own volume flag (`aplay` has none) |
| WSL | the Linux players (WSLg provides PulseAudio), else Windows through `powershell.exe` | as above |

If no player works, Chime shows the reason once as a notice and keeps quiet.

## Troubleshooting

- **No sound and no notice.** Check `/chime status`: Chime may be off, snoozed, in quiet hours or in an SSH session. Then run `/chime test`.
- **"no working audio player" on Linux.** Install PipeWire (`pw-play`) or PulseAudio utilities (`paplay`), for example `sudo apt install pulseaudio-utils`.
- **"Windows plays .wav files only".** Convert the file, for example `ffmpeg -i ping.mp3 ping.wav`.
- **Sounds play twice.** You probably still have a `Stop` or `Notification` sound hook in `~/.claude/settings.json` from an earlier setup. Remove it; Chime covers both.
- **Every quick reply chimes.** Use `/chime min 15` so only longer turns play the done sound.

## Development

```
plugins/chime/
  .claude-plugin/plugin.json   manifest
  hooks/hooks.json             names the hooks module
  hooks/register.tsx           hooks, /chime command, picker pane, players
  hooks/settings.ts            sound catalog, defaults, parsing
  hooks/wav.ts                 WAV scaling and other pure helpers
  types/index.d.ts             the plugin's state contract
  sounds/*.wav                 the bundled sounds
tools/render_sounds.py         renders sounds/*.wav (numpy)
```

Load your working copy into one session with `claude --plugin-dir plugins/chime`, or let Claude Code hot-reload it as a mod.

Check your changes:

```
claude plugin validate plugins/chime   # what the engine will load and refuse
claude plugin validate .               # the marketplace manifest
```

To type-check, run `/plugin-types plugins/chime/.claude/types` in Claude Code once, then `npx -p typescript tsc -p plugins/chime`.

To change or add a sound, edit `tools/render_sounds.py`, then `pip install numpy && python tools/render_sounds.py`. Add the new id to `BUNDLED` in `hooks/settings.ts`.

## License

Code: MIT. Sounds: CC0 1.0 (public domain). See [LICENSE](LICENSE).
