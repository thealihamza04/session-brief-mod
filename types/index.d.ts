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

/** Time accounting: active vs idle, from activity events (prompts and finished turns). */
export type Meter = {
  /** ms epoch of the first activity (0 = none yet) */
  startedAt: number
  lastActive: number
  /** ms spent working (gaps up to 30 minutes, and any turn in progress) */
  active: number
  /** ms of breaks (gaps longer than 30 minutes) */
  idle: number
  /** a turn is running: the time until it completes counts as active */
  inTurn: boolean
  /** each work session (a stretch between breaks), oldest first, capped */
  runs: { start: number; end: number }[]
}

export type Water = {
  /** ms epoch the glass was last filled (0 = never seen) */
  lastDrink: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-brief': { brief: Brief; timer: ChatTimer; tokens: number; water: Water; period: Meter; sess: Meter }
  }
}
