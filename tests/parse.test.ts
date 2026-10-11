import { expect, test } from 'claude-code/testing'

import { fmt, lastContextTokens, level, parsePct, parseSize, parseStat, ringLabel, ringSvg, splitTail } from '../hooks/parse'

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

test('a ring draws and its label reads', async () => {
  const ring = { id: SID, name: 'A <b>', cwd: '/x/proj', tokens: 500000, isLive: true, isBusy: false, isCurrent: true, lastAt: 0, subs: [{ id: 's', name: 'sub', tokens: 200000 }] }
  const { source } = ringSvg(ring, { limit: 1000000, yellow: 50, red: 80 }, { limit: 200000, yellow: 50, red: 80 })
  const label = ringLabel(ring, { limit: 1000000, yellow: 50, red: 80 }, 0)
  expect(source.includes('<circle')).toBe(true)
  expect(label.includes('A <b> · proj · 500K of 1M (50%)')).toBe(true)
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
