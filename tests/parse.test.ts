import { expect, test } from 'claude-code/testing'

import { cacheInfo, cacheToast, cacheWarning, capRings, fmt, folderOrder, lastContextTokens, lastMessageAt, level, parseContextShow, parsePct, parseSize, parseStat, parseWait, ringLabel, ringSvg, ringsSvg, shortName, splitTail, subLabel } from '../hooks/parse'

const SID = '0123abcd-0123-4567-89ab-0123456789ab'

test('sizes read and print in K and M', async () => {
  expect(parseSize('300K', 0)).toBe(300000)
  expect(parseSize('1M', 0)).toBe(1000000)
  expect(parseSize('nope', 5)).toBe(5)
  expect(fmt(340000)).toBe('340K')
  expect(fmt(1000000)).toBe('1M')
})

test('stat lines sort into main and subagent transcripts', async () => {
  const rows = parseStat(`1700000000 /h/.claude/projects/-a/${SID}.jsonl\n1700000001 /h/.claude/projects/-a/${SID}/subagents/agent-abc123.jsonl\n`)
  expect(rows.length).toBe(2)
  expect(rows[0]!.kind).toBe('main')
  expect(rows[1]!.kind).toBe('sub')
  expect(rows[1]!.mtime).toBe(1700000001000)
})

test('the last assistant usage gives the context', async () => {
  const usage = (n: number) => JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 2, cache_creation_input_tokens: n, cache_read_input_tokens: 1000 } } })
  const text = `cut-off partial row"usage"assistant\n${usage(10)}\n${usage(500)}\n{"type":"user"}\n`
  expect(lastContextTokens(text)).toBe(1502)
  expect(lastContextTokens('{"type":"user"}')).toBeUndefined()
})

test('tail output splits per file', async () => {
  const map = splitTail('==> /a <==\nA1\n\n==> /b <==\nB1\n', ['/a', '/b'])
  expect(map.get('/a')!.includes('A1')).toBe(true)
  expect(map.get('/b')!.includes('B1')).toBe(true)
  expect(splitTail('only', ['/x']).get('/x')).toBe('only')
})

test('a ring draws and its labels read', async () => {
  const main = { limit: 1000000, yellow: 50, red: 80 }
  const sub = { limit: 500000, yellow: 50, red: 80 }
  const ring = { id: SID, name: 'A <b>', cwd: '/x/proj', tokens: 620000, isLive: true, isBusy: false, isCurrent: true, lastAt: 0, subs: [{ id: 's', name: 'Explore codebase', tokens: 410000 }], cacheTtl: 3600000, cacheAt: 1, cache: 'warm' as const, cacheWarnAt: 0, cacheArc: 0 }
  expect(ringSvg(ring, main, sub).source.includes('<circle')).toBe(true)
  // By default: name and cache only; no folder, state, "this session" or subagents.
  expect(ringLabel(ring, main, 1 + 53 * 60000)).toBe('A <b> · 1hr, 7m left')
  expect(ringLabel(ring, main, 61 * 60000)).toBe('A <b> · 1hr, expired')
  expect(ringLabel(ring, main, 1, parseContextShow('Tokens'))).toBe('A <b> · 620K · 1hr, 60m left')
  expect(ringLabel(ring, main, 1, parseContextShow('Tokens and %')).includes('620K (62%)')).toBe(true)
  expect(ringLabel(ring, main, 1, parseContextShow('Tokens, limit and %')).includes('620K of 1M (62%)')).toBe(true)
  expect(ringLabel({ ...ring, cache: 'none' as const }, main, 0)).toBe('A <b>')
  expect(shortName('x'.repeat(50))).toBe(`${'x'.repeat(40)}…`)
  expect(subLabel(ring.subs[0]!, sub)).toBe('Explore codebase · 410K of 500K (82%)')
  // Each subagent dot is its own hover target, with its own label.
  const all = ringsSvg([ring], main, sub, 0).source
  expect(all.includes('Explore codebase · 410K of 500K (82%)')).toBe(true)
  expect((all.match(/class="r"/g) ?? []).length).toBe(2)
})

test('levels follow each scale', async () => {
  const s = { limit: 200000, yellow: 50, red: 80 }
  expect(level(49, s)).toBe('ok')
  expect(level(50, s)).toBe('warn')
  expect(level(80, s)).toBe('bad')
  expect(parsePct('75%', 0)).toBe(75)
  expect(parsePct('x', 9)).toBe(9)
})

test('a compaction after the last response counts as its postTokens', async () => {
  const usage = JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 880000 } } })
  const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 883090, postTokens: 12746 } })
  expect(lastContextTokens(`${usage}\n${boundary}\n{"type":"user"}\n`)).toBe(12746)
  expect(lastContextTokens(`${boundary}\n${usage}\n`)).toBe(880001)
})

