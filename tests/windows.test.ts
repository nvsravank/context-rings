import { expect, test } from 'claude-code/testing'

import type { Ring } from '../types'
import { DEAD, LIVE, OLD, beneath, fakeClaude } from './fake'

test('on Windows the rings come from USERPROFILE, tasklist and PowerShell', async ($, on) => {
  const cwd = 'C:\\code\\app'
  const files = fakeClaude('C:/Users/maya/.claude', cwd)
  const env = { OS: 'Windows_NT', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\maya', HOME: '/c/Users/maya' }
  const { ran, clock, state } = beneath(on, files, env, true)

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
  // Its process is gone from tasklist, but its last message is recent: it shows, dimmed.
  const dead = rings.find(r => r.id === DEAD)!
  expect(dead.isLive).toBe(false)
  expect(dead.tokens).toBe(210000)
  expect(rings.some(r => r.id === OLD)).toBe(false)

  const exes = ran.map(a => a[0]!.split('\\').pop())
  expect(exes.includes('tasklist.exe')).toBe(true)
  expect(exes.includes('powershell.exe')).toBe(true)
})
