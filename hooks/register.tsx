import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Brief, ChatTimer } from '../types'

const TOOL = 'mcp__session-brief__set_brief'

const briefRef = { plugin: 'session-brief', key: 'brief' } as const
const brief = atom(briefRef, {
  purpose: 'New session — the brief fills in after the first turn',
  done: ['Nothing done yet', 'Nothing done yet'],
} as Brief)

// A gap longer than this between activity counts as a break and restarts the stretch.
const BREAK_MS = 30 * 60 * 1000
// Longest uptime we believe from the OS (anything past this is a parse accident).
const MAX_UPTIME_MS = 3650 * 86_400_000

const timer = atom(
  { plugin: 'session-brief', key: 'timer' } as const,
  { openedAt: 0, startedAt: 0, lastActive: 0, now: 0 } as ChatTimer,
)
const tokens = atom({ plugin: 'session-brief', key: 'tokens' } as const, 0)

// ---------- small, defensive helpers ----------

/** A finite number above zero, else 0. Guards everything read back from storage. */
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 5m, 3h07m, 12d4h. Never longer than 6 cells below 1000 days. */
const fmt = (ms: number) => {
  const m = Math.max(0, Math.floor(num(ms) / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${pad2(m % 60)}m`
  const d = Math.floor(h / 24)
  return d >= 1000 ? '999d+' : `${d}d${h % 24}h`
}

/** 950 -> 950, 1234 -> 1.2k, 184000 -> 184k, 1.3e6 -> 1.3M. */
const compact = (n: number) => {
  const v = Math.floor(num(n))
  if (v < 1000) return String(v)
  const units = ['k', 'M', 'B', 'T']
  let x = v
  let i = -1
  do {
    x /= 1000
    i += 1
  } while (x >= 999.5 && i < units.length - 1)
  return `${x < 10 ? x.toFixed(1) : Math.round(x)}${units[i]}`
}

// ps "etime" is [[dd-]hh:]mm:ss
const etimeMs = (e: string) => {
  const m = e.trim().match(/^(?:(\d{1,5})-)?(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  const d = Number(m[1] ?? 0)
  const h = Number(m[2] ?? 0)
  const mi = Number(m[3] ?? 0)
  const sec = Number(m[4] ?? 0)
  if (h > 23 || mi > 59 || sec > 59) return null
  const ms = (((d * 24 + h) * 60 + mi) * 60 + sec) * 1000
  return ms <= MAX_UPTIME_MS ? ms : null
}

const clockTime = (ms: number) => {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`
}

/** Terminal cells one code point occupies: 0 (joiners, combining), 2 (CJK, emoji), else 1. */
const cellOf = (c: number) => {
  if (c === 0x200d || c === 0xfe0f || (c >= 0x300 && c <= 0x36f)) return 0
  const isWide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  return isWide ? 2 : 1
}

const cells = (s: string) => {
  let w = 0
  for (const ch of s) w += cellOf(ch.codePointAt(0) ?? 0)
  return w
}

/** Cut to at most `n` cells, on code-point boundaries, ending in "…" when cut. */
const clip = (s: string, n: number) => {
  if (n <= 0) return ''
  if (cells(s) <= n) return s
  let out = ''
  let w = 0
  for (const ch of s) {
    const cw = cellOf(ch.codePointAt(0) ?? 0)
    if (w + cw > n - 1) break
    out += ch
    w += cw
  }
  return out + '…'
}

/** One clean line: ANSI sequences dropped; control chars, bidi marks and newlines become single spaces. */
const clean = (x: unknown, maxCells: number) =>
  typeof x === 'string'
    ? clip(
        x
          .slice(0, 2000)
          .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '') // OSC (titles, links)
          .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI (colors, cursor)
          .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        maxCells,
      )
    : ''

/** A brief read back from anywhere (store, tool input): valid, clean, or null. */
const asBrief = (x: unknown): Brief | null => {
  const o = x as { purpose?: unknown; done?: unknown } | null
  const purpose = clean(o?.purpose, 100)
  const done = (Array.isArray(o?.done) ? (o.done as unknown[]) : [])
    .map(d => clean(d, 90))
    .filter(d => d !== '')
    .slice(0, 2)
  return purpose !== '' && done.length > 0 ? { purpose, done } : null
}

type Stretch = { startedAt: number; lastActive: number }
const asStretch = (x: unknown): Stretch | null => {
  const o = x as { startedAt?: unknown; lastActive?: unknown } | null
  const startedAt = num(o?.startedAt)
  const lastActive = num(o?.lastActive)
  return startedAt && lastActive ? { startedAt, lastActive } : null
}

/** Run a write that must never take the hook down with it. */
const safely = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch {
    // a lost redraw or a busy value is not worth failing the user's turn
  }
}

