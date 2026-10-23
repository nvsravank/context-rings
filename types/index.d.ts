export type Sub = { id: string; name: string; tokens: number }

export type Ring = {
  id: string
  name: string
  cwd: string
  tokens: number
  isLive: boolean
  isBusy: boolean
  isCurrent: boolean
  lastAt: number
  subs: Sub[]
  /** The prompt cache's lifetime in ms (0 unknown), when the last reply restarted it, and its state. */
  cacheTtl: number
  cacheAt: number
  cache: 'warm' | 'warn' | 'cold' | 'none'
}

declare module 'claude-code' {
  interface PluginState {
    'context-rings': { rings: Ring[]; folder: string; blink: boolean }
  }
}
