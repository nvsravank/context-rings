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
}

declare module 'claude-code' {
  interface PluginState {
    'context-rings': { rings: Ring[]; folder: string }
  }
}
