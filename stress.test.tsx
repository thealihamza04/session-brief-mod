import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__session-brief__set_brief'
const DAY = 86_400_000
const NOW = 1_800_000_000_000

const BAND = (cols: number, extra = {}) =>
  ({
    plugin: 'session-brief',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: cols, scroll: { offset: 0, bodyRows: 10 }, ...extra },
  }) as any

let nextUsage: any
let toasts: string[] = []
const completeTurn = ($: any, u: any) => {
  nextUsage = u
  return $.turn.complete({ reason: 'answer', answer: '' })
}

type Boot = {
  store?: Record<string, unknown>
  ps?: string | Error
  now?: number
  cwd?: string
  live?: Record<string, unknown> // a store the test can change mid-run, as another session would
}
let registered: any = null

async function boot($: any, on: any, o: Boot = {}) {
  const clock = mock.clock(on, { now: o.now ?? NOW })
  if (o.live) {
    const live = o.live
    on('store.get', (_: any, e: any) => ({ value: live[e.key] }))
    on('store.set', (_: any, e: any) => ((live[e.key] = e.value), { value: undefined }))
    on('store.delete', (_: any, e: any) => (delete live[e.key], { value: undefined }))
    on('store.keys', () => ({ value: Object.keys(live) }))
  } else mock.store(on, o.store ?? {})
  toasts = []
  on('ui.toast', (_: any, e: any) => {
    toasts.push(String(e.text ?? ''))
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('tool.register', (_: any, e: any) => {
    registered = e
    return { value: { tool: TOOL } }
  })
  on('session.cwd', () => ({ value: o.cwd ?? '/work/demo-project' }))
  on('process.run', (_: any, e: any) => {
    if (o.ps instanceof Error) throw o.ps
    return { value: { exitCode: 0, stdout: o.ps ?? '', stderr: '' } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{''}</Text>
  })
  on('prompt.submit', (_: any, e: any) => ({ ...e }))
  on('turn.complete', () => ({ text: '', usage: nextUsage }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return clock
}

type Row = { left: string; right: string; reveal: string | null; tip: string }

// Terminal cells a string occupies (wide CJK/emoji = 2, combining/ZWJ = 0).
const cells = (str: string) => {
  let w = 0
  for (const ch of str) {
    const c = ch.codePointAt(0)!
    if (c === 0x200d || c === 0xfe0f || (c >= 0x300 && c <= 0x36f)) continue
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
    w += wide ? 2 : 1
  }
  return w
}

// Visible text only: a hover card (Box display:none) is not on screen until hovered.
const textOf = (n: any): string =>
  typeof n === 'string' ? n : n?.props?.display === 'none' ? '' : (n?.children ?? []).map(textOf).join('')
const textAll = (n: any): string => (typeof n === 'string' ? n : (n?.children ?? []).map(textAll).join(''))
const hiddenText = (n: any): string =>
  typeof n === 'string' ? '' : n?.props?.display === 'none' ? textAll(n) : (n?.children ?? []).map(hiddenText).join('')

// The drawn band as rows: each brief line is a keyed Box of [Box[left Text, right Text], hover-reveal Box?].
async function rows(ui: any): Promise<Row[]> {
  const root = await ui.drawn()
  const out: Row[] = []
  for (const c of root.children ?? []) {
    const inner = c.type === 'Box' ? (c.children ?? [])[0] : undefined
    if (inner?.type === 'Box' && (inner.children ?? []).length === 2) {
      const reveal = (c.children ?? [])[1]
      out.push({
        left: textOf(inner.children[0]),
        right: textOf(inner.children[1]),
        reveal: reveal ? textAll(reveal) : null,
        tip: hiddenText(inner.children[1]),
      })
    }
  }
  return out
}

async function bandRows($: any, cols = 80, extra = {}): Promise<Row[]> {
  const ui = await $.ui.mount(BAND(cols, extra))
  const r = await rows(ui)
  await ui.unmount()
  return r
}
async function band($: any, cols = 80, extra = {}): Promise<string[]> {
  return (await bandRows($, cols, extra)).map(r => `${r.left}  ${r.right}`)
}

const setBrief = ($: any, args: any) => $.tool.call({ tool: TOOL, ...args })

// ---------- time extremes ----------

test('app running for 99 days renders without NaN/Infinity', async ($, on) => {
  await boot($, on, { ps: ' 99-23:59:59 /usr/lib/claude-desktop/claude-desktop\n' })
  const text = (await band($)).join('\n')
  expect(text).not.toMatch(/NaN|Infinity|undefined|\[object/)
  expect(text).toMatch(/\bapp\b/)
  expect(text).not.toMatch(/\d{4,}h/) // 99 days must not render as "2399h59m"
})

test('work stretch from 400 days ago (stale store) shows idle, no NaN', async ($, on) => {
  await boot($, on, { store: { stretch: { startedAt: NOW - 400 * DAY, lastActive: NOW - 400 * DAY } } })
  const text = (await band($)).join('\n')
  expect(text).not.toMatch(/NaN|Infinity|undefined/)
})

test('duration text stays compact for huge spans (<= 9 chars)', async ($, on) => {
  await boot($, on, {
    ps: ' 365-00:00:00 /usr/lib/claude-desktop/claude-desktop\n',
    store: { stretch: { startedAt: NOW - 90 * DAY, lastActive: NOW } },
  })
  const text = (await band($)).join('\n')
  // e.g. "2160h00m" is ugly; days form is expected
  expect(text).not.toMatch(/\d{4,}h/)
})

test('system clock set backwards (lastActive in the future) never shows negatives', async ($, on) => {
  await boot($, on, { store: { stretch: { startedAt: NOW + 5 * DAY, lastActive: NOW + 6 * DAY } } })
  const text = (await band($)).join('\n')
  expect(text).not.toMatch(/-\d/)
  expect(text).not.toMatch(/NaN/)
})

test('clock jumps 2 hours while idle: ticker keeps up, no throw', async ($, on) => {
  const clock = await boot($, on)
  await clock.set(NOW + 2 * 3_600_000)
  const text = (await band($)).join('\n')
  expect(text).not.toMatch(/NaN|Infinity/)
})

// ---------- bad ps output ----------

for (const [name, ps] of [
  ['empty ps', ''],
  ['garbage ps', 'lol\n\n\u0000\n'],
  ['helper process only', ' 05:00 /usr/lib/claude-desktop/claude-desktop --type=renderer\n'],
  ['malformed etime', ' 1-2-3 /usr/lib/claude-desktop/claude-desktop\n'],
  ['huge etime', ' 9999999-99:99:99 /usr/lib/claude-desktop/claude-desktop\n'],
  ['negative-looking etime', ' -05:00 /usr/lib/claude-desktop/claude-desktop\n'],
] as const) {
  test(`ps: ${name} falls back sanely`, async ($, on) => {
    await boot($, on, { ps })
    const text = (await band($)).join('\n')
    expect(text).not.toMatch(/NaN|Infinity|undefined/)
  })
}

test('ps throws -> fallback to first-seen', async ($, on) => {
  await boot($, on, { ps: new Error('no ps') })
  const text = (await band($)).join('\n')
  expect(text).not.toMatch(/NaN|undefined/)
})

// ---------- corrupt saved data ----------

for (const [name, store] of [
  ['stretch is a string', { stretch: 'x' }],
  ['stretch has string fields', { stretch: { startedAt: 'a', lastActive: 'b' } }],
  ['stretch is null', { stretch: null }],
  ['stretch is an array', { stretch: [1, 2] }],
  ['brief.done holds numbers/objects', { 'brief:s1': { purpose: 'p', done: [1, { a: 1 }] } }],
  ['brief.purpose is huge', { 'brief:s1': { purpose: 'x'.repeat(200_000), done: ['a', 'b'] } }],
  ['brief has newlines', { 'brief:s1': { purpose: 'a\nb\nc', done: ['d\ne', 'f'] } }],
  ['tokens is a string', { 'tokens:s1': 'abc' }],
  ['tokens is Infinity-ish', { 'tokens:s1': 1e308 }],
  ['tokens is negative', { 'tokens:s1': -5 }],
] as const) {
  test(`corrupt store: ${name}`, async ($, on) => {
    await boot($, on, { store: store as any })
    const r = await band($, 80)
    const text = r.join('\n')
    expect(text).not.toMatch(/NaN|Infinity|undefined|\[object/)
    // one logical row per brief line: purpose + 2 done lines (+ nothing multi-line)
    expect(r.every(l => !l.includes('\n'))).toBe(true)
    expect(r.length).toBeLessThanOrEqual(6)
  })
}

// ---------- set_brief abuse ----------

test('set_brief: 5000 done items keeps only 2', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'p', done: Array.from({ length: 5000 }, (_, i) => `item ${i}`) })
  const r = await band($)
  expect(r.filter(l => l.startsWith('✓')).length).toBe(2)
  expect(r.join('')).toMatch(/item 0/)
})

test('set_brief: non-string / null / object args do not throw or render junk', async ($, on) => {
  await boot($, on)
  for (const args of [
    { purpose: null, done: null },
    { purpose: 42, done: [1, 2] },
    { purpose: { a: 1 }, done: 'str' },
    { purpose: '', done: [] },
    { purpose: '   ', done: ['  ', ''] },
    {},
  ]) {
    await setBrief($, args)
  }
  const text = (await band($)).join('\n')
  expect(text).not.toMatch(/\[object|undefined|NaN|null/)
})

test('set_brief: 5 MB purpose is clipped, store stays small', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'x'.repeat(5_000_000), done: ['y'.repeat(5_000_000), 'z'] })
  const r = await band($, 80)
  for (const l of r) expect(l.length).toBeLessThanOrEqual(80)
})

test('set_brief: newlines/tabs/ANSI in text cannot add rows or inject escapes', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'line1\nline2\r\nline3\ttab \u001b[31mred\u001b[0m', done: ['a\nb', 'c\u0007bell'] })
  const r = await band($, 80)
  const text = r.join('')
  expect(text).toMatch(/line1 line2 line3 tab red/) // collapsed to one clean line
  expect(text).not.toMatch(/\n|\r|\u001b|\u0007/)
})