const RULES = `A "session brief" is shown to the user above their prompt and goes stale unless you keep it current. At the end of EVERY turn in which you did anything (edited files, ran commands, pushed, answered a question, or are waiting on the user), as your last tool call before your final message, call ${TOOL} with: purpose (max 80 chars: what this session is for), and done (exactly 2 strings, max 70 chars each: the two most recent things completed, newest first; a pending question may be the newest). Keep it terse and factual, change purpose only when the goal changes, and do not mention this call in your reply.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    const now = await $.clock.now()

    const saved = asBrief(await $.store.get(`brief:${id}`))
    if (saved) await safely(() => update($, brief, () => saved))
    const savedTokens = num(await $.store.get(`tokens:${id}`))
    if (savedTokens > 0) await safely(() => update($, tokens, () => savedTokens))

    // The work stretch is shared by every session (kept in the plugin store).
    const stretch = asStretch(await $.store.get('stretch'))

    // "App" = how long the Claude desktop app has been running, read from the OS.
    let openedAt = 0
    try {
      const ps = await $.process.run(['ps', '-eo', 'etime=,args='], { timeoutMs: 3000 })
      const line = ps.stdout
        .split('\n')
        .find(l => /(\/claude-desktop|Claude\.app\/Contents\/MacOS\/Claude)(\s|$)/.test(l) && !l.includes('--type='))
      const up = line ? etimeMs(line.trim().split(/\s+/)[0] ?? '') : null
      if (up !== null) openedAt = now - up
    } catch {
      // no ps (e.g. Windows): fall back below
    }
    if (openedAt <= 0) {
      const seen = num(await $.store.get('firstSeen'))
      openedAt = seen || now
      if (!seen) await safely(() => $.store.set('firstSeen', now))
    }

    await safely(() =>
      update($, timer, t => ({
        openedAt,
        startedAt: stretch?.startedAt || t.startedAt || now,
        lastActive: stretch?.lastActive || t.lastActive || now,
        now,
      })),
    )
    $.clock.every(30000, async () => {
      await safely(async () => {
        const at = await $.clock.now()
        await update($, timer, x => ({ ...x, now: at }))
      })
    })

    await $.tool.register({
      name: 'set_brief',
      description:
        'Update the 3-line session brief shown above the user prompt: the session purpose and the two most recent things done.',
      inputSchema: {
        type: 'object',
        properties: {
          purpose: { type: 'string', description: 'What this session is for, max 80 chars' },
          done: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 2,
            description: 'The two most recent things completed, newest first, max 70 chars each',
          },
        },
        required: ['purpose', 'done'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const next = asBrief(e)
    if (!next) return { result: 'purpose (string) and done (1-2 strings) are required' }
    try {
      // Replace, not read-modify-write: parallel calls must not fight over a version.
      await $.state.set(briefRef, next)
      await $.store.set(`brief:${await $.session.id()}`, next)
    } catch {
      return { result: 'could not save the brief' }
    }
    return { result: 'ok' }
  })

  // Your activity: a prompt starts (or continues) the work stretch.
  on('prompt.submit', async ($, e, next) => {
    await safely(async () => {
      const now = await $.clock.now()
      const stored = asStretch(await $.store.get('stretch'))
      const startedAt = !stored || now - stored.lastActive > BREAK_MS ? now : stored.startedAt
      await $.store.set('stretch', { startedAt, lastActive: now })
      await update($, timer, t => ({ ...t, startedAt, lastActive: now, now }))
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await safely(async () => {
      const now = await $.clock.now()
      // A turn finishing after a long gap (no prompt in between) starts a new stretch too.
      const stored = asStretch(await $.store.get('stretch'))
      const startedAt = !stored || now - stored.lastActive > BREAK_MS ? now : stored.startedAt
      await $.store.set('stretch', { startedAt, lastActive: now })
      await update($, timer, t => ({ ...t, startedAt, lastActive: now, now }))

      // Tokens this turn, cache reads excluded (they would dwarf everything else).
      const u = r.usage
      if (u) {
        const add = num(u.input_tokens) + num(u.output_tokens) + num(u.cache_creation_input_tokens)
        if (add > 0) {
          const total = Math.min(1e15, (await read($, tokens)) + add)
          await update($, tokens, () => total)
          await $.store.set(`tokens:${await $.session.id()}`, total)
        }
      }
    })
    return r
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'session-brief:rules', text: RULES, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const cols = Math.floor(num(e.props.bodyColumns) || 80)
    if (e.props.hasSurvey || cols < 1) return below

    const b = asBrief(await read($, brief)) ?? { purpose: '', done: [] }
    const t = await read($, timer)
    const tok = await read($, tokens)
    const { Box, Text } = $.ui.resolve(e)

    // Never trust the stored clocks: a machine clock set back must not give negatives.
    const now = num(t.now)
    const startedAt = Math.min(num(t.startedAt), now)
    const lastActive = Math.min(num(t.lastActive), now)
    const openedAt = Math.min(num(t.openedAt), now)

    // Right column, compact: work stretch / since / app (+ tokens).
    const app = `${fmt(now - openedAt)} app${tok > 0 ? ` · ${compact(tok)}` : ''}`
    const isIdle = startedAt !== 0 && now - lastActive > BREAK_MS
    const right =
      startedAt === 0
        ? ['', '', '']
        : isIdle
          ? [`idle ${fmt(now - lastActive)}`, `last ${fmt(lastActive - startedAt)}`, app]
          : [`${fmt(now - startedAt)} work`, `since ${clockTime(startedAt)}`, app]
    const left = [`◎ ${b.purpose}`, ...b.done.map(d => `✓ ${d}`)]

    // Fit the band: with little room the right column goes first, then the text is clipped.
    const rw = Math.max(...right.map(cells))
    const room = cols - rw - 2
    const hasRight = room >= 16

    return (
      <Box flexDirection="column">
        {left.map((l, i) => (
          <Box key={String(i)} justifyContent="space-between">
            <Text dimColor>{clip(l, hasRight ? room : cols)}</Text>
            {hasRight ? <Text dimColor>{right[i] ?? ''}</Text> : <Text dimColor>{''}</Text>}
          </Box>
        ))}
        {below}
      </Box>
    )
  })
}
