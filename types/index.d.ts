export type Brief = {
  /** what this session is for */
  purpose: string
  /** the two most recent things completed, newest first */
  done: string[]
}

export type ChatTimer = {
  /** ms epoch the session was first seen open (first load of this mod) */
  openedAt: number
  /** ms epoch the current continuous work stretch began; 0 = not started */
  startedAt: number
  /** ms epoch of the last prompt or finished turn */
  lastActive: number
  /** latest clock reading, bumped by the ticker */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-brief': { brief: Brief; timer: ChatTimer; tokens: number }
  }
}