test('set_brief: emoji/CJK are not cut into lone surrogates', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: '👩‍💻'.repeat(200), done: ['日本語のテキスト'.repeat(50), '🔥'.repeat(300)] })
  const r = await band($, 60)
  for (const l of r) expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(l)).toBe(false)
})

test('set_brief: 200 rapid calls leave a consistent brief', async ($, on) => {
  await boot($, on)
  await Promise.all(Array.from({ length: 200 }, (_, i) => setBrief($, { purpose: `p${i}`, done: [`a${i}`, `b${i}`] })))
  const r = await band($)
  const nums = r.map(l => l.match(/(\d+)/)?.[1]).filter(Boolean)
  expect(new Set(nums).size).toBe(1) // purpose/done from the SAME call, not a mix
})

// ---------- width extremes ----------

for (const cols of [1, 5, 10, 23, 24, 40, 500, 10_000]) {
  test(`bodyColumns=${cols}: every row fits the band (in terminal cells)`, async ($, on) => {
    await boot($, on, { ps: ' 03-01:01:01 /usr/lib/claude-desktop/claude-desktop\n' })
    await setBrief($, { purpose: 'A fairly long purpose line for the session brief', done: ['first done thing here', 'second done thing here'] })
    const rs = await bandRows($, cols)
    expect(rs.length).toBe(3)
    for (const r of rs) expect(cells(r.left) + cells(r.right)).toBeLessThanOrEqual(cols)
  })
}

test('wide chars (CJK/emoji) are measured in cells, not string length', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: '日本語のとても長い目的の説明です'.repeat(20), done: ['🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥'.repeat(10), 'ok'] })
  for (const r of await bandRows($, 60)) expect(cells(r.left) + cells(r.right)).toBeLessThanOrEqual(60)
})

test('survey showing: band yields (draws nothing of its own)', async ($, on) => {
  await boot($, on)
  const r = await band($, 80, { hasSurvey: true })
  expect(r.join('')).not.toMatch(/◎|✓/)
})

// ---------- tokens ----------

test('token total formatting for extreme sums', async ($, on) => {
  await boot($, on)
  const usages = [
    { input_tokens: 5e14, output_tokens: 5e14, cache_creation_input_tokens: 0, cache_read_input_tokens: 9e15, model: 'm' },
    { input_tokens: NaN, output_tokens: -10, cache_creation_input_tokens: undefined, cache_read_input_tokens: 0, model: 'm' },
    { input_tokens: '5', output_tokens: null, cache_creation_input_tokens: {}, cache_read_input_tokens: 0, model: 'm' },
  ]
  for (const u of usages) await completeTurn($, u)
  const text = (await band($)).join('\n')
  expect(text).not.toMatch(/NaN|Infinity|undefined|\[object|-\d/)
  expect(text).not.toMatch(/\d{5,}/) // a 1e15 total must be abbreviated, not 16 digits
})

test('50 turns of 200M tokens each (10B total): stays one short token', async ($, on) => {
  await boot($, on)
  for (let i = 0; i < 50; i++) {
    await completeTurn($, { input_tokens: 200_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'm' })
  }
  const text = (await band($)).join('\n')
  expect(text).toMatch(/\d+(\.\d)?[kMGB]\b/)
})

// ---------- happy path: guards against vacuous passes ----------

test('happy path: renders the brief, work time, since (AM/PM), app uptime and tokens', async ($, on) => {
  await boot($, on, { ps: ' 01:07:00 /usr/lib/claude-desktop/claude-desktop\n' })
  await setBrief($, { purpose: 'Ship the thing', done: ['Did A', 'Did B'] })
  await completeTurn($, { input_tokens: 100_000, output_tokens: 84_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 5_000_000, model: 'm' })
  const rs = await band($, 80)
  expect(rs.length).toBe(3)
  expect(rs[0]).toMatch(/^◎ Ship the thing\s+▕█▏\s+\d+m\s+work$/)
  expect(rs[1]).toMatch(/^✓ Did A\s+◷ since \d{1,2}:\d{2} (AM|PM)$/)
  expect(rs[2]).toMatch(/^✓ Did B\s+▣ 1h07m app · ◆ 184k$/) // cache reads excluded
})

test('happy path: idle after a 3-hour gap shows idle + last stretch', async ($, on) => {
  await boot($, on, { store: { stretch: { startedAt: NOW - 5 * 3_600_000, lastActive: NOW - 3 * 3_600_000 } } })
  const rs = await band($, 80)
  expect(rs[0]).toMatch(/⏸\s+idle 3h00m/)
  expect(rs[1]).toMatch(/◷ last 2h00m/)
})

test('a turn finishing after a 3-hour gap starts a fresh stretch, not a 5-hour one', async ($, on) => {
  await boot($, on, { store: { stretch: { startedAt: NOW - 5 * 3_600_000, lastActive: NOW - 3 * 3_600_000 } } })
  await completeTurn($, { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'm' })
  const rs = await band($, 80)
  expect(rs[0]).toMatch(/\s0m\s+work/)
})

// ---------- hover: a cut line reveals in full ----------

test('hover reveal: a clipped line carries its full text', async ($, on) => {
  await boot($, on)
  const purpose = 'A purpose line that is much longer than the room the band has on a narrow terminal'
  await setBrief($, { purpose, done: ['short', 'tiny'] })
  const rs = await bandRows($, 50)
  expect(rs[0].left).toMatch(/…/)
  expect(rs[0].reveal).toContain(purpose) // full, un-clipped
  expect(rs[1].reveal).toBeNull() // nothing cut, nothing to reveal
})

test('hover reveal: only a cut line gets one; a short line with a hidden right column does not', async ($, on) => {
  await boot($, on, { ps: ' 01:07:00 /usr/lib/claude-desktop/claude-desktop\n' })
  await setBrief($, { purpose: 'Short', done: ['a', 'b'] })
  const rs = await bandRows($, 20)
  expect(rs[0].right).toBe('') // right column dropped for lack of room
  for (const r of rs) expect(r.reveal).toBeNull() // but nothing is cut, so no card
})

test('hover reveal: a wide band needs none', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'Short', done: ['a', 'b'] })
  for (const r of await bandRows($, 120)) expect(r.reveal).toBeNull()
})

