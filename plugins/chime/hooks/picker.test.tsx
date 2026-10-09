import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The picker as a terminal pane draws it, docked or inline.
const PANE = {
  plugin: 'chime',
  component: 'Pane',
  requestId: 'chime',
  props: { title: 'Chime', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: undefined } as never,
} as const

/** Clock, store and environment from memory; no sound plays in a test. */
function world(on: On) {
  mock.clock(on, { now: new Date(2026, 9, 9, 15, 0).getTime() })
  mock.store(on)
  mock.env(on, {})
}

describe('picker', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`walks main → sound list → back on ${surface}`, async ($, on) => {
      world(on)
      const ui = await $.ui.mount({ ...PANE, surface })

      // Main screen: one row per setting, each reachable by key.
      for (const key of ['event:done', 'event:waiting', 'event:error', 'event:idle', 'open:volume', 'toggle', 'open:snooze', 'test']) {
        expect(await ui.find({ key })).toBeDefined()
      }

      // Enter on "Done" opens its sound list, with the current sound marked.
      await ui.press({ key: 'event:done' })
      expect(await ui.find({ key: 'sound:coin' })).toBeDefined()
      expect((await ui.find({ key: 'sound:tada' }))?.text).toContain('✓')

      // Picking a sound keeps it and returns to the main screen.
      await ui.press({ key: 'sound:coin' })
      expect(await ui.find({ key: 'event:done' })).toBeDefined()
      expect((await ui.find({ key: 'event:done' }))?.text).toContain('Coin')

      // Back from a list changes nothing.
      await ui.press({ key: 'event:waiting' })
      await ui.press({ key: 'back' })
      expect((await ui.find({ key: 'event:waiting' }))?.text).toContain('Doorbell')

      await ui.unmount()
    })
  }

  test('volume and snooze screens', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'open:volume' })
    expect(await ui.find({ key: 'vol:10' })).toBeDefined()
    expect(await ui.find({ key: 'vol:100' })).toBeDefined()
    await ui.press({ key: 'vol:30' })
    expect((await ui.find({ key: 'open:volume' }))?.text).toContain('30')

    await ui.press({ key: 'open:snooze' })
    await ui.press({ key: 'snooze:60' })
    expect((await ui.find({ key: 'open:snooze' }))?.text).toContain('until')
    await ui.unmount()
  })
})