test('past ten rings the rest fold into +N, keeping this session', async () => {
  const ring = (i: number, isCurrent = false) => ({ id: `id-${i}`, name: `s${i}`, cwd: '/x', tokens: 0, isLive: true, isBusy: false, isCurrent, lastAt: 0, subs: [], cacheTtl: 0, cacheAt: 0, cache: 'none' as const, cacheWarnAt: 0, cacheArc: 0 })
  const many = Array.from({ length: 14 }, (_, i) => ring(i, i === 12))
  const { shown, hidden } = capRings(many)
  expect(shown.length).toBe(10)
  expect(hidden.length).toBe(4)
  expect(shown[9]!.name).toBe('s12')
  expect(hidden.some(r => r.name === 's9')).toBe(true)
  expect(capRings(many.slice(0, 10)).hidden.length).toBe(0)
  const scale = { limit: 1000000, yellow: 50, red: 80 }
  const { source } = ringsSvg(shown, scale, scale, 0, hidden)
  expect(source.includes('>+4<')).toBe(true)
  expect(source.includes('4 more: ')).toBe(true)
})

test('activity is the last message, not rows the app adds on opening', async () => {
  const msg = (type: string, at: string) => JSON.stringify({ type, timestamp: at, message: { role: type } })
  const text = `${msg('user', '2026-08-06T03:32:15.584Z')}\n${msg('assistant', '2026-08-06T03:32:24.807Z')}\n{"type":"last-prompt"}\n{"type":"mode"}\n`
  expect(lastMessageAt(text)).toBe(Date.parse('2026-08-06T03:32:24.807Z'))
  expect(lastMessageAt('{"type":"mode"}\n')).toBeUndefined()
})

test('the cache lifetime comes from the last reply that wrote it', async () => {
  const reply = (at: string, h1: number, m5: number) =>
    JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', usage: { input_tokens: 1, cache_creation: { ephemeral_1h_input_tokens: h1, ephemeral_5m_input_tokens: m5 } } } })
  const info = cacheInfo(`${reply('2026-10-23T10:00:00Z', 500, 0)}\n${reply('2026-10-23T10:05:00Z', 0, 0)}\n{"type":"mode"}\n`)
  expect(info.ttl).toBe(3600000)
  expect(info.at).toBe(Date.parse('2026-10-23T10:05:00Z'))
  expect(cacheInfo(reply('2026-10-23T10:00:00Z', 0, 9)).ttl).toBe(300000)
  expect(cacheInfo('{"type":"user"}').ttl).toBeUndefined()

  expect(parseWait('10m', 0)).toBe(600000)
  expect(parseWait('Off', 5)).toBe(0)
  expect(parseWait('30s', 5)).toBe(30000)
})

test('the cache warning starts in its window, only for big sessions, with a shrinking arc', async () => {
  const M = 60000
  const warn = { hour: 10 * M, fiveMin: M, minTokens: 500000 }
  const big = 600000
  expect(cacheWarning(3600000, 1, big, warn, 49 * M).cache).toBe('warm')
  const w = cacheWarning(3600000, 1, big, warn, 1 + 55 * M)
  expect(w.cache).toBe('warn')
  expect(w.warnAt).toBe(1 + 50 * M)
  expect(w.arc).toBe(0.5)
  expect(cacheWarning(3600000, 1, 100000, warn, 55 * M).cache).toBe('warm')
  expect(cacheWarning(3600000, 1, big, warn, 61 * M).cache).toBe('cold')
  expect(cacheWarning(300000, 1, big, warn, 4.5 * M).cache).toBe('warn')
  expect(cacheWarning(3600000, 1, big, { ...warn, hour: 0 }, 59 * M).cache).toBe('warm')
  expect(cacheWarning(0, 1, big, warn, 0).cache).toBe('none')

  const ring = { id: SID, name: 'big job', cwd: '/x/proj', tokens: big, isLive: true, isBusy: false, isCurrent: false, lastAt: 0, subs: [], cacheTtl: 3600000, cacheAt: 1, cache: w.cache, cacheWarnAt: w.warnAt, cacheArc: w.arc }
  expect(cacheToast(ring, 1 + 55 * M).includes('big job · proj: its 1h cache of 600K expires in 5m')).toBe(true)
  const scale = { limit: 1000000, yellow: 50, red: 80 }
  // Inside the first 10 seconds it pulses; after, only the arc remains.
  expect(ringSvg(ring, scale, scale, w.warnAt + 3000).source.includes('repeatCount="7"')).toBe(true)
  const later = ringSvg(ring, scale, scale, w.warnAt + 60000).source
  expect(later.includes('attributeName="opacity"')).toBe(false)
  expect(later.includes('#f0883e')).toBe(true)
})

test('the chip goes this folder, All, then the other folders A to Z', async () => {
  const ring = (cwd: string, isCurrent = false) => ({ id: cwd, name: cwd, cwd, tokens: 0, isLive: true, isBusy: false, isCurrent, lastAt: 0, subs: [], cacheTtl: 0, cacheAt: 0, cache: 'none' as const, cacheWarnAt: 0, cacheArc: 0 })
  const rings = [ring('/w/zeta'), ring('/w/mid', true), ring('/w/alpha'), ring('/w/zeta'), ring('/w/Beta')]
  expect(folderOrder(rings, '*')).toEqual(['/w/mid', '*', '/w/alpha', '/w/Beta', '/w/zeta'])
  expect(folderOrder([ring('/w/b'), ring('/w/a')], '*')).toEqual(['*', '/w/a', '/w/b'])
})