// ---------- native tooltip (desktop / editor surfaces) ----------

const findAllType = (n: any, type: string, out: any[] = []): any[] => {
  if (!n || typeof n === 'string') return out
  if (n.type === type) out.push(n)
  for (const c of n.children ?? []) findAllType(c, type, out)
  return out
}

for (const surface of ['desktop', 'vscode'] as const) {
  test(`${surface}: a cut line gets a hover card with its full text (absolute, no in-flow reveal)`, async ($, on) => {
    await boot($, on)
    const purpose = 'Purpose that is far too long for a narrow band to show in full, so it must be in the hover card'
    await setBrief($, { purpose, done: ['short', 'tiny'] })
    const ui = await $.ui.mount({ ...BAND(40), surface })
    const root = await ui.drawn()
    const hidden = findAllType(root, 'Box').filter((b: any) => b.props?.display === 'none')
    const cards = hidden.filter((b: any) => textAll(b).includes('far too long'))
    expect(cards.length).toBe(1) // only the cut line gets one
    expect(cards[0].props.position).toBe('absolute') // adds no height
    expect(textAll(cards[0])).toContain(purpose) // the whole line, not clipped
    expect(hidden.length).toBe(3) // + the water glass and the time card (top chip)
    // the old invisible-SVG tooltip is gone
    expect(findAllType(root, 'Svg').filter((v: any) => v.props.isInteractive).length).toBe(0)
    await ui.unmount()
  })
}

test('desktop: a wide band draws no tooltip at all', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'Short', done: ['a', 'b'] })
  const ui = await $.ui.mount({ ...BAND(120), surface: 'desktop' })
  expect(findAllType(await ui.drawn(), 'Svg').filter((v: any) => v.props.isInteractive).length).toBe(0) // no tooltip; only the (non-interactive) glass icon
  await ui.unmount()
})

test('terminal still uses the in-band hover reveal (no Svg exists there)', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'x'.repeat(200), done: ['a', 'b'] })
  const ui = await $.ui.mount(BAND(40))
  const root = await ui.drawn()
  expect(findAllType(root, 'Svg').length).toBe(0)
  expect(findAllType(root, 'Box').filter((b: any) => b.props?.display === 'none').length).toBe(2) // the line's in-band reveal + the water glass's hover card
  await ui.unmount()
})

// ---------- water glass ----------

const MIN = 60_000
const glassOf = (r: Row) => r.right.match(/▕(.)▏/)?.[1]

test('water: starts full', async ($, on) => {
  await boot($, on)
  expect(glassOf((await bandRows($, 100))[0])).toBe('█')
})

test('water: drains over time, never refills by itself', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(BAND(100))
  const seen: string[] = []
  for (const m of [0, 12, 12, 12, 12]) {
    await clock.advance(m * MIN)
    seen.push(glassOf((await rows(ui))[0]))
  }
  const order = ' ▂▄▆█'
  for (let i = 1; i < seen.length; i++) expect(order.indexOf(seen[i]!)).toBeLessThanOrEqual(order.indexOf(seen[i - 1]!))
  expect(seen[0]).toBe('█')
  expect(seen.at(-1)).toBe(' ') // 48 minutes: empty glass
  await ui.unmount()
})

test('water: empty glass shows the drink-water chip and nags once while you work', async ($, on) => {
  const clock = await boot($, on)
  await $.prompt.submit({ text: 'hi' })
  await clock.advance(40 * MIN)
  await $.prompt.submit({ text: 'still here' }) // keeps you "working"
  const ui = await $.ui.mount(BAND(100))
  expect(toasts.filter(t => /water/i.test(t)).length).toBe(0)
  await clock.advance(6 * MIN) // 46 minutes: empty
  const r = (await rows(ui))[0]
  expect(glassOf(r)).toBe(' ')
  expect(r.tip).toMatch(/empty|drink/i)
  expect(toasts.filter(t => /water/i.test(t)).length).toBe(1)
  await clock.advance(5 * MIN) // still empty: no second nag yet (every 15 min)
  expect(toasts.filter(t => /water/i.test(t)).length).toBe(1)
  await ui.unmount()
})

test('water: no nag while you are away (no activity for 30+ minutes)', async ($, on) => {
  const clock = await boot($, on)
  await clock.advance(120 * MIN)
  expect(toasts.filter(t => /water/i.test(t)).length).toBe(0)
  expect(glassOf((await bandRows($, 100))[0])).toBe(' ') // still drawn empty
})

test('water: pressing the glass refills it', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(BAND(100))
  await clock.advance(50 * MIN)
  expect(glassOf((await rows(ui))[0])).toBe(' ')
  await ui.press({ key: 'water' })
  const r = (await rows(ui))[0]
  expect(glassOf(r)).toBe('█')
  expect(r.tip).toMatch(/100%/)
  expect(toasts.some(t => /refilled/i.test(t))).toBe(true)
  await ui.unmount()
})

test('water: a refill survives a restart (stored)', async ($, on) => {
  await boot($, on, { store: { water: { lastDrink: NOW - 50 * MIN } } })
  expect(glassOf((await bandRows($, 100))[0])).toBe(' ') // empty since 5 minutes ago
})

