import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Brief, ChatTimer } from '../types'

const TOOL = 'mcp__session-brief__set_brief'

const brief = atom(
  { plugin: 'session-brief', key: 'brief' } as const,
  {
    purpose: 'New session — the brief fills in after the first turn',
    done: ['Nothing done yet', 'Nothing done yet'],
  } as Brief,
)

// A gap longer than this between activity counts as a break and restarts the stretch.
const BREAK_MS = 30 * 60 * 1000

const timer = atom(
  { plugin: 'session-brief', key: 'timer' } as const,
  { openedAt: 0, startedAt: 0, lastActive: 0, now: 0 } as ChatTimer,
)

const fmt = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

const clockTime = (ms: number) => {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)

const RULES = `A "session brief" is shown to the user above their prompt and goes stale unless you keep it current. At the end of EVERY turn in which you did anything (edited files, ran commands, pushed, answered a question, or are waiting on the user), as your last tool call before your final message, call ${TOOL} with: purpose (max 80 chars: what this session is for), and done (exactly 2 strings, max 70 chars each: the two most recent things completed, newest first; a pending question may be the newest). Keep it terse and factual, change purpose only when the goal changes, and do not mention this call in your reply.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    const saved = (await $.store.get(`brief:${id}`)) as Brief | undefined
    if (saved && typeof saved.purpose === 'string' && Array.isArray(saved.done)) {
      await update($, brief, () => saved)
    }
    const now = await $.clock.now()
    await update($, timer, t => ({
      openedAt: t.openedAt || now,
      startedAt: t.startedAt || now,
      lastActive: t.lastActive || now,
      now,
    }))
    $.clock.every(30000, async () => {
      const at = await $.clock.now()
      await update($, timer, x => ({ ...x, now: at }))
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
    const input = e as unknown as { purpose?: unknown; done?: unknown }
    const purpose = typeof input.purpose === 'string' ? clip(input.purpose.trim(), 100) : ''
    const done = (Array.isArray(input.done) ? input.done : [])
      .filter((x): x is string => typeof x === 'string')
      .slice(0, 2)
      .map(x => clip(x.trim(), 90))
    if (purpose === '' || done.length === 0) return { result: 'purpose and done are required' }
    const next: Brief = { purpose, done }
    await update($, brief, () => next)
    await $.store.set(`brief:${await $.session.id()}`, next)
    return { result: 'ok' }
  })

  // Your activity: a prompt starts (or continues) the work stretch.
  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, timer, t => ({
      openedAt: t.openedAt || now,
      startedAt: t.startedAt === 0 || now - t.lastActive > BREAK_MS ? now : t.startedAt,
      lastActive: now,
      now,
    }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, timer, t => ({ ...t, lastActive: now, now }))
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'session-brief:rules', text: RULES, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const b = await read($, brief)
    const t = await read($, timer)
    const cols = Math.max(24, e.props.bodyColumns ?? 80)
    const { Box, Text } = $.ui.resolve(e)

    // Right column, compact: work stretch / since / open.
    const idle = t.startedAt !== 0 && t.now - t.lastActive > BREAK_MS
    const right =
      t.startedAt === 0
        ? ['', '', '']
        : idle
          ? [`idle ${fmt(t.now - t.lastActive)}`, `last ${fmt(t.lastActive - t.startedAt)}`, `${fmt(t.now - t.openedAt)} open`]
          : [`${fmt(t.now - t.startedAt)} work`, `since ${clockTime(t.startedAt)}`, `${fmt(t.now - t.openedAt)} open`]
    const left = [`◎ ${b.purpose}`, ...b.done.slice(0, 2).map(d => `✓ ${d}`)]
    const rw = Math.max(...right.map(r => r.length))

    return (
      <Box flexDirection="column">
        {left.map((l, i) => (
          <Box key={String(i)} justifyContent="space-between">
            <Text dimColor>{clip(l, cols - rw - 2)}</Text>
            <Text dimColor>{right[i] ?? ''}</Text>
          </Box>
        ))}
        {below}
      </Box>
    )
  })
}
