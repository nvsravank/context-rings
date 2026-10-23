import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ring, Sub } from '../types'
import {
  K,
  baseName,
  PULSE_MS,
  cacheInfo,
  cacheToast,
  cacheWarning,
  capRings,
  fmt,
  glyph,
  lastContextTokens,
  lastMessageAt,
  level,
  moreLabel,
  parsePct,
  parseSize,
  pctOf,
  parseStat,
  parseWait,
  projectDir,
  ringLabel,
  ringsSvg,
  splitTail,
} from './parse'
import type { CacheWarn, Scale, TranscriptFile } from './parse'

type Engine = EngineInterface

// How often every session's files are read again.
const POLL_MS = 5000
// A session shows this long after its last message, running or not: the prompt cache's hour.
const RECENT_MS = 60 * 60 * 1000
// A subagent whose transcript has not moved in this long is taken as finished.
const SUB_ACTIVE_MS = 10 * 60 * 1000
// How much of each transcript's end is read for its last response's usage.
const TAIL_BYTES = 1000000
// Files per tail call, so one call's output stays under process.run's 4 MiB.
const TAIL_BATCH = 3
const FOLDER_KEY = 'folder'

const c = { ok: 'success', warn: 'warning', bad: 'error', chip: 'suggestion' } as const

// --- preferences: a change reloads the module, so register sets them again ---
let main: Scale = { limit: 1000 * K, yellow: 50, red: 80 }
let sub: Scale = { limit: 500 * K, yellow: 75, red: 90 }
let warn: CacheWarn = { hour: 10 * 60 * 1000, fiveMin: 60 * 1000, minTokens: 500 * K }

const rings = atom({ plugin: 'context-rings', key: 'rings' } as const, [])
const folder = atom({ plugin: 'context-rings', key: 'folder' } as const, '')
// Flips each second while a ring pulses; only the terminal reads it (the SVG animates itself).
const blink = atom({ plugin: 'context-rings', key: 'blink' } as const, false)

type Live = { pid: number; sessionId: string; cwd: string; name?: string; status?: string; updatedAt: number }
type Known = { name?: string; cwd?: string }

let configDir = ''
const tokensByPath = new Map<string, { mtime: number; tokens: number; msgAt?: number; cacheTtl?: number; cacheAt?: number; cwd?: string }>()
const subNames = new Map<string, string>()

async function findConfigDir($: Engine): Promise<string> {
  if (configDir) return configDir
  const { stdout } = await $.process.run(['/bin/sh', '-c', 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"'])
  configDir = stdout.trim()
  return configDir
}

async function readLive($: Engine, dir: string): Promise<Live[]> {
  const entries = await $.fs.list(`${dir}/sessions`).catch(() => [])
  const out: Live[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/^\d+\.json$/.test(entry.name)) continue
    try {
      const j = JSON.parse(await $.fs.read(`${dir}/sessions/${entry.name}`))
      if (typeof j.sessionId !== 'string' || typeof j.pid !== 'number') continue
      out.push({
        pid: j.pid,
        sessionId: j.sessionId,
        cwd: String(j.cwd ?? ''),
        name: typeof j.name === 'string' ? j.name : undefined,
        status: typeof j.status === 'string' ? j.status : undefined,
        updatedAt: Number(j.statusUpdatedAt ?? j.updatedAt ?? 0),
      })
    } catch {
      // A file being rewritten right now: next poll.
    }
  }
  if (out.length === 0) return out
  // A registry file can outlive a crashed process: keep only pids still running.
  const ps = await $.process.run(['/bin/ps', '-o', 'pid=', '-p', out.map(l => l.pid).join(',')])
  const alive = new Set(ps.stdout.split('\n').map(s => Number(s.trim())).filter(Boolean))
  return out.filter(l => alive.has(l.pid))
}

async function statTranscripts($: Engine, dir: string, live: readonly Live[]): Promise<TranscriptFile[]> {
  const names = live.flatMap(l => ['-o', '-name', `${l.sessionId}.jsonl`])
  const minutes = String(Math.ceil(RECENT_MS / 60000))
  const { stdout } = await $.process.run([
    '/usr/bin/find', `${dir}/projects`, '-maxdepth', '4', '-name', '*.jsonl',
    '(', '-mmin', `-${minutes}`, ...names, ')',
    '-exec', '/usr/bin/stat', '-f', '%m %N', '{}', '+',
  ])
  return parseStat(stdout)
}

async function readTokens($: Engine, files: readonly TranscriptFile[]) {
  const stale = files.filter(f => tokensByPath.get(f.path)?.mtime !== f.mtime)
  for (let i = 0; i < stale.length; i += TAIL_BATCH) {
    const batch = stale.slice(i, i + TAIL_BATCH)
    const paths = batch.map(f => f.path)
    const { stdout } = await $.process.run(['/usr/bin/tail', '-c', String(TAIL_BYTES), ...paths])
    const texts = splitTail(stdout, paths)
    for (const f of batch) {
      const text = texts.get(f.path) ?? ''
      const before = tokensByPath.get(f.path)
      const cache = cacheInfo(text)
      const cwd = /"cwd":"([^"]+)"/.exec(text)?.[1]
      tokensByPath.set(f.path, {
        mtime: f.mtime,
        tokens: lastContextTokens(text) ?? before?.tokens ?? 0,
        msgAt: lastMessageAt(text) ?? before?.msgAt,
        cacheTtl: cache.ttl ?? before?.cacheTtl,
        cacheAt: cache.at ?? before?.cacheAt,
        cwd: cwd ?? before?.cwd,
      })
    }
  }
}

