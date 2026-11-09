import { expect, test } from 'claude-code/testing'

import type { Ring } from '../types'
import { DEAD, LIVE, OLD, beneath, fakeClaude } from './fake'

test('on macOS and Linux the rings come from HOME, ps and tail', async ($, on) => {
  const cwd = '/Users/maya/code/app'
  const files = fakeClaude('/Users/maya/.claude', cwd)
  const env = { HOME: '/Users/maya' }
  const { ran, clock, state } = beneath(on, files, env, false)

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  const rings = state.get('rings') as Ring[]

  const live = rings.find(r => r.id === LIVE)!
  expect(live.name).toBe('Fix login')
  expect(live.cwd).toBe(cwd)
  expect(live.tokens).toBe(620000)
  expect(live.isLive).toBe(true)
  expect(live.isCurrent).toBe(true)
  expect(live.subs).toEqual([{ id: 'explore1', name: 'Explore codebase', tokens: 400000 }])
  // Its process is gone from ps, but its last message is recent: it shows, dimmed.
  const dead = rings.find(r => r.id === DEAD)!
  expect(dead.isLive).toBe(false)
  expect(dead.tokens).toBe(210000)
  expect(rings.some(r => r.id === OLD)).toBe(false)

  const exes = ran.map(a => a[0])
  expect(exes.includes('/bin/ps')).toBe(true)
  expect(exes.includes('/usr/bin/tail')).toBe(true)
})
