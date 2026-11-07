import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Brief, ChatTimer, Water } from '../types'

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
// The glass drains linearly over this long, then you are nudged to drink.
const DRAIN_MS = 45 * 60 * 1000
// While it stays empty and you keep working, remind again this often.
const NUDGE_EVERY_MS = 15 * 60 * 1000

const water = atom({ plugin: 'session-brief', key: 'water' } as const, { lastDrink: 0 } as Water)
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

/** How full the glass is, 0..1. A refill dated in the future (clock set back) counts as full. */
const fill = (now: number, lastDrink: number) => {
  if (!lastDrink || !now) return 1
  return Math.max(0, Math.min(1, 1 - Math.max(0, now - lastDrink) / DRAIN_MS))
}
// Water level -> icon index: 0 full, 1 three quarters, 2 half, 3 low, 4 empty.
const glassIndex = (f: number) => (f <= 0 ? 4 : f > 0.87 ? 0 : f > 0.62 ? 1 : f > 0.37 ? 2 : 3)

// Terminal fallback (no images there): a glass drawn with block characters, ▕█▏ full to ▕ ▏ empty.
const WATER = ['█', '▆', '▄', '▂', ' '] as const
const glassIcon = (f: number) => `▕${WATER[glassIndex(f)]}▏`

// Desktop / editor icons: 44px PNGs (full, 3/4, 1/2, 1/4, empty), drawn at 22px.
const GLASS_PNG = ["data:image/png;base64,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", "data:image/png;base64,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", "data:image/png;base64,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", "data:image/png;base64,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", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFN0lEQVR42u1YT4gTZxT/vW/+JlndFY27uFtPPTkUCgpe91AoLSoUTCilB63QFMEiLQVvm73XqqALoY3CQhcce6i20OPutdRrpEWhZTdL9p+7STabTPLNzOthknQCBTOa9GD3wRAS3p9f3rzv/d77gH3Zl335T4WiKKdsWzlRSDGQHVD4LJ5YD+hBOu39vzM8MzMjZmdn/bm8fdWMxc80GnsKAOUVY3uxWMJzGrWfL1/68GYnxouM1Ih/72PDNE46jfoeCIKZ6aWyRMRg+IZpJBynPgbgZr+2fQG2LCsAxni2V6u9rWp4ixvmupSO0DTTjwJWSkeomulTzBnfq9WegvGsJ8YgABeSSQIAJi7F4jGlvusZmcy5+qvUQ+7eD0b8QEypVlulcIwXiYj0KpmKmqZDejzJzLS4uKgyM0V5OjbS40lN00FMxSgY+gO81NVeJRIAeIKIeGkpqMcoT8cm8CEAxmpPjEEAtqxNBgD2UfJ9H0SYBABMv0QtTHcOHiZ93wcTSuEYAwFcKKQCZ6q3IWULRDz1yv2UeErKFqB6Gz0xBgE4mwUDgGzxttOog0FTAGBt9peVnrfVtmHQlNOoQ7Z4OxxjsIeuPlaW0q0BQUkUCoXIgEM2k1K2alQfKw+VGufu2k/n8vZyiCWjkEfXZi5vL8/dtZ9Gjd93hmdmZgQAMHMJxEfn5+fj7e99B+vozs/Px0F8lJlLYd+DLgnRptWibpjGjkOHgtrL9p3hju6OQ4d0wzSIuj14CICnp9tZQtE0Y9CV+GEAeNInpYZ1dSV+2DRjYEYx7Hvghy4oQi6qqgaf/XEASEWZp9ufvuKPq6oGAheHVsNYalORUFaJCAw+Fpz6JPXfIdozicvHiAgQymqP70ECtiyLgwy7a77nvRzbhVnO80Bw18K+Bwq40z9dyZutVhNEmIoyA4R1iTDVajXhSt6M2s9FhBPOAKCzv91o1JkR0HO/M0DPTAKeajTqrLO/HfY9UMDUrdRaxfO8SpvtKJVK9T3Ah3QnAx+1Sq/vgXYJYgCUyWQkEa0x8wTQ5X/qq8H8QyATBFrLZDIy+J14KG0ttMMVDd1I3srnk0TEudzjF24uudxjlYj4Vj6fNHQjCQp6cNS9MNISms1mBQCfGcuJkQOqV/EXbty4l8pkTpUBwLZtpVBIUrdzLAV1m06nvUzmlMzl7FFf0EJi5KC6s/18OexzKIAxPQ3MzgKMjabjIJ5IvENEv819Z3+peDu/pNNpCQCY7TVbXFxU//hz/T0I5ZtEIvFm02kAjI0en0MB3CkNgVVVVVGtlh8Jobx7ZPzow+dbtHLnrv0rfH9dCOEFr5oI4PHf/9o6fTg5cfz51mazWq38NHpw9CyL9moUUaIB7jISrRimCeyKBSn5arm884UgcU7X1fOabvSu9a0mpJQr1Ur5NuBeJ1JOG6Z5Fru7K1FZLjLgLiMx1lzXBQEnPv80fR/AFQBXvl14OF5tVA8orqQmgISqMVRj97ML59c7Pu7k719ypQswIrNcZMAdRvJcd8txHA/gN27ftkeaBnSMojGK5lb6o/RGuN3Zti1yuUfxnZ2Sdu1apkJE482m4wlQZJaLfHvJzERE/HXu+yNxTdswDIMcx6kH7ZFABGLu9UnEzCAvFotx06mdYV/5Kj6SeJ/rrUMXL35Q7vgcSoaJiJmZstnsdvy4dR3ASSISzCwAxr8vH8SCiBnw4CsbPvOPe7XayuVP0pULF6KBff0vtMMSkEQhwuBjUSqV8rPZLFmWRenX+RJ7X/bldZK/Aad7uf6MseNFAAAAAElFTkSuQmCC"] as const
const glassSvg = (f: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="22" height="22" viewBox="0 0 22 22"><image width="22" height="22" xlink:href="${GLASS_PNG[glassIndex(f)]}" href="${GLASS_PNG[glassIndex(f)]}"/></svg>`
const glassColor = (f: number) => (f > 0.5 ? 'suggestion' : f > 0.2 ? 'warning' : 'error')

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

/** XML-escape text for an SVG <title> (the native tooltip). */
const xml = (x: string) =>
  x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** A transparent, hover-only SVG whose <title> is the browser's own tooltip. */
const tooltipSvg = (text: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="16" viewBox="0 0 4000 16"><rect width="4000" height="16" fill="transparent"><title>${xml(text)}</title></rect></svg>`

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

    // The glass is shared by every session too.
    const savedDrink = num(((await $.store.get('water')) as { lastDrink?: unknown } | undefined)?.lastDrink)
    await safely(() => update($, water, () => ({ lastDrink: savedDrink || now })))
    if (!savedDrink) await safely(() => $.store.set('water', { lastDrink: now }))

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

        // Nudge: the glass is empty, you are working, and we have not nagged lately.
        const w = await read($, water)
        const stretch = asStretch(await $.store.get('stretch'))
        const isWorking = stretch !== null && at - stretch.lastActive <= BREAK_MS
        if (fill(at, w.lastDrink) <= 0 && isWorking) {
          const nudge = (await $.store.get('waterNudge')) as { for?: unknown; at?: unknown } | undefined
          const isDue = nudge?.for !== w.lastDrink || at - num(nudge?.at) >= NUDGE_EVERY_MS
          if (isDue) {
            await $.store.set('waterNudge', { for: w.lastDrink, at })
            $.ui.toast('Time for a glass of water. Press the glass to refill it.', { timeoutMs: 8000 })
          }
        }
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
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // Desktop/editor/mobile draw an interactive SVG, whose <title> is a native tooltip; the terminal has none.
    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : null

    // Never trust the stored clocks: a machine clock set back must not give negatives.
    const now = num(t.now)
    const startedAt = Math.min(num(t.startedAt), now)
    const lastActive = Math.min(num(t.lastActive), now)
    const openedAt = Math.min(num(t.openedAt), now)
    const isIdle = startedAt !== 0 && now - lastActive > BREAK_MS

    // The water glass: drains over DRAIN_MS; pressing it refills.
    const level = fill(now, num((await read($, water)).lastDrink))
    const glass: Seg = { t: glassIcon(level), c: glassColor(level), bold: true, press: 'water' }
    const leftMin = Math.ceil((level * DRAIN_MS) / 60000)
    const hint = Svg ? 'use Refill when you drink' : 'click the glass to refill'
    const waterTip =
      level <= 0
        ? `Water is empty: time to drink! ${Svg ? 'Press Refill after.' : 'Click the glass to refill.'}`
        : `Water ${Math.round(level * 100)}% · empty in ${leftMin}m · ${hint}`
    const gap: Seg = { t: ' ' }
    // A line is a list of styled runs; widths are measured on their plain text.
    type Seg = { t: string; c?: string; bg?: string; bold?: boolean; press?: 'water' }
    const plain = (line: Seg[]) => line.map(x => x.t).join('')

    const left: Seg[][] = [
      [{ t: '◎ ', c: 'suggestion', bold: true }, { t: b.purpose, c: 'text', bold: true }],
      ...b.done.map((d, i): Seg[] => [{ t: '✓ ', c: 'success', bold: true }, { t: d, c: i === 0 ? 'text' : 'subtle' }]),
    ]

    const appLine: Seg[] = [
      { t: '▣ ', c: 'subtle' },
      { t: `${fmt(now - openedAt)} app`, c: 'subtle' },
      ...(tok > 0 ? [{ t: ' · ', c: 'subtle' }, { t: `◆ ${compact(tok)}`, c: 'merged', bold: true }] : []),
    ]
    const right: Seg[][] =
      startedAt === 0
        ? [[glass], [], []]
        : isIdle
          ? [
              [glass, gap, { t: '⏸ ', c: 'warning', bold: true }, { t: ` idle ${fmt(now - lastActive)} `, c: 'inverseText', bg: 'warning', bold: true }],
              [{ t: '◷ ', c: 'subtle' }, { t: 'last ', c: 'subtle' }, { t: fmt(lastActive - startedAt), c: 'text' }],
              appLine,
            ]
          : [
              [glass, gap, { t: ` ${fmt(now - startedAt)} `, c: 'inverseText', bg: 'suggestion', bold: true }, { t: ' work', c: 'subtle' }],
              [{ t: '◷ ', c: 'subtle' }, { t: 'since ', c: 'subtle' }, { t: clockTime(startedAt), c: 'text' }],
              appLine,
            ]

    // Fit the band: with little room the right column goes first, then the text is clipped.
    const rw = Math.max(0, ...right.map(r => cells(plain(r))))
    const room = cols - rw - 2
    const hasRight = room >= 16
    const avail = hasRight ? room : cols

    // Clip the last run of a line (the text, after its icon) to the room that is left.
    const fit = (line: Seg[], width: number): Seg[] => {
      const head = line.slice(0, -1)
      const last = line[line.length - 1]
      if (!last) return line
      // No room even for the icon: clip the whole line, in the icon's color.
      if (cells(plain(head)) + 1 > width) return [{ t: clip(plain(line), width), c: head[0]?.c ?? last.c }]
      return [...head, { ...last, t: clip(last.t, width - cells(plain(head))) }]
    }
    const refill = async () => {
      const at = await $.clock.now()
      await safely(async () => {
        await update($, water, () => ({ lastDrink: at }))
        await $.store.set('water', { lastDrink: at })
      })
      $.ui.toast('Glass refilled. Keep it up.', { timeoutMs: 2500 })
    }
    const runs = (line: Seg[]) =>
      line.map(x =>
        x.press ? (
          Svg ? (
            // Desktop / editor / mobile: the glass is an image; the card (absolute, so no height) holds the info and the button.
            <Box key="glass">
              <Svg source={glassSvg(level)} alt={`Water glass, ${Math.round(level * 100)}% full`} width={22} height={22} />
              <Box position="absolute" top={0} right={2} display="none" hover={{ display: 'flex' }}>
                <Text inverse>{` ${waterTip} `}</Text>
                <Button key="water" label={level <= 0 ? 'Drink and refill' : 'Refill glass'} onPress={refill} />
              </Box>
            </Box>
          ) : (
            // Terminal: a Button drawn from block characters, plus a hover card.
            <Box key="glass">
              <Button key="water" plain label="Water glass: click to refill" onPress={refill}>
                <Text color={x.c} bold={x.bold}>
                  {x.t}
                </Text>
              </Button>
              <Box position="absolute" top={0} right={cells(x.t)} display="none" hover={{ display: 'flex' }}>
                <Text inverse>{` ${waterTip} `}</Text>
              </Box>
            </Box>
          )
        ) : (
          <Text color={x.c} backgroundColor={x.bg} bold={x.bold}>
            {x.t}
          </Text>
        ),
      )

    return (
      <Box flexDirection="column">
        {left.map((l, i) => {
          const full = plain(l)
          const isCut = cells(full) > avail
          const hidden = !hasRight && plain(right[i] ?? []) !== ''
          const tip = `${full}${hidden ? `  ·  ${plain(right[i] ?? [])}` : ''}`
          return (
            <Box key={`row${i}`} flexDirection="column">
              <Box justifyContent="space-between">
                <Text>{runs(fit(l, avail))}</Text>
                <Box>{hasRight ? runs(right[i] ?? []) : <Text>{''}</Text>}</Box>
              </Box>
              {isCut || hidden ? (
                Svg ? (
                  // Native tooltip: absolute, so it adds no height and never leaves the band.
                  <Box position="absolute" top={0} left={0} width="100%" height={1}>
                    <Svg source={tooltipSvg(tip)} alt={tip} isInteractive />
                  </Box>
                ) : (
                  <Box display="none" hover={{ display: 'flex' }}>
                    <Text wrap="wrap" inverse>
                      {tip}
                    </Text>
                  </Box>
                )
              ) : null}
            </Box>
          )
        })}
        {below}
      </Box>
    )
  })
}