async function subName($: Engine, path: string): Promise<string> {
  const known = subNames.get(path)
  if (known) return known
  let name = 'subagent'
  try {
    const meta = JSON.parse(await $.fs.read(path.replace(/\.jsonl$/, '.meta.json')))
    name = String(meta.description ?? meta.agentType ?? name)
  } catch {
    // No meta file: keep the plain name.
  }
  subNames.set(path, name)
  return name
}

async function savedTitle($: Engine, mainPath: string, sessionId: string): Promise<string | undefined> {
  try {
    const j = JSON.parse(await $.fs.read(mainPath.replace(/\.jsonl$/, '') + '/custom-title.json'))
    return typeof j.customTitle === 'string' ? j.customTitle : undefined
  } catch {
    return undefined
  }
}

async function alertSubs($: Engine, subs: readonly { ring: Ring; sub: Sub; mtime: number }[], now: number) {
  // A toast when a subagent's dot turns red.
  const due = subs.filter(s => now - s.mtime < SUB_ACTIVE_MS && pctOf(s.sub.tokens, sub) >= sub.red)
  await toastOnce(
    $,
    due.map(({ ring, sub: s }) => ({ key: s.id, text: `⚠ ${ring.name} › ${s.name}: ${fmt(s.tokens)} of its ${fmt(sub.limit)} limit` })),
    now,
  )
}

async function alertCaches($: Engine, all: readonly Ring[], now: number) {
  // A toast when a session's cache warning starts: once per session per cache lifetime.
  const due = all.filter(r => r.cache === 'warn')
  await toastOnce($, due.map(r => ({ key: `cache:${r.id}:${r.cacheWarnAt}`, text: cacheToast(r, now) })), now)
}

async function toastOnce($: Engine, due: readonly { key: string; text: string }[], now: number) {
  if (due.length === 0) return
  // Every open session runs this: the shared store says what was already toasted.
  const alerted = ((await $.store.get('alerted')) ?? {}) as Record<string, number>
  let isChanged = false
  for (const { key, text } of due) {
    if (alerted[key]) continue
    alerted[key] = now
    isChanged = true
    $.ui.toast(text, { timeoutMs: 8000 })
  }
  if (!isChanged) return
  for (const [id, at] of Object.entries(alerted)) if (now - at > 24 * RECENT_MS) delete alerted[id]
  await $.store.set('alerted', alerted)
}

