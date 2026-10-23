// Pure helpers: no `$` here, so the validator only has to follow register.tsx.

import type { Ring } from '../types'

export const K = 1000

/** "100K" → 100000, "1M" → 1000000; anything else → fallback. */
export function parseSize(text: unknown, fallback: number): number {
  if (typeof text !== 'string') return fallback
  const m = /^(\d+)([KM])$/.exec(text)
  if (!m) return fallback
  return Number(m[1]) * (m[2] === 'M' ? 1000 * K : K)
}

/** 340000 → "340K", 1000000 → "1M". */
export function fmt(tokens: number): string {
  if (tokens >= 1000 * K) return `${+(tokens / (1000 * K)).toFixed(2)}M`
  return `${Math.round(tokens / K)}K`
}

export function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** The folder name Claude Code files a project's transcripts under. */
export function projectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

export type TranscriptFile =
  | { kind: 'main'; path: string; mtime: number; sessionId: string }
  | { kind: 'sub'; path: string; mtime: number; sessionId: string; agentId: string }

/** Lines of `stat -f '%m %N'`: seconds, a space, the path. */
export function parseStat(stdout: string): TranscriptFile[] {
  const out: TranscriptFile[] = []
  for (const line of stdout.split('\n')) {
    const i = line.indexOf(' ')
    if (i <= 0) continue
    const mtime = Number(line.slice(0, i)) * 1000
    const path = line.slice(i + 1)
    const sub = /\/([0-9a-f-]{36})\/subagents\/agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(path)
    if (sub) {
      out.push({ kind: 'sub', path, mtime, sessionId: sub[1]!, agentId: sub[2]! })
      continue
    }
    const main = /\/([0-9a-f-]{36})\.jsonl$/.exec(path)
    if (main) out.push({ kind: 'main', path, mtime, sessionId: main[1]! })
  }
  return out
}

/**
 * Splits the output of `tail -c N a b c` into each file's text. With more than
 * one file tail heads each with `==> path <==`; with one it writes none.
 */
export function splitTail(stdout: string, paths: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  if (paths.length === 1) {
    map.set(paths[0]!, stdout)
    return map
  }
  const re = /^==> (.*) <==$/gm
  const heads: { path: string; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(stdout))) heads.push({ path: m[1]!, start: m.index, end: re.lastIndex })
  heads.forEach((h, i) => {
    const stop = i + 1 < heads.length ? heads[i + 1]!.start : stdout.length
    map.set(h.path, stdout.slice(h.end, stop))
  })
  return map
}

/**
 * The context the last assistant response was answered over: uncached input,
 * cache writes and cache reads together. A compaction after the last response
 * counts as its `postTokens`, until the next response reports the real figure.
 * Undefined when the tail holds neither.
 */
export function lastContextTokens(text: string): number | undefined {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    const isCompact = line.includes('"compact_boundary"')
    if (!isCompact && (!line.includes('"usage"') || !line.includes('"assistant"'))) continue
    try {
      const row = JSON.parse(line)
      if (isCompact && row?.subtype === 'compact_boundary') {
        const post = row?.compactMetadata?.postTokens
        if (typeof post === 'number') return post
        continue
      }
      const u = row?.message?.usage
      if (!u || row?.message?.role !== 'assistant') continue
      return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    } catch {
      // The tail's first line is usually cut mid-row.
    }
  }
  return undefined
}

/** Five fill steps for the terminal, where there is no SVG. */
export function glyph(pct: number): string {
  if (pct < 12.5) return '○'
  if (pct < 37.5) return '◔'
  if (pct < 62.5) return '◑'
  if (pct < 87.5) return '◕'
  return '●'
}

/** A limit and the percentages of it where yellow and red begin. */
export type Scale = { limit: number; yellow: number; red: number }

export function pctOf(tokens: number, scale: Scale): number {
  return Math.min(100, (tokens / scale.limit) * 100)
}

export function level(pct: number, scale: Scale): 'ok' | 'warn' | 'bad' {
  return pct < scale.yellow ? 'ok' : pct < scale.red ? 'warn' : 'bad'
}

