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

export type Draft = {
  /** the post text (AI-written, or a plain template if the model was unavailable) */
  text: string
  /** an https compose link prefilled with the text where the platform allows it */
  url: string
  at: number
}

export type Share = {
  /** every "done" update of this project, oldest first (capped) */
  log: { at: number; text: string }[]
  /** ms epoch the user last marked a post as shared, per platform (0 = never) */
  shared: { linkedin: number; x: number }
  drafts: { linkedin?: Draft; x?: Draft }
  /** the unshared-update count we last nudged at */
  nudged: number
  /** a draft is being written for this platform right now */
  drafting: '' | 'linkedin' | 'x'
}

export type Git = {
  kind: 'none' | 'clean' | 'ahead' | 'dirty' | 'noup'
  ahead: number
  dirty: number
  branch: string
}

export type Water = {
  /** ms epoch the glass was last filled (0 = never seen) */
  lastDrink: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-brief': { brief: Brief; timer: ChatTimer; tokens: number; water: Water; share: Share; git: Git }
  }
}