async function refresh($: Engine) {
  const dir = await findConfigDir($)
  const now = await $.clock.now()
  const currentId = await $.session.id()
  const live = await readLive($, dir)
  const files = await statTranscripts($, dir, live)
  await readTokens($, files)

  const known = ((await $.store.get('known')) ?? {}) as Record<string, Known>
  const liveById = new Map(live.map(l => [l.sessionId, l]))
  const mains = new Map(files.filter(f => f.kind === 'main').map(f => [f.sessionId, f]))
  const ids = new Set([...liveById.keys(), ...mains.keys()])

  const out: Ring[] = []
  for (const id of ids) {
    const l = liveById.get(id)
    const f = mains.get(id)
    const seen = f ? tokensByPath.get(f.path) : undefined
    // The last message, not the file's time: opening a session writes to it and starts its process.
    const lastAt = f ? (seen?.msgAt ?? 0) : (l?.updatedAt ?? 0)
    const isCurrent = id === currentId
    const isBusy = l?.status === 'busy'
    if (!isCurrent && !isBusy && now - lastAt > RECENT_MS) continue
    const cwd = l?.cwd || seen?.cwd || known[id]?.cwd || ''
    const name =
      l?.name || (f ? await savedTitle($, f.path, id) : undefined) || known[id]?.name || `${baseName(cwd) || 'session'} · ${id.slice(0, 8)}`
    known[id] = { name, cwd }
    const cacheTtl = seen?.cacheTtl ?? 0
    const cacheAt = seen?.cacheAt ?? 0
    out.push({
      id, name, cwd, tokens: seen?.tokens ?? 0, isLive: !!l, isBusy, isCurrent, lastAt, subs: [],
      cacheTtl, cacheAt, ...cacheFields(isBusy ? undefined : cacheWarning(cacheTtl, cacheAt, seen?.tokens ?? 0, warn, now)),
    })
  }

  const byId = new Map(out.map(r => [r.id, r]))
  const subRows: { ring: Ring; sub: Sub; mtime: number }[] = []
  for (const f of files) {
    if (f.kind !== 'sub') continue
    const ring = byId.get(f.sessionId)
    const tokens = tokensByPath.get(f.path)?.tokens ?? 0
    // A subagent shows once its dot would be yellow, and only while active.
    if (!ring || pctOf(tokens, sub) < sub.yellow || now - f.mtime > SUB_ACTIVE_MS) continue
    const row = { id: f.agentId, name: await subName($, f.path), tokens }
    ring.subs.push(row)
    subRows.push({ ring, sub: row, mtime: f.mtime })
  }

  out.sort((a, b) => b.lastAt - a.lastAt)
  await alertSubs($, subRows, now)
  await alertCaches($, out, now)

  // Keep names of sessions seen lately, so a closed one still has its title.
  const keep = Object.fromEntries(Object.entries(known).filter(([id]) => ids.has(id)).slice(-200))
  await $.store.set('known', keep)

  const prev = await read($, rings)
  if (JSON.stringify(prev) !== JSON.stringify(out)) await update($, rings, () => out)
  if (out.some(r => isPulsing(r, now))) startBlink($)
}

function cacheFields(w: ReturnType<typeof cacheWarning> | undefined) {
  // A working session's cache is being refreshed as it goes.
  return w ? { cache: w.cache, cacheWarnAt: w.warnAt, cacheArc: w.arc } : { cache: 'warm' as const, cacheWarnAt: 0, cacheArc: 0 }
}

function isPulsing(r: Ring, now: number): boolean {
  return r.cache === 'warn' && now - r.cacheWarnAt < PULSE_MS
}

let blinkTimer: { cancel: () => void } | null = null
function startBlink($: Engine) {
  if (blinkTimer) return
  const tick = () => {
    blinkTimer = $.clock.after(1000, () => {
      void (async () => {
        const now = await $.clock.now()
        if (!(await read($, rings)).some(r => isPulsing(r, now))) {
          blinkTimer = null
          await update($, blink, () => false)
          return
        }
        await update($, blink, on => !on)
        tick()
      })().catch(() => (blinkTimer = null))
    })
  }
  tick()
}

let pollTimer: { cancel: () => void } | null = null
function schedule($: Engine) {
  if (pollTimer) pollTimer.cancel()
  pollTimer = $.clock.after(POLL_MS, () => {
    void refresh($)
      .catch(() => undefined)
      .then(() => schedule($))
  })
}