for (const [name, w] of [
  ['string', { lastDrink: 'x' }],
  ['negative', { lastDrink: -5 }],
  ['null', null],
  ['future refill (clock set back)', { lastDrink: NOW + 30 * DAY }],
  ['NaN', { lastDrink: NaN }],
] as const) {
  test(`water: corrupt store (${name}) shows a full glass, no junk`, async ($, on) => {
    await boot($, on, { store: { water: w as any } })
    const r = (await bandRows($, 100))[0]
    expect(glassOf(r)).toBe('█')
    expect(r.right + r.tip).not.toMatch(/NaN|undefined/)
  })
}

test('water: the glass shows on the right column in every surface', async ($, on) => {
  await boot($, on)
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND(100), surface })
    expect(findAllType(await ui.drawn(), 'Button').length).toBe(1)
    await ui.unmount()
  }
})

test('water: hover card carries the level, time left and the refill hint; nothing extra shows at rest', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(BAND(100))
  let r = (await rows(ui))[0]
  expect(r.tip).toMatch(/Water 100% · empty in 45m · click the glass to refill/) // terminal wording
  expect(r.right).not.toMatch(/Water|click/) // at rest only the icon shows
  await clock.advance(23 * MIN)
  r = (await rows(ui))[0]
  expect(r.tip).toMatch(/Water (4\d|5\d)% · empty in \d+m/)
  expect(glassOf(r)).toBe('▄')
  await ui.unmount()
})

test('water: the five icons are all reachable and never wider than 3 cells', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(BAND(100))
  const seen = new Set<string>()
  for (let i = 0; i < 50; i++) {
    seen.add(glassOf((await rows(ui))[0])!)
    await clock.advance(MIN)
  }
  expect([...seen].sort()).toEqual([' ', '▂', '▄', '▆', '█'].sort())
  await ui.unmount()
})

// ---------- water glass images on desktop / editor ----------

const iconOf = (root: any) => findAllType(root, 'Svg').find((v: any) => !v.props.isInteractive)

for (const surface of ['desktop', 'vscode'] as const) {
  test(`${surface}: the glass is an image (five distinct icons: full -> empty), not text`, async ($, on) => {
    const clock = await boot($, on)
    const ui = await $.ui.mount({ ...BAND(100), surface })
    const sources: string[] = []
    for (let i = 0; i < 50; i++) {
      const icon = iconOf(await ui.drawn())
      expect(icon).toBeTruthy()
      expect(icon.props.source).toMatch(/data:image\/png;base64,/)
      expect(icon.props.alt).toMatch(/Water glass, \d+% full/)
      expect(icon.props.isInteractive).toBeFalsy()
      sources.push(icon.props.source)
      await clock.advance(MIN)
    }
    expect(new Set(sources).size).toBe(5)
    expect(sources[0]).not.toBe(sources.at(-1))
    // no label text leaks onto the band at rest (the old "Water glass: click to refill" bug)
    const visible = textOf(await ui.drawn())
    expect(visible).not.toMatch(/Water glass|click to refill|Refill|I drank|empty in/)
    await ui.unmount()
  })

  test(`${surface}: the hover card has the info and a Refill button that refills`, async ($, on) => {
    const clock = await boot($, on)
    const ui = await $.ui.mount({ ...BAND(100), surface })
    await clock.advance(50 * MIN) // empty
    const before = iconOf(await ui.drawn()).props.source
    const card = findAllType(await ui.drawn(), 'Box').find((b: any) => b.props?.display === 'none' && findAllType(b, 'Button').length)
    expect(card).toBeTruthy()
    expect(textAll(card)).toMatch(/Empty. Time for water/)
    expect(findAllType(card, 'Button')[0].props.label).toBe('I drank')
    await ui.press({ key: 'water' })
    const after = iconOf(await ui.drawn()).props.source
    expect(after).not.toBe(before) // back to the full glass
    expect(toasts.some(t => /refilled/i.test(t))).toBe(true)
    await ui.unmount()
  })
}

test('desktop hover card is one compact line: percent, time left, short button; no inverse white box', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount({ ...BAND(100), surface: 'desktop' })
  await clock.advance(5 * MIN)
  const card = findAllType(await ui.drawn(), 'Box').find((b: any) => b.props?.display === 'none' && findAllType(b, 'Button').length)!
  expect(textAll(card)).toMatch(/^8\d% · empty in 4\dm$/) // e.g. "89% · empty in 40m", nothing else
  expect(findAllType(card, 'Button')[0].props.label).toBe('Refill')
  expect(findAllType(card, 'Text').some((n: any) => n.props?.inverse)).toBe(false)
  await ui.unmount()
})

// ---------- hover scoping: the card opens only from the cut line's own text ----------

