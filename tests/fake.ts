// A fake Claude Code folder beneath the mod: its files, its processes and its
// environment, so a test runs the real register.tsx as macOS, Linux or Windows
// would, and records every command the mod ran.

import { expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const NOW = Date.parse('2026-11-08T12:00:00Z')
export const LIVE = '11111111-2222-4333-8444-555555555555'
export const DEAD = '66666666-7777-4888-8999-aaaaaaaaaaaa'
export const OLD = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
export const LIVE_PID = 4120
export const DEAD_PID = 999

type File = { text: string; mtimeMs: number }

const reply = (at: number, tokens: number, cwd: string) =>
  JSON.stringify({
    type: 'assistant',
    cwd,
    timestamp: new Date(at).toISOString(),
    message: { role: 'assistant', usage: { input_tokens: 0, cache_read_input_tokens: tokens, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } } },
  })

/**
 * Two sessions in one project folder: LIVE (running, 620K, with a 400K
 * subagent) and DEAD (its process gone, 210K, last message 5 minutes ago).
 * OLD's transcript is two hours stale and must be skipped.
 */
export function fakeClaude(dir: string, cwd: string): Map<string, File> {
  const project = `${dir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`
  const files = new Map<string, File>()
  const add = (path: string, text: string, mtimeMs = NOW - 1000) => files.set(path, { text, mtimeMs })
  add(`${dir}/sessions/${LIVE_PID}.json`, JSON.stringify({ pid: LIVE_PID, sessionId: LIVE, cwd, name: 'Fix login', status: 'idle', updatedAt: NOW - 60000 }))
  add(`${dir}/sessions/${DEAD_PID}.json`, JSON.stringify({ pid: DEAD_PID, sessionId: DEAD, cwd, name: 'Old idea', status: 'idle', updatedAt: NOW - 300000 }))
  add(`${project}/${LIVE}.jsonl`, `partial row\n${reply(NOW - 60000, 620000, cwd)}\n`)
  add(`${project}/${LIVE}/subagents/agent-explore1.jsonl`, `${reply(NOW - 30000, 400000, cwd)}\n`)
  add(`${project}/${LIVE}/subagents/agent-explore1.meta.json`, JSON.stringify({ description: 'Explore codebase' }))
  add(`${project}/${DEAD}.jsonl`, `${reply(NOW - 300000, 210000, cwd)}\n`, NOW - 300000)
  add(`${project}/${OLD}.jsonl`, `${reply(NOW - 7200000, 900000, cwd)}\n`, NOW - 7200000)
  return files
}

/** What a folder lists: its files, and the folders on the way to deeper files. */
function listOf(files: Map<string, File>, path: string) {
  const prefix = `${path.replace(/\/$/, '')}/`
  const seen = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
  for (const [p, f] of files) {
    if (!p.startsWith(prefix)) continue
    const [name, ...rest] = p.slice(prefix.length).split('/')
    if (!name || seen.has(name)) continue
    seen.set(name, rest.length ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })
  }
  if (seen.size === 0) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  return [...seen.values()]
}

/** Answers $.fs, $.process, $.env, $.store, $.clock and $.session.id beneath the mod; returns the commands it ran and the clock. */
export function beneath(on: On, files: Map<string, File>, env: Record<string, string>, isWindows: boolean) {
  const ran: string[][] = []
  mock.env(on, env)
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  on('session.id', async () => ({ value: LIVE }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  // The engine resolves a path on the host running the test: a Mac reads `C:/…` as relative
  // and prefixes its own folder, Windows writes `\` and may add a drive to `/Users/…`.
  const at = (path: string) => {
    const p = path.replace(/\\/g, '/')
    if (!isWindows) return p.replace(/^[A-Za-z]:/, '')
    const drive = /[A-Za-z]:\/(?!.*[A-Za-z]:\/)/.exec(p)
    return drive ? p.slice(drive.index) : p
  }
  on('fs.list', async (_$, e) => ({ value: listOf(files, at(e.path)) }))
  on('fs.read', async (_$, e) => {
    const f = files.get(at(e.path))
    if (!f) throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
    return { value: f.text }
  })
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const exe = argv[0]!
    if (isWindows) {
      // Nothing from macOS or Linux may run on Windows.
      expect(exe.startsWith('C:\\Windows\\System32\\')).toBe(true)
      if (exe.endsWith('tasklist.exe')) {
        return { value: { exitCode: 0, stdout: `"claude.exe","${LIVE_PID}","Console","1","210,512 K"\r\n"explorer.exe","77","Console","1","9,000 K"\r\n`, stderr: '' } }
      }
      if (exe.endsWith('powershell.exe')) {
        const paths = (e.init?.env?.CONTEXT_RINGS_PATHS ?? '').split('|')
        const stdout = paths.map(p => `==> ${p} <==\n${files.get(p)?.text ?? ''}\n`).join('')
        return { value: { exitCode: 0, stdout, stderr: '' } }
      }
    } else {
      if (exe === '/bin/ps') {
        expect(argv.slice(1, 4)).toEqual(['-o', 'pid=', '-p'])
        const alive = argv[4]!.split(',').filter(p => p === String(LIVE_PID))
        return { value: { exitCode: alive.length === 2 ? 0 : 1, stdout: alive.map(p => `  ${p}\n`).join(''), stderr: '' } }
      }
      if (exe === '/usr/bin/tail') {
        const paths = argv.slice(3)
        const stdout = paths.length === 1 ? files.get(paths[0]!)!.text : paths.map(p => `==> ${p} <==\n${files.get(p)!.text}\n`).join('\n')
        return { value: { exitCode: 0, stdout, stderr: '' } }
      }
    }
    throw new Error(`unexpected command: ${argv.join(' ')}`)
  })
  // The kit keeps the mod's state; the test reads each value the mod writes on its way down.
  const state = new Map<string, unknown>()
  on('state.set', async (_$, e, next) => {
    const r = await next(e)
    const ev = e as unknown as { key: string; value: unknown }
    state.set(ev.key, ev.value)
    return r
  })
  return { ran, clock, state }
}