/** "65%" → 65; anything else → fallback. */
export function parsePct(text: unknown, fallback: number): number {
  const m = typeof text === 'string' ? /^(\d+)%$/.exec(text) : null
  return m ? Number(m[1]) : fallback
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

const HEX = { ok: '#3fb950', warn: '#d29922', bad: '#f85149' } as const
const RING = 24
const DOT = 8

/** What hovering a ring reveals: name, folder, fill and state. */
export function ringLabel(r: Ring, main: Scale, now: number): string {
  const pct = pctOf(r.tokens, main)
  const state = r.isLive ? (r.isBusy ? 'working' : 'idle') : `closed ${ago(now - r.lastAt)}`
  const subs = r.subs.map(s => `${s.name} ${fmt(s.tokens)}`).join(', ')
  return `${r.name} · ${baseName(r.cwd)} · ${fmt(r.tokens)} of ${fmt(main.limit)} (${Math.round(pct)}%) · ${state}${r.isCurrent ? ' · this session' : ''}${subs ? ` · subagents: ${subs}` : ''}`
}

/** One session's ring, with its subagents' dots after it. */
export function ringSvg(r: Ring, main: Scale, sub: Scale): { source: string; width: number; height: number } {
  const pct = pctOf(r.tokens, main)
  const color = HEX[level(pct, main)]
  const c = RING / 2
  const rad = 9
  const len = 2 * Math.PI * rad
  const parts = [
    `<g opacity="${r.isLive ? 1 : 0.4}">`,
    `<circle cx="${c}" cy="${c}" r="${rad}" fill="none" stroke="#8b949e" stroke-opacity="0.3" stroke-width="3"/>`,
    `<circle cx="${c}" cy="${c}" r="${rad}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"` +
      ` stroke-dasharray="${((len * pct) / 100).toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`,
    r.isCurrent ? `<circle cx="${c}" cy="${c}" r="2.5" fill="#8b949e"/>` : '',
    r.isBusy
      ? `<circle cx="${c}" cy="${c}" r="${rad}" fill="none" stroke="${color}" stroke-width="1" opacity="0.6">` +
        `<animate attributeName="r" values="${rad};${rad + 2.5};${rad}" dur="1.6s" repeatCount="indefinite"/></circle>`
      : '',
    `</g>`,
  ]
  let x = RING
  for (const s of r.subs) {
    parts.push(`<circle cx="${x + DOT / 2}" cy="${c}" r="3.5" fill="${HEX[level(pctOf(s.tokens, sub), sub)]}"/>`)
    x += DOT
  }
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${RING}" viewBox="0 0 ${x} ${RING}">${parts.join('')}</svg>`,
    width: x,
    height: RING,
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Room for the hover label after the rings, in CSS pixels.
const LABEL_W = 640

// Most rings shown in the row; the rest fold into a "+N".
export const MAX_RINGS = 10

/**
 * The first `max` rings (most recent first) and the rest. This session's ring
 * always shows: when it is past the cap it takes the last place.
 */
export function capRings(rings: readonly Ring[], max = MAX_RINGS): { shown: Ring[]; hidden: Ring[] } {
  if (rings.length <= max) return { shown: [...rings], hidden: [] }
  const shown = rings.slice(0, max)
  const current = rings.slice(max).find(r => r.isCurrent)
  if (current) shown[max - 1] = current
  return { shown, hidden: rings.filter(r => !shown.includes(r)) }
}

/** What hovering the "+N" reveals: the names of the folded sessions. */
export function moreLabel(hidden: readonly Ring[]): string {
  return `${hidden.length} more: ${hidden.map(r => r.name).join(', ')}`
}

/**
 * Every ring in one interactive SVG. Pointing at a ring reveals its label,
 * drawn in the same SVG after the last ring, by CSS :hover inside the frame.
 */
export function ringsSvg(
  rings: readonly Ring[],
  main: Scale,
  sub: Scale,
  now: number,
  hidden: readonly Ring[] = [],
): { source: string; width: number; height: number } {
  let x = 0
  const groups: string[] = []
  const pieces = rings.map(r => ringSvg(r, main, sub))
  pieces.forEach(p => (x += p.width + 6))
  const moreW = hidden.length ? 8 * String(hidden.length).length + 16 : 0
  const labelX = x + moreW + 6
  x = 0
  rings.forEach((r, i) => {
    const p = pieces[i]!
    const inner = p.source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
    groups.push(
      `<g class="r"><rect x="${x}" y="0" width="${p.width + 6}" height="${RING}" fill="transparent"/>` +
        `<g transform="translate(${x} 0)">${inner}</g>` +
        `<text class="l" x="${labelX}" y="${RING / 2 + 4}">${esc(ringLabel(r, main, now))}</text></g>`,
    )
    x += p.width + 6
  })
  if (hidden.length) {
    groups.push(
      `<g class="r"><rect x="${x}" y="0" width="${moreW}" height="${RING}" fill="transparent"/>` +
        `<text class="m" x="${x}" y="${RING / 2 + 4}">+${hidden.length}</text>` +
        `<text class="l" x="${labelX}" y="${RING / 2 + 4}">${esc(moreLabel(hidden))}</text></g>`,
    )
  }
  const width = labelX + LABEL_W
  const style =
    `<style>.l{visibility:hidden;font:12px -apple-system,system-ui,sans-serif;fill:#8b949e}` +
    `.m{font:12px -apple-system,system-ui,sans-serif;fill:#8b949e}` +
    `.r:hover .l{visibility:visible}.r{cursor:default}</style>`
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${RING}" viewBox="0 0 ${width} ${RING}">${style}${groups.join('')}</svg>`,
    width,
    height: RING,
  }
}