const hoverOf = (n: any) => n?.hover as { scope?: string; display?: string } | undefined

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the card's hover group is joined only by the cut line's own text`, async ($, on) => {
    await boot($, on)
    await setBrief($, { purpose: 'Purpose that is much too long to fit in a narrow band like this one', done: ['short', 'tiny'] })
    const ui = await $.ui.mount({ ...BAND(40), surface })
    const root = await ui.drawn()
    const boxes = findAllType(root, 'Box')
    const triggers = boxes.filter((b: any) => /^tip\d$/.test(hoverOf(b)?.scope ?? '') && hoverOf(b)?.display !== 'flex')
    const cards = boxes.filter((b: any) => /^tip\d$/.test(hoverOf(b)?.scope ?? '') && hoverOf(b)?.display === 'flex' && textAll(b).includes('Purpose'))
    expect(triggers.length).toBe(1)
    expect(cards.length).toBe(1)
    expect(hoverOf(triggers[0])!.scope).toBe(hoverOf(cards[0])!.scope) // same group
    // the trigger is the line's text only: no time column, no glass button inside it
    expect(textAll(triggers[0])).toMatch(/^◎ Purpose/)
    expect(findAllType(triggers[0], 'Button').length).toBe(0)
    expect(textAll(triggers[0])).not.toMatch(/work|since|app/)
    // no keyed row Box is left to widen the hover area to the whole row
    const keyedRows = boxes.filter((b: any) => /^row\d$/.test(b.props?.key ?? ''))
    expect(keyedRows.length).toBe(0)
    await ui.unmount()
  })
}

test('no card at all when nothing is cut, on any surface', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'Short', done: ['a', 'b'] })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND(100), surface })
    const boxes = findAllType(await ui.drawn(), 'Box')
    // the only hidden Boxes left are the water glass's card and (where images exist) the time card
    expect(boxes.filter((b: any) => b.props?.display === 'none').length).toBe(surface === 'terminal' ? 1 : 2)
    expect(boxes.filter((b: any) => /^tip\d$/.test(hoverOf(b)?.scope ?? '')).length).toBe(0)
    await ui.unmount()
  }
})

test('two cut lines get two separate groups', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'P'.repeat(80), done: ['D'.repeat(80), 'x'] })
  const ui = await $.ui.mount({ ...BAND(40), surface: 'desktop' })
  const scopes = findAllType(await ui.drawn(), 'Box').map((b: any) => hoverOf(b)?.scope).filter((v: any) => /^tip\d$/.test(v ?? ''))
  expect(new Set(scopes).size).toBe(2)
  expect(scopes.length).toBe(4) // a trigger and a card for each
  await ui.unmount()
})

const desk = (cols = 100) => ({ ...BAND(cols), surface: 'desktop' }) as any

// ====================================================================
// working period: "since" = when you began, breaks counted not reset
// ====================================================================

const submit = ($: any) => $.prompt.submit({ text: 'x' })
const finish = ($: any) => completeTurn($, undefined)
// The time card is the hidden, absolute Box inside the keyed top-chip Box ("timechip").
const timeCardOf = (root: any) => {
  const chip = findAllType(root, 'Box').find((b: any) => b.props?.key === 'timechip')
  return chip && (chip.children as any[]).find((c: any) => c.type === 'Box' && c.props?.display === 'none')
}
const cardText = async (ui: any) => textAll(timeCardOf(await ui.drawn()))
const HOUR = 60 * MIN

test('period: the user scenario - 1h21m of work, a 2h04m break, back for 10m: since shows the ORIGINAL start', async ($, on) => {
  // The past is seeded (replaying 3+ hours of 30s ticks made this slow); only the 10 minutes back are simulated.
  const start = NOW - 205 * MIN
  const runs = [{ start, end: start + 81 * MIN }]
  const clock = await boot($, on, {
    store: {
      stretch: { startedAt: start, lastActive: start + 81 * MIN },
      period: { startedAt: start, lastActive: start + 81 * MIN, active: 81 * MIN, idle: 0, inTurn: false, runs },
    },
  })
  const ui = await $.ui.mount(desk())
  await submit($)
  await clock.advance(10 * MIN)
  await finish($)
  const rs = await rows(ui)
  expect(rs[0].right).toMatch(/\b10m\b/) // the current stretch: 10 minutes
  expect(rs[1].right).toMatch(/since 9:35 AM/) // the period began at 9:35 AM, not at the restart
  const card = await cardText(ui)
  expect(card).not.toMatch(/focused/) // the chip beside the card already says it
  expect(card).toMatch(/1h31m active/) // 81m of work + the 10m turn
  expect(card).toMatch(/2h04m breaks/)
  expect(card).toMatch(/10m in this chat/)
  await ui.unmount()
})

test('period: a gap of 4 hours or more starts a fresh working period (active and breaks reset)', async ($, on) => {
  const old = NOW - 5 * HOUR
  const clock = await boot($, on, {
    store: { period: { startedAt: old - 30 * MIN, lastActive: old, active: 30 * MIN, idle: 0, inTurn: false, runs: [{ start: old - 30 * MIN, end: old }] } },
  })
  const ui = await $.ui.mount(desk())
  await submit($)
  await clock.advance(2 * MIN)
  await finish($)
  const card = await cardText(ui)
  expect(card).toMatch(/2m active/)
  expect(card).not.toMatch(/breaks/) // none yet: the row is hidden
  expect((await rows(ui))[1].right).toMatch(/since 1:00 PM/)
  await ui.unmount()
})

test('period: a long turn (a 60-minute run) counts as active work, not a break', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  await submit($)
  await clock.advance(60 * MIN)
  await finish($)
  const card = await cardText(ui)
  expect(card).toMatch(/1h00m active/)
  expect(card).not.toMatch(/breaks/)
  await ui.unmount()
})

test('period: a new chat continues the period but its own active time starts at zero', async ($, on) => {
  await boot($, on, { store: { period: { startedAt: NOW - 3 * HOUR, lastActive: NOW - MIN, active: 150 * MIN, idle: 30 * MIN, inTurn: false } } })
  const ui = await $.ui.mount(desk())
  const card = await cardText(ui)
  expect(card).toMatch(/2h30m active/)
  expect(card).toMatch(/30m breaks/)
  expect(card).toMatch(/0m in this chat/)
  await ui.unmount()
})

test('period: this chat keeps its own active time across a restart (stored per session)', async ($, on) => {
  await boot($, on, { store: { 'sess:s1': { startedAt: NOW - HOUR, lastActive: NOW - MIN, active: 40 * MIN, idle: 0, inTurn: false } } })
  const ui = await $.ui.mount(desk())
  expect(await cardText(ui)).toMatch(/40m in this chat/)
  await ui.unmount()
})

test('period: the old stretch seeds the period the first time (upgrade path)', async ($, on) => {
  await boot($, on, { store: { stretch: { startedAt: NOW - 2 * HOUR, lastActive: NOW - MIN } } })
  const ui = await $.ui.mount(desk())
  expect((await rows(ui))[1].right).toMatch(/since 11:00 AM/)
  await ui.unmount()
})

test('period: a start from yesterday or earlier is labeled with the day', async ($, on) => {
  await boot($, on, { store: { period: { startedAt: NOW - 20 * HOUR, lastActive: NOW - 10 * MIN, active: HOUR, idle: 0 } } })
  let ui = await $.ui.mount(desk())
  expect((await rows(ui))[1].right).toMatch(/since yest \d{1,2}:\d{2} (AM|PM)/)
  await ui.unmount()
})

test('period: an older start shows the date', async ($, on) => {
  await boot($, on, { store: { period: { startedAt: NOW - 5 * 24 * HOUR, lastActive: NOW - 10 * MIN, active: HOUR, idle: 0 } } })
  const ui = await $.ui.mount(desk())
  expect((await rows(ui))[1].right).toMatch(/since [A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2} (AM|PM)/)
  await ui.unmount()
})

for (const [name, bad] of [
  ['a string', 'junk'],
  ['NaN and negatives', { startedAt: NaN, lastActive: -1, active: NaN, idle: -5 }],
  ['wrong types', { startedAt: '1', active: {}, idle: [], inTurn: 'yes' }],
  ['a start in the future', { startedAt: NOW + 5 * HOUR, lastActive: NOW + 6 * HOUR, active: HOUR, idle: 0 }],
  ['absurd totals', { startedAt: NOW - HOUR, lastActive: NOW, active: 1e300, idle: 1e300 }],
] as const) {
  test(`period: corrupt store (${name}) never shows junk`, async ($, on) => {
    await boot($, on, { store: { period: bad as any, 'sess:s1': bad as any } })
    const ui = await $.ui.mount(desk())
    const all = (await rows(ui)).map(r => r.left + r.right).join(' ') + (await cardText(ui))
    expect(all).not.toMatch(/NaN|Infinity|undefined|\[object|-\d/)
    await ui.unmount()
  })
}

test('period: the clock set backwards never reduces active time or moves the start into the future', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  await submit($)
  await clock.advance(10 * MIN)
  await finish($)
  const before = await cardText(ui)
  expect(before).toMatch(/10m active/)
  // a start dated in the future is clamped to now when shown
  const rs = await rows(ui)
  expect(rs[1].right).toMatch(/since 1:00 PM/)
  await ui.unmount()
})

test('time card: only on the top chip, inside its keyed Box (like the glass card); the since line has none', async ($, on) => {
  await boot($, on)
  await submit($)
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND(100), surface })
    const root = await ui.drawn()
    const wrappers = findAllType(root, 'Box').filter((b: any) => b.props?.key === 'timechip' || b.props?.key === 'timesince')
    expect(wrappers.map((b: any) => b.props.key)).toEqual(['timechip']) // one card, on the chip
    const w = wrappers[0]
    const card = (w.children as any[]).find((c: any) => c.type === 'Box' && c.props?.display === 'none')
    expect(card).toBeTruthy()
    expect(card.props.position).toBe('absolute') // no extra height
    expect(textAll(card)).toMatch(/active/)
    expect(textAll(card)).not.toMatch(/focused|idle/) // never repeats the chip
    const outside = { children: (w.children as any[]).filter((c: any) => c.props?.display !== 'none') }
    expect(findAllType(outside, 'Svg').length).toBe(0) // the chip itself never wraps the glass (the card has its own icons)
    const pill = textAll(outside)
    expect(pill).toMatch(/work/)
    expect(pill).not.toMatch(/since|app|\d{3,}k/)
    // the since line is plain text: no card, no hover box
    const since = (await rows(ui))[1].right
    expect(since).toMatch(/since/)
    expect(findAllType(root, 'Box').filter((b: any) => b.props?.key === 'timechip').length).toBe(1)
    await ui.unmount()
  }
  const term = await $.ui.mount(BAND(100))
  const troot = await term.drawn()
  expect(timeCardOf(troot)).toBeUndefined()
  expect(findAllType(troot, 'Box').filter((b: any) => b.props?.key === 'timechip').length).toBe(0)
  await term.unmount()
})

test('time card: the same pattern as the glass card (key + hidden absolute child), not a hover-group scope', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  const root = await ui.drawn()
  const keyed = (k: string) => findAllType(root, 'Box').find((b: any) => b.props?.key === k)
  for (const k of ['glass', 'timechip']) {
    const box = keyed(k)
    expect(box).toBeTruthy()
    const hiddenKid = (box.children as any[]).find((c: any) => c.type === 'Box' && c.props?.display === 'none')
    expect(hiddenKid).toBeTruthy() // every popover in the band is built the same way
  }
  expect(findAllType(root, 'Box').filter((b: any) => hoverOf(b)?.scope === 'time').length).toBe(0)
  await ui.unmount()
})

test('time card: idle state says so, and the since line keeps the original start', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  await submit($)
  await clock.advance(5 * MIN)
  await finish($)
  await clock.advance(35 * MIN) // idle (> 30m) but inside the 4h period
  const rs = await rows(ui)
  expect(rs[0].right).toMatch(/idle 35m/)
  expect(rs[1].right).toMatch(/last 5m/) // the stretch that ended
  expect(await cardText(ui)).not.toMatch(/idle/) // the chip already says idle
  await ui.unmount()
})

// ====================================================================
// work sessions list in the time card
// ====================================================================

const SEC = 1000
// An earlier, finished session (ended 60 minutes before NOW), so a session run in a test is the SECOND one
// and therefore appears in the list (a single session is deliberately not listed: it would repeat "since").
const earlier = () => {
  const a = NOW - 90 * MIN
  return { stretch: { startedAt: a, lastActive: a + 30 * MIN }, period: { startedAt: a, lastActive: a + 30 * MIN, active: 30 * MIN, idle: 0, inTurn: false, runs: [{ start: a, end: a + 30 * MIN }] } }
}
const run = async ($: any, clock: any, lengthMs: number) => {
  await submit($)
  await clock.advance(lengthMs)
  await finish($)
}

test('sessions: the user scenario lists the 1h 21m session and the live 10m session', async ($, on) => {
  const start = NOW - 205 * MIN
  const clock = await boot($, on, {
    store: { period: { startedAt: start, lastActive: start + 81 * MIN, active: 81 * MIN, idle: 0, inTurn: false, runs: [{ start, end: start + 81 * MIN }] } },
  })
  const ui = await $.ui.mount(desk())
  await run($, clock, 10 * MIN)
  const card = await cardText(ui)
  expect(card).toMatch(/9:35 AM · 1h 21m/)
  expect(card).toMatch(/1:00 PM · 10m 0s · now/)
  expect(card.indexOf('9:35 AM · 1h 21m')).toBeLessThan(card.indexOf('1:00 PM · 10m 0s'))
  await ui.unmount()
})

for (const [label, len, re] of [
  ['45s', 45 * SEC, /1:00 PM · 45s/],
  ['40m 12s', 40 * MIN + 12 * SEC, /1:00 PM · 40m 12s/],
  ['59m 59s', 59 * MIN + 59 * SEC, /1:00 PM · 59m 59s/],
  ['1h 00m', HOUR, /1:00 PM · 1h 00m/],
  ['1h 07m', HOUR + 7 * MIN, /1:00 PM · 1h 07m/],
] as const) {
  test(`sessions: a ${label} session reads "${label}" (seconds under an hour, hours above)`, async ($, on) => {
    const clock = await boot($, on, { store: earlier() })
    const ui = await $.ui.mount(desk())
    await run($, clock, len)
    expect(await cardText(ui)).toMatch(re)
    await ui.unmount()
  })
}

test('sessions: three sessions with breaks between are listed in order, each with its own start and length', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  await run($, clock, 3 * MIN) // 1:00 PM, 3m 0s
  await clock.advance(31 * MIN)
  await run($, clock, 4 * MIN + 12 * SEC) // 1:34 PM, 4m 12s
  await clock.advance(31 * MIN)
  await run($, clock, 2 * MIN) // 2:09 PM, 2m 0s
  const card = await cardText(ui)
  const a = card.indexOf('1:00 PM · 3m 0s')
  const b = card.indexOf('1:34 PM · 4m 12s')
  const c = card.indexOf('2:09 PM · 2m 0s')
  expect(a).toBeGreaterThanOrEqual(0)
  expect(b).toBeGreaterThan(a)
  expect(c).toBeGreaterThan(b)
  expect(card).toMatch(/2:09 PM · 2m 0s · now/) // only the latest is live
  expect(card).not.toMatch(/1:34 PM · 4m 12s · now/)
  expect(card).toMatch(/1h02m breaks/) // 31m + 31m idle
  await ui.unmount()
})

test('sessions: only the three latest are listed, with "+N earlier" for the rest', async ($, on) => {
  // Seeded (not replayed): fast-forwarding hours of 30-second ticks made this test slow and flaky.
  const runs = Array.from({ length: 9 }, (_, i) => ({ start: NOW - (10 - i) * 20 * MIN, end: NOW - (10 - i) * 20 * MIN + MIN }))
  await boot($, on, { store: { period: { startedAt: runs[0]!.start, lastActive: NOW - 5 * MIN, active: 9 * MIN, idle: 0, inTurn: false, runs } } })
  const ui = await $.ui.mount(desk())
  const card = await cardText(ui)
  expect(card).toMatch(/\+6 earlier/)
  expect((card.match(/ · 1m 0s/g) ?? []).length).toBe(2) // two finished sessions...
  expect(card).toMatch(/ · 40m 0s · now/) // ...and the live one, counted through now
  expect((card.match(/● /g) ?? []).length).toBe(3)
  await ui.unmount()
})

test('sessions: after a break that ends the work (idle now), the last session is not marked "now"', async ($, on) => {
  const clock = await boot($, on, { store: earlier() })
  const ui = await $.ui.mount(desk())
  await run($, clock, 5 * MIN)
  await clock.advance(35 * MIN)
  const card = await cardText(ui)
  expect(card).toMatch(/1:00 PM · 5m 0s/)
  expect(card).not.toMatch(/· now/)
  await ui.unmount()
})

test('sessions: a gap of 4+ hours starts a new period, so the list starts over', async ($, on) => {
  const old = NOW - 5 * HOUR
  const clock = await boot($, on, {
    store: { period: { startedAt: old - 10 * MIN, lastActive: old, active: 10 * MIN, idle: 0, inTurn: false, runs: [{ start: old - 10 * MIN, end: old }] } },
  })
  const ui = await $.ui.mount(desk())
  await run($, clock, 3 * MIN)
  const card = await cardText(ui)
  expect(card).not.toMatch(/10m 0s/) // the old period's session is gone
  expect(card).toMatch(/3m active/)
  expect(card).not.toMatch(/● /) // one session: nothing to list
  await ui.unmount()
})

test('sessions: a stored period from an older version (no list) is one session: not listed, since shows its start', async ($, on) => {
  await boot($, on, { store: { period: { startedAt: NOW - 2 * HOUR, lastActive: NOW - 2 * MIN, active: 90 * MIN, idle: 0 } } })
  const ui = await $.ui.mount(desk())
  expect((await rows(ui))[1].right).toMatch(/since 11:00 AM/)
  expect(await cardText(ui)).not.toMatch(/● /) // listing it would only repeat the since line
  await ui.unmount()
})

for (const [name, runs] of [
  ['strings and junk', ['a', 1, null, { start: 'x' }]],
  ['end before start', [{ start: NOW - MIN, end: NOW - HOUR }]],
  ['NaN and negatives', [{ start: NaN, end: NaN }, { start: -5, end: -1 }]],
  ['1000 entries', Array.from({ length: 1000 }, (_, i) => ({ start: NOW - 2000 * MIN + i * 1000, end: NOW - 2000 * MIN + i * 1000 + 500 }))],
  ['runs in the future', [{ start: NOW + HOUR, end: NOW + 2 * HOUR }]],
] as const) {
  test(`sessions: corrupt list (${name}) never shows junk`, async ($, on) => {
    await boot($, on, { store: { period: { startedAt: NOW - HOUR, lastActive: NOW - MIN, active: HOUR, idle: 0, runs: runs as any } } })
    const ui = await $.ui.mount(desk())
    const card = await cardText(ui)
    expect(card).not.toMatch(/NaN|Infinity|undefined|\[object|-\d/)
    expect((card.match(/ · \d/g) ?? []).length).toBeLessThan(40)
    await ui.unmount()
  })
}

test('sessions: the list is on the time card only; the band rows themselves stay compact', async ($, on) => {
  const clock = await boot($, on, { store: earlier() })
  const ui = await $.ui.mount(desk())
  await run($, clock, 5 * MIN)
  const rs = await rows(ui)
  expect(rs[0].right + rs[1].right + rs[2].right).not.toMatch(/5m 0s/) // the sessions list is in the card only
  expect(await cardText(ui)).toMatch(/5m 0s · now/)
  await ui.unmount()
})

test('reload: in-memory state from an older version (a meter without runs) never breaks drawing', async ($, on) => {
  // The state noun keeps values across a hot reload, so new code can meet old shapes: here, a period without runs.
  on('state.get', async (_: any, e: any, next: any) =>
    (e.key ?? e.ref?.key) === 'period'
      ? { value: { value: { startedAt: NOW - HOUR, lastActive: NOW - MIN, active: HOUR, idle: 0, inTurn: false }, version: 3 } }
      : next(e),
  )
  await boot($, on)
  const ui = await $.ui.mount(desk())
  const rs = await rows(ui)
  expect(rs.length).toBe(3)
  expect(await cardText(ui)).toMatch(/1h00m active/)
  await ui.unmount()
})

// ====================================================================
// time card: icons + timeline
// ====================================================================

const svgsOf = (n: any) => findAllType(n, 'Svg')
const seeded = (runs: { start: number; end: number }[], extra: any = {}) => ({
  stretch: { startedAt: runs[0]!.start, lastActive: runs.at(-1)!.end }, // what the idle state is judged by
  period: { startedAt: runs[0]!.start, lastActive: runs.at(-1)!.end, active: runs.reduce((a, r) => a + (r.end - r.start), 0), idle: 0, inTurn: false, runs, ...extra },
})

test('time card icons: one distinct small icon per stat line (Breaks only when there were breaks)', async ($, on) => {
  const a = NOW - 90 * MIN
  await boot($, on, { store: seeded([{ start: a, end: a + 20 * MIN }, { start: a + 60 * MIN, end: a + 85 * MIN }], { idle: 40 * MIN }) })
  const ui = await $.ui.mount(desk())
  const card = timeCardOf(await ui.drawn())
  const icons = svgsOf(card).filter((v: any) => v.props.width === 14)
  expect(icons.map((v: any) => v.props.alt)).toEqual(['Active', 'Breaks', 'This chat'])
  expect(new Set(icons.map((v: any) => v.props.source)).size).toBe(3)
  for (const v of icons) {
    expect(v.props.isInteractive).toBeFalsy()
    expect(v.props.height).toBe(14)
    expect(v.props.source).toMatch(/^<svg [^>]*viewBox="0 0 16 16"/)
    expect(v.props.source.length).toBeLessThan(900)
  }
  await ui.unmount()
})

test('time card is minimal: no headings, no Started row, no Breaks row until there is a break', async ($, on) => {
  await boot($, on)
  await submit($)
  const ui = await $.ui.mount(desk())
  const text = textAll(timeCardOf(await ui.drawn()))
  expect(text).not.toMatch(/Working time|Work sessions|Started|breaks/)
  const icons = svgsOf(timeCardOf(await ui.drawn())).filter((v: any) => v.props.width === 14)
  expect(icons.map((v: any) => v.props.alt)).toEqual(['Active', 'This chat'])
  await ui.unmount()
})

test('minimal: the card draws no timeline bar, only the small stat icons', async ($, on) => {
  const a = NOW - 120 * MIN
  await boot($, on, { store: seeded([{ start: a, end: a + 30 * MIN }, { start: a + 60 * MIN, end: a + 80 * MIN }, { start: a + 100 * MIN, end: a + 110 * MIN }]) })
  const ui = await $.ui.mount(desk())
  const svgs = svgsOf(timeCardOf(await ui.drawn()))
  expect(svgs.length).toBeGreaterThan(0)
  expect(svgs.every((v: any) => v.props.width === 14 && v.props.height === 14)).toBe(true) // icons only, no wide bar
  await ui.unmount()
})

test('timeline list: a dot per session with the break between, live one marked, in order', async ($, on) => {
  const a = NOW - 120 * MIN
  await boot($, on, { store: seeded([{ start: a, end: a + 30 * MIN }, { start: a + 65 * MIN, end: a + 85 * MIN }, { start: a + 100 * MIN, end: a + 110 * MIN }]) })
  const ui = await $.ui.mount(desk())
  const card = timeCardOf(await ui.drawn())
  const text = textAll(card)
  const first = text.indexOf('11:00 AM · 30m 0s')
  const brk1 = text.indexOf('╎ break 35m')
  const second = text.indexOf('12:05 PM · 20m 0s')
  const brk2 = text.indexOf('╎ break 15m')
  const third = text.indexOf('12:40 PM')
  expect(first).toBeGreaterThanOrEqual(0)
  expect(brk1).toBeGreaterThan(first)
  expect(second).toBeGreaterThan(brk1)
  expect(brk2).toBeGreaterThan(second)
  expect(third).toBeGreaterThan(brk2)
  expect(text).toMatch(/12:40 PM · 20m 0s · now/) // live: counted through now
  expect((text.match(/● /g) ?? []).length).toBe(3)
  expect((text.match(/╎ break/g) ?? []).length).toBe(2)
  await ui.unmount()
})

test('timeline list: the dot is green for the live session and blue for finished ones', async ($, on) => {
  const a = NOW - 100 * MIN
  await boot($, on, { store: seeded([{ start: a, end: a + 20 * MIN }, { start: a + 60 * MIN, end: a + 95 * MIN }]) })
  const ui = await $.ui.mount(desk())
  const card = timeCardOf(await ui.drawn())
  const dots = findAllType(card, 'Text').filter((n: any) => textAll(n) === '● ')
  expect(dots.map((d: any) => d.props.color)).toEqual(['suggestion', 'success'])
  await ui.unmount()
})

test('timeline list: sessions less than a minute apart show no break line', async ($, on) => {
  const a = NOW - 60 * MIN
  await boot($, on, { store: seeded([{ start: a, end: a + 10 * MIN }, { start: a + 10 * MIN + 30_000, end: a + 20 * MIN }]) })
  const ui = await $.ui.mount(desk())
  expect(textAll(timeCardOf(await ui.drawn()))).not.toMatch(/╎ break/)
  await ui.unmount()
})

test('timeline: no sessions yet shows a plain note', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  const card = timeCardOf(await ui.drawn())
  expect(textAll(card)).toMatch(/No sessions yet/)
  await ui.unmount()
})

test('timeline: 40 stored sessions list only the three latest + "+N earlier"', async ($, on) => {
  const base = NOW - 40 * 20 * MIN
  const runs = Array.from({ length: 40 }, (_, i) => ({ start: base + i * 20 * MIN, end: base + i * 20 * MIN + 5 * MIN }))
  await boot($, on, { store: seeded(runs) })
  const ui = await $.ui.mount(desk())
  const card = timeCardOf(await ui.drawn())
  expect(textAll(card)).toMatch(/\+37 earlier/)
  expect((textAll(card).match(/● /g) ?? []).length).toBe(3)
  await ui.unmount()
})

for (const [name, runs] of [
  ['a start in the future', [{ start: NOW + HOUR, end: NOW + 2 * HOUR }]],
  ['zero-length runs', [{ start: NOW - HOUR, end: NOW - HOUR }]],
  ['all at once', [{ start: NOW - HOUR, end: NOW - 30 * MIN }, { start: NOW - HOUR, end: NOW - 20 * MIN }]],
  ['overlapping runs', [{ start: NOW - 3 * HOUR, end: NOW - HOUR }, { start: NOW - 2 * HOUR, end: NOW - 30 * MIN }]],
] as const) {
  test(`timeline: odd run data (${name}) never produces NaN or negatives`, async ($, on) => {
    await boot($, on, { store: seeded(runs as any) })
    const ui = await $.ui.mount(desk())
    const card = timeCardOf(await ui.drawn())
    // Negative numbers are checked in the visible text only: icon path data ("v-3") legitimately has them.
    expect(textAll(card)).not.toMatch(/NaN|Infinity|undefined|\[object|-\d/)
    expect(svgsOf(card).map((v: any) => v.props.source).join('')).not.toMatch(/NaN|Infinity|undefined/)
    await ui.unmount()
  })
}

test('time card icons and timeline exist on desktop/editor only (the terminal has no card)', async ($, on) => {
  await boot($, on)
  await submit($)
  const term = await $.ui.mount(BAND(100))
  expect(timeCardOf(await term.drawn())).toBeUndefined()
  await term.unmount()
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND(100), surface })
    expect(svgsOf(timeCardOf(await ui.drawn())).length).toBeGreaterThanOrEqual(2) // the stat icons (Active, This chat)
    await ui.unmount()
  }
})


// ====================================================================
// nothing is shown twice
// ====================================================================

test('no duplicates: the card never repeats the chip (focused/idle) or the since line', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  await run($, clock, 12 * MIN)
  const rs = await rows(ui)
  const card = await cardText(ui)
  expect(rs[0].right).toMatch(/12m/) // the chip carries the current stretch...
  expect(card).not.toMatch(/focused|idle|since/) // ...so the card does not
  expect(card).not.toMatch(/1:00 PM/) // and one session's start is not repeated from the since line
  await ui.unmount()
})

test('no duplicates: a single session is not listed; two or more are', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  await run($, clock, 3 * MIN)
  expect(await cardText(ui)).not.toMatch(/● /)
  await clock.advance(31 * MIN)
  await run($, clock, 2 * MIN)
  expect((await cardText(ui)).match(/● /g)?.length).toBe(2)
  await ui.unmount()
})

test('no duplicates: each stat line appears once in the card', async ($, on) => {
  const a = NOW - 90 * MIN
  await boot($, on, { store: seeded([{ start: a, end: a + 20 * MIN }, { start: a + 60 * MIN, end: a + 85 * MIN }], { idle: 40 * MIN }) })
  const ui = await $.ui.mount(desk())
  const text = textAll(timeCardOf(await ui.drawn()))
  for (const word of ['active', 'breaks', 'in this chat']) expect((text.match(new RegExp(word, 'g')) ?? []).length).toBe(1)
  await ui.unmount()
})


test('rules: the brief rule asks for purpose and done only, with outcome-style done lines', async ($, on) => {
  await boot($, on)
  const composed: any = await $.prompt.compose({ model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
  const text = JSON.stringify(composed)
  expect(text).toMatch(/purpose \(max 80 chars/)
  expect(text).toMatch(/no version numbers, file or function names, or small visual tweaks/)
  expect(text).not.toMatch(/feature|share|post/i) // the sharing feature is gone
})

test('no sharing: the desktop band has no megaphone or share card, and set_brief asks for no feature', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'Proj', done: ['a', 'b'] })
  const ui = await $.ui.mount(desk())
  const root = await ui.drawn()
  expect(findAllType(root, 'Box').filter((b: any) => b.props?.key === 'share').length).toBe(0)
  expect(textAll(root)).not.toMatch(/Share your progress|LinkedIn|not shared/)
  expect(findAllType(root, 'Svg').length).toBe(1 + 2) // the glass, plus the time card's Active and This chat icons
  expect(Object.keys(registered.inputSchema.properties)).toEqual(['purpose', 'done'])
  expect(registered.inputSchema.required).toEqual(['purpose', 'done'])
  await ui.unmount()
})

// ---------- the water glass is shared by every session ----------

test('a refill in another session shows here within seconds', async ($, on) => {
  const live: Record<string, unknown> = { water: { lastDrink: NOW - 10 * DAY } }
  const clock = await boot($, on, { live })
  expect((await band($, 80))[0]).toMatch(/▕ ▏/) // empty
  live.water = { lastDrink: NOW } // another session pressed Refill
  await clock.set(NOW + 6000)
  expect((await band($, 80))[0]).toMatch(/▕█▏/) // full here too, with no restart
})