let lastCycleAt = 0
/** The chip toggles All ↔ this session's folder. */
async function cycleFolder($: Engine) {
  const now = await $.clock.now()
  if (now - lastCycleAt < 400) return
  lastCycleAt = now
  const here = (await read($, rings)).find(r => r.isCurrent)?.cwd ?? ''
  await update($, folder, cur => (cur || !here ? '' : here))
}

export const register: Register = (on, options) => {
  main = { limit: parseSize(options.contextWindow, 1000 * K), yellow: parsePct(options.mainYellow, 50), red: parsePct(options.mainRed, 80) }
  sub = { limit: parseSize(options.subagentLimit, 500 * K), yellow: parsePct(options.subagentYellow, 75), red: parsePct(options.subagentRed, 90) }
  warn = {
    hour: parseWait(options.cacheWarnHour, 10 * 60 * 1000),
    fiveMin: parseWait(options.cacheWarnFiveMin, 60 * 1000),
    minTokens: options.cacheWarnMin === 'Any' ? 0 : parseSize(options.cacheWarnMin, 500 * K),
  }

  on('session.start', async ($, e, next) => {
    void refresh($).catch(() => undefined)
    schedule($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($).catch(() => undefined)
    return next(e)
  })

  // Presses arrive by onPress, ui.press or both (desktop); either cycles the chip once.
  on('ui.press', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.element !== FOLDER_KEY) return next(e)
    await cycleFolder($)
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, rings)
    if (e.props.hasSurvey || all.length === 0) return next(e)
    const picked = await read($, folder)
    const { shown, hidden } = capRings(picked ? all.filter(r => r.cwd === picked) : all)
    const now = await $.clock.now()
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const chip = <Button key={FOLDER_KEY} label={picked ? baseName(picked) : 'All'} onPress={() => void cycleFolder($)} />

    // Desktop: one interactive SVG; pointing at a ring reveals its label inside it (CSS :hover).
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const svg = ringsSvg(shown, main, sub, now, hidden)
      return (
        <Box flexDirection="row" alignItems="center">
          {chip}
          <Box marginLeft={1}>
            <Svg source={svg.source} width={svg.width} height={svg.height} isInteractive alt={`${shown.length + hidden.length} sessions' context`} />
          </Box>
        </Box>
      )
    }

    // Terminal: glyphs; each is a hover group that reveals its label at the row's end.
    const isBlinkOn = await read($, blink)
    const scope = (r: Ring) => `ring-${r.id.slice(0, 20)}`
    return (
      <Box flexDirection="row" width={e.props.bodyColumns}>
        {chip}
        {shown.map(r => {
          const pct = pctOf(r.tokens, main)
          return (
            <Box key={r.id} marginLeft={1} hover={{ scope: scope(r) }}>
              <Text color={c[level(pct, main)]} dimColor={!r.isLive} bold={r.isCurrent} inverse={isPulsing(r, now) && isBlinkOn}>
                {glyph(pct)}
                {r.cache === 'warn' ? '⧗' : ''}
                {r.subs.map(s => (level(pctOf(s.tokens, sub), sub) === 'bad' ? '•' : '·')).join('')}
              </Text>
            </Box>
          )
        })}
        {hidden.length > 0 && (
          <Box key="more" marginLeft={1} hover={{ scope: 'ring-more' }}>
            <Text dimColor>+{hidden.length}</Text>
          </Box>
        )}
        {hidden.length > 0 && (
          <Box key="label-more" marginLeft={2} flexShrink={1} display="none" hover={{ scope: 'ring-more', display: 'flex' }}>
            <Text dimColor wrap="truncate-end">
              {moreLabel(hidden)}
            </Text>
          </Box>
        )}
        {shown.map(r => (
          <Box key={`label-${r.id}`} marginLeft={2} flexShrink={1} display="none" hover={{ scope: scope(r), display: 'flex' }}>
            <Text dimColor wrap="truncate-end">
              {ringLabel(r, main, now)}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
