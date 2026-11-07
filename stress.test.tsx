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
  git?: string | null // stdout of `git status --porcelain -b`; null = not a repo
  model?: string | null // reply of model.complete; null = the model is unavailable
  os?: 'Linux' | 'Darwin' | 'Windows' // what `uname` says (Windows has no uname)
  openFails?: boolean // the browser launcher exits non-zero
}
let opened: string[][] = []
let copied: string[] = []
let modelCalls: string[] = []
let modelSystems: string[] = []

async function boot($: any, on: any, o: Boot = {}) {
  const clock = mock.clock(on, { now: o.now ?? NOW })
  mock.store(on, o.store ?? {})
  toasts = []
  on('ui.toast', (_: any, e: any) => {
    toasts.push(String(e.text ?? ''))
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  copied = []
  modelCalls = []
  modelSystems = []
  opened = []
  on('session.cwd', () => ({ value: o.cwd ?? '/work/demo-project' }))
  on('ui.copy', (_: any, e: any) => {
    copied.push(String(e.text))
    return { value: { isCopied: true } }
  })
  on('model.complete', (_: any, e: any) => {
    modelCalls.push(String(e.prompt))
    modelSystems.push(String(e.system ?? ''))
    return o.model == null
      ? { value: { isAnswered: false, reason: 'api-error', usage: {} } }
      : { value: { isAnswered: true, text: o.model, usage: {} } }
  })
  on('process.run', (_: any, e: any) => {
    if (e.argv?.[0] === 'git') {
      return o.git == null
        ? { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }
        : { value: { exitCode: 0, stdout: o.git, stderr: '' } }
    }
    if (e.argv?.[0] === 'uname') {
      return (o.os ?? 'Linux') === 'Windows'
        ? { value: { exitCode: 127, stdout: '', stderr: 'not found' } }
        : { value: { exitCode: 0, stdout: `${o.os ?? 'Linux'}\n`, stderr: '' } }
    }
    if (['xdg-open', 'open', 'rundll32'].includes(e.argv?.[0])) {
      opened.push([...e.argv])
      return { value: { exitCode: o.openFails ? 1 : 0, stdout: '', stderr: '' } }
    }
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
    expect(hidden.length).toBe(5) // + the water glass, share, and the two time cards (chip, since)
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
    // the only hidden Boxes left are the water glass's card and (where images exist) the share card
    expect(boxes.filter((b: any) => b.props?.display === 'none').length).toBe(surface === 'terminal' ? 1 : 4)
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

// ====================================================================
// share tracker: update log, badge, nudges, drafts, "posted", git row
// ====================================================================

const upd = ($: any, i: number | string) => setBrief($, { purpose: 'Proj', done: [`update ${i}`, 'older'] })
const desk = (cols = 100) => ({ ...BAND(cols), surface: 'desktop' }) as any
const shareCard = (root: any) =>
  findAllType(root, 'Box').find((b: any) => b.props?.display === 'none' && textAll(b).includes('Share your progress'))
const iconSources = (root: any) => findAllType(root, 'Svg').map((v: any) => v.props.source as string)
const btn = (root: any, key: string) => findAllType(root, 'Button').find((b: any) => b.props?.key === key)
// The megaphone now sits beside the glass on the first row: its number precedes the work/idle chip.
const badgeText = async (ui: any) => (await rows(ui))[0]?.right ?? ''
const unsharedOf = async (ui: any) => Number(((await badgeText(ui)).match(/^\s*(\d+)(?:\s*⏸|\s+\d+[mhd])/) ?? [])[1] ?? 0)
const shareToasts = () => toasts.filter(t => /not shared yet/.test(t))

test('share: each new done line is logged once; the megaphone badge counts them', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  expect(await unsharedOf(ui)).toBe(0) // nothing yet: no number
  await upd($, 1)
  await upd($, 1) // same line again: not a new update
  await upd($, 2)
  expect(await unsharedOf(ui)).toBe(2)
  await ui.unmount()
})

test('share: nudges at 3 unshared updates, then again at 6, never in between', async ($, on) => {
  await boot($, on)
  for (let i = 1; i <= 2; i++) await upd($, i)
  expect(shareToasts().length).toBe(0)
  await upd($, 3)
  expect(shareToasts().length).toBe(1)
  await upd($, 4)
  await upd($, 5)
  expect(shareToasts().length).toBe(1)
  await upd($, 6)
  expect(shareToasts().length).toBe(2)
  expect(shareToasts()[0]).toMatch(/^3 updates not shared yet/)
})

test('share: the user scenario - post, work more, and the warning comes back with only the NEW updates', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  for (let i = 1; i <= 4; i++) {
    await clock.advance(MIN)
    await upd($, `a${i}`)
  }
  expect(await unsharedOf(ui)).toBe(4)
  await clock.advance(MIN)
  await ui.press({ key: 'posted-linkedin' })
  await ui.press({ key: 'posted-x' })
  expect(await unsharedOf(ui)).toBe(0) // 0 unshared: badge gone
  // two more hours of work, two updates
  await clock.advance(60 * MIN)
  await upd($, 'b1')
  await clock.advance(60 * MIN)
  await upd($, 'b2')
  expect(await unsharedOf(ui)).toBe(2) // only the new ones, not the 4 already posted
  await ui.unmount()
})

test('share: posting on one platform only keeps the badge until both are done; each row has its own status', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  for (let i = 1; i <= 3; i++) {
    await clock.advance(MIN)
    await upd($, i)
  }
  await clock.advance(MIN)
  await ui.press({ key: 'posted-linkedin' })
  expect(await unsharedOf(ui)).toBe(3) // X still has all 3
  const card = textAll(shareCard(await ui.drawn()))
  expect(card).toMatch(/LinkedIn · up to date/)
  expect(card).toMatch(/X · 3 new/)
  await ui.unmount()
})

test('share: nudge counting restarts after you post', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  for (let i = 1; i <= 3; i++) {
    await clock.advance(MIN)
    await upd($, i)
  }
  expect(shareToasts().length).toBe(1)
  await clock.advance(MIN)
  await ui.press({ key: 'posted-linkedin' })
  await ui.press({ key: 'posted-x' })
  for (let i = 4; i <= 6; i++) {
    await clock.advance(MIN)
    await upd($, i)
  }
  expect(shareToasts().length).toBe(2) // a fresh "3 not shared" after the post
  await ui.unmount()
})

test('share: megaphone tint steps up with the count (0, a few, several, many)', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  // the megaphone is the first image inside the keyed "share" Box (the card's logos come after it)
  const mega = async () => {
    const box = findAllType(await ui.drawn(), 'Box').find((b: any) => b.props?.key === 'share')
    return (box.children[0] as any).props.source as string
  }
  const seen: Record<number, string> = { 0: await mega() }
  let n = 0
  for (const target of [1, 3, 6]) {
    while (n < target) await upd($, `t${++n}`)
    seen[target] = await mega()
  }
  expect(new Set(Object.values(seen)).size).toBe(4) // none / few / several / many
  await ui.unmount()
})

test('share: draft - AI text, prefilled X link, copied to the clipboard, prompt carries the project and updates', async ($, on) => {
  const clock = await boot($, on, { model: 'Shipped the share tracker for demo-project. #buildinpublic' })
  const ui = await $.ui.mount(desk())
  await upd($, 'login page'); await clock.advance(MIN)
  await upd($, 'rate limiter')
  await ui.press({ key: 'draft-x' })
  await ui.press({ key: 'open-x' })
  const href = opened.at(-1)![1]!
  expect(href).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/)
  expect(decodeURIComponent(href.split('text=')[1]!)).toContain('Shipped the share tracker')
  expect(copied.at(-1)).toContain('Shipped the share tracker')
  expect(modelCalls.at(-1)).toMatch(/demo-project/)
  expect(modelCalls.at(-1)).toMatch(/update login page/)
  expect(modelCalls.at(-1)).toMatch(/update rate limiter/)
  expect(toasts.some(t => /draft ready and copied/.test(t))).toBe(true)
  await ui.unmount()
})

test('share: model output is cleaned and clipped (X <= 280 chars, LinkedIn <= 1300, no ANSI)', async ($, on) => {
  await boot($, on, { model: '\u001b[31mBIG\u001b[0m\n\n\n\n' + 'word '.repeat(2000) })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-x' })
  expect(copied.at(-1)!.length).toBeLessThanOrEqual(280)
  expect(copied.at(-1)).not.toMatch(/\u001b|\[31m/)
  await ui.press({ key: 'draft-linkedin' })
  expect(copied.at(-1)!.length).toBeLessThanOrEqual(1300)
  expect(copied.at(-1)).not.toMatch(/\n{3,}/)
  await ui.unmount()
})

test('share: model unavailable -> a plain template draft from the updates (still usable)', async ($, on) => {
  await boot($, on, { model: null })
  const ui = await $.ui.mount(desk())
  await upd($, 'alpha'); await upd($, 'beta')
  await ui.press({ key: 'draft-linkedin' })
  expect(copied.at(-1)).toMatch(/Progress update on demo-project/)
  expect(copied.at(-1)).toMatch(/update alpha/)
  expect(btn(await ui.drawn(), 'open-linkedin')).toBeTruthy()
  await ui.unmount()
})

test('share: long LinkedIn text falls back to the plain compose link (clipboard keeps the full text)', async ($, on) => {
  await boot($, on, { model: '日本語のとても長い投稿 🚀 '.repeat(200) })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-linkedin' })
  await ui.press({ key: 'open-linkedin' })
  const href = opened.at(-1)![1]!
  expect(href.length).toBeLessThanOrEqual(2048)
  expect(href).toMatch(/^https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true/)
  expect(copied.at(-1)!.length).toBeGreaterThan(100)
  await ui.unmount()
})

test('share: no draft/posted buttons when nothing is unshared', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  const root = await ui.drawn()
  expect(btn(root, 'draft-x')).toBeUndefined()
  expect(btn(root, 'posted-linkedin')).toBeUndefined()
  expect(findAllType(root, 'Button').filter((b: any) => /draft|open|posted/.test(b.props?.key ?? '')).length).toBe(0)
  expect(textAll(shareCard(root))).toMatch(/all shared/)
  await ui.unmount()
})

test('share: the log is per project (another project starts at zero)', async ($, on) => {
  const seeded = { share: undefined } as any
  void seeded
  const now = NOW - 10 * MIN
  await boot($, on, { cwd: '/work/b', store: { 'share:/work/a': { log: [{ at: now, text: 'a1' }, { at: now + 1, text: 'a2' }], shared: { linkedin: 0, x: 0 } } } })
  const ui = await $.ui.mount(desk())
  expect(await unsharedOf(ui)).toBe(0)
  await ui.unmount()
})

test('share: the same project in another session sees the saved log', async ($, on) => {
  const at = NOW - 10 * MIN
  await boot($, on, { cwd: '/work/a', store: { 'share:/work/a': { log: [{ at, text: 'a1' }, { at: at + 1, text: 'a2' }], shared: { linkedin: 0, x: 0 } } } })
  const ui = await $.ui.mount(desk())
  expect(await unsharedOf(ui)).toBe(2)
  await ui.unmount()
})

for (const [name, bad] of [
  ['a string', 'junk'],
  ['wrong types', { log: 'x', shared: 7, drafts: [] }],
  ['NaN/negative times', { log: [{ at: NaN, text: 'a' }, { at: -5, text: 'b' }], shared: { linkedin: NaN, x: -1 } }],
  ['non-https draft url', { log: [], shared: {}, drafts: { x: { text: 'hi', url: 'javascript:alert(1)', at: 1 } } }],
  ['1000 log entries', { log: Array.from({ length: 1000 }, (_, i) => ({ at: NOW - 100 * MIN + i, text: `e${i}` })), shared: {} }],
  ['hostile log text', { log: [{ at: NOW - MIN, text: '\u001b[31mred\nline\u0007' }], shared: {} }],
] as const) {
  test(`share: corrupt store (${name}) never breaks the band`, async ($, on) => {
    await boot($, on, { cwd: '/work/c', store: { 'share:/work/c': bad as any } })
    const ui = await $.ui.mount(desk())
    const root = await ui.drawn()
    const all = textAll(root) + (await badgeText(ui))
    expect(all).not.toMatch(/NaN|undefined|\[object|javascript:/)
    expect(findAllType(root, 'Link').every((l: any) => /^https:\/\//.test(l.props.href))).toBe(true)
    await ui.unmount()
  })
}

test('share: a log longer than 100 is capped at 100', async ($, on) => {
  await boot($, on, { cwd: '/work/c', store: { 'share:/work/c': { log: Array.from({ length: 1000 }, (_, i) => ({ at: NOW - 100 * MIN + i, text: `e${i}` })), shared: {} } } })
  const ui = await $.ui.mount(desk())
  expect(await unsharedOf(ui)).toBe(100)
  await ui.unmount()
})

for (const [name, out, expected] of [
  ['clean', '## main...origin/main\n', /GitHub · pushed/],
  ['ahead', '## main...origin/main [ahead 2]\n', /GitHub · 2 commits not pushed/],
  ['ahead 1', '## main...origin/main [ahead 1]\n', /GitHub · 1 commit not pushed/],
  ['dirty', '## main...origin/main\n M a.ts\n?? b.ts\n', /GitHub · 2 files not committed/],
  ['no upstream', '## main\n', /GitHub · no upstream, not pushed/],
  ['new repo', '## No commits yet on main\n?? a\n', /GitHub · 1 file not committed/],
] as const) {
  test(`git row: ${name}`, async ($, on) => {
    await boot($, on, { git: out })
    const ui = await $.ui.mount(desk())
    expect(textAll(shareCard(await ui.drawn()))).toMatch(expected)
    await ui.unmount()
  })
}

test('git row: hidden when the folder is not a repo (or git fails)', async ($, on) => {
  await boot($, on, { git: null })
  const ui = await $.ui.mount(desk())
  expect(textAll(shareCard(await ui.drawn()))).not.toMatch(/GitHub/)
  await ui.unmount()
})

test('git row: garbage output is ignored', async ($, on) => {
  await boot($, on, { git: 'fatal: ???\n\u0000\n' })
  const ui = await $.ui.mount(desk())
  expect(textAll(shareCard(await ui.drawn()))).not.toMatch(/GitHub/)
  await ui.unmount()
})

test('terminal: no share icon is drawn, but updates are still logged and the nudge still fires', async ($, on) => {
  await boot($, on)
  for (let i = 1; i <= 3; i++) await upd($, i)
  const ui = await $.ui.mount(BAND(100))
  const root = await ui.drawn()
  expect(shareCard(root)).toBeUndefined()
  expect(shareToasts().length).toBe(1)
  await ui.unmount()
})

test('share: the card holds the logos, an Open link only after a draft, and the honest footer', async ($, on) => {
  await boot($, on, { model: 'post', git: '## main...origin/main\n' })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  let card = shareCard(await ui.drawn())
  expect(findAllType(card, 'Svg').length).toBeGreaterThanOrEqual(3) // LinkedIn, X, GitHub (when a repo)
  expect(findAllType(card, 'Button').find((b: any) => b.props?.key === 'open-linkedin')).toBeUndefined()
  expect(textAll(card)).toMatch(/Nothing posts until you do/)
  await ui.press({ key: 'draft-linkedin' })
  card = shareCard(await ui.drawn())
  expect(findAllType(card, 'Button').find((b: any) => b.props?.key === 'open-linkedin')).toBeTruthy()
  expect(findAllType(card, 'Link').length).toBe(0) // the desktop does not open Links drawn by a mod
  expect(findAllType(card, 'Button').find((b: any) => b.props?.key === 'open-linkedin').props.label).toBe('Open')
  await ui.unmount()
})

test('share: the card is absolute (adds no height) and sits in the right column', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  const card = shareCard(await ui.drawn())
  expect(card.props.position).toBe('absolute')
  expect(card.props.display).toBe('none')
  await ui.unmount()
})

test('share: 200 parallel updates stay consistent (queued writes, capped log, one nudge per 3)', async ($, on) => {
  await boot($, on)
  await Promise.all(Array.from({ length: 200 }, (_, i) => upd($, `p${i}`)))
  expect(shareToasts().length).toBeGreaterThanOrEqual(1)
  expect(shareToasts().every(t => /^\d+ updates not shared yet/.test(t))).toBe(true)
  const ui = await $.ui.mount(desk())
  const n = await unsharedOf(ui)
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThanOrEqual(100)
  await ui.unmount()
})

test('the glass and the megaphone sit together on the first row, before the work chip', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  const root = await ui.drawn()
  const first = root.children[0] // first band row
  const rightBox = first.children[0].children[1]
  const order = (rightBox.children as any[]).map((c: any) =>
    c.type === 'Box' && c.props?.key === 'glass' ? 'glass' : c.type === 'Box' && c.props?.key === 'share' ? 'megaphone' : null,
  ).filter(Boolean)
  expect(order).toEqual(['glass', 'megaphone'])
  // and the second row carries only the time, no icons
  const second = root.children[1].children[0].children[1]
  expect(findAllType(second, 'Svg').length).toBe(0)
  await ui.unmount()
})

test('spacing: real one-cell spacers separate glass, megaphone, count and chip (plain spaces collapse next to images)', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  const right = (await ui.drawn()).children[0].children[0].children[1]
  const kinds = (right.children as any[]).map((c: any) =>
    c.type === 'Box' && c.props?.width === 1 ? '|' : c.type === 'Box' && c.props?.key === 'glass' ? 'G' : c.type === 'Box' && c.props?.key === 'share' ? 'M' : c.type === 'Text' && /^\d+$/.test(textAll(c)) ? '#' : 'x',
  )
  // glass | megaphone | count | chip...
  expect(kinds.slice(0, 7).join('')).toBe('G|M|#|x')
  await ui.unmount()
})

// ---------- opening the compose page (a real Button, not a Link) ----------

test('open: Linux launches xdg-open with the exact https URL (no shell, & intact)', async ($, on) => {
  await boot($, on, { os: 'Linux', model: 'Hello & welcome <b>to</b> my "post"' })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-linkedin' })
  await ui.press({ key: 'open-linkedin' })
  expect(opened.length).toBe(1)
  expect(opened[0]![0]).toBe('xdg-open')
  expect(opened[0]!.length).toBe(2) // argv, not a shell string
  expect(opened[0]![1]).toMatch(/^https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true&text=/)
  expect(decodeURIComponent(opened[0]![1]!.split('&text=')[1]!)).toBe('Hello & welcome <b>to</b> my "post"')
  expect(toasts.some(t => /Opening LinkedIn/.test(t))).toBe(true)
  await ui.unmount()
})

test('open: macOS uses open, Windows uses rundll32 (no cmd, so & cannot split the command)', async ($, on) => {
  await boot($, on, { os: 'Darwin', model: 'post' })
  let ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-x' })
  await ui.press({ key: 'open-x' })
  expect(opened.at(-1)![0]).toBe('open')
  await ui.unmount()
})

test('open: Windows has no uname and falls back to rundll32', async ($, on) => {
  await boot($, on, { os: 'Windows', model: 'post' })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-x' })
  await ui.press({ key: 'open-x' })
  expect(opened.at(-1)!.slice(0, 2)).toEqual(['rundll32', 'url.dll,FileProtocolHandler'])
  expect(opened.at(-1)![2]).toMatch(/^https:\/\/x\.com\//)
  await ui.unmount()
})

test('open: if the browser cannot be launched, the link is copied and you are told', async ($, on) => {
  await boot($, on, { openFails: true, model: 'post' })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-x' })
  await ui.press({ key: 'open-x' })
  expect(toasts.some(t => /Couldn't open the browser/.test(t))).toBe(true)
  expect(copied.at(-1)).toMatch(/^https:\/\/x\.com\/intent\/post/)
  await ui.unmount()
})

test('open: opening does not mark anything as posted', async ($, on) => {
  await boot($, on, { model: 'post' })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-x' })
  await ui.press({ key: 'open-x' })
  expect(await unsharedOf(ui)).toBe(1)
  await ui.unmount()
})

test('open: only https links are ever launched (a tampered stored draft is dropped)', async ($, on) => {
  await boot($, on, {
    cwd: '/work/t',
    store: { 'share:/work/t': { log: [{ at: NOW - MIN, text: 'x' }], shared: {}, drafts: { x: { text: 'hi', url: 'file:///etc/passwd', at: 1 }, linkedin: { text: 'hi', url: 'http://evil.example/', at: 1 } } } },
  })
  const ui = await $.ui.mount(desk())
  const root = await ui.drawn()
  expect(btn(root, 'open-x')).toBeUndefined()
  expect(btn(root, 'open-linkedin')).toBeUndefined()
  expect(opened.length).toBe(0)
  await ui.unmount()
})

test('layout: one compact line per platform; buttons depend on state (Draft -> ↻ Open Posted)', async ($, on) => {
  await boot($, on, { model: 'post', git: '## main...origin/main\n' })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  const rowOf = (name: string) =>
    (shareCard(ui_root) .children as any[]).find((c: any) => c.type === 'Box' && textAll(c).startsWith(name))
  let ui_root = await ui.drawn()
  // before drafting: only a single "Draft" button on the platform that has news
  let li = rowOf('LinkedIn')
  expect(findAllType(li, 'Button').map((b: any) => b.props.label)).toEqual(['Draft', 'Posted']) // you may have posted it yourself
  await ui.press({ key: 'draft-linkedin' })
  ui_root = await ui.drawn()
  li = rowOf('LinkedIn')
  expect(findAllType(li, 'Button').map((b: any) => b.props.label)).toEqual(['↻', 'Open', 'Posted'])
  // the row is one Box with the logo, name, status and buttons side by side (no nested stacking)
  expect((li.children as any[]).some((c: any) => c.type === 'Box' && c.props?.flexDirection === 'column')).toBe(false)
  // GitHub is one line too, and the footer is a single short line
  const gh = rowOf('GitHub')
  expect(findAllType(gh, 'Button').length).toBe(0)
  expect(textAll(gh)).toMatch(/GitHub · pushed · main/)
  expect(textAll(shareCard(ui_root))).toMatch(/Nothing posts until you do\.$/)
  await ui.unmount()
})

test('layout: an up-to-date platform shows no buttons at all', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  const card = shareCard(await ui.drawn())
  for (const name of ['LinkedIn', 'X']) {
    const row = (card.children as any[]).find((c: any) => c.type === 'Box' && textAll(c).startsWith(name))
    expect(findAllType(row, 'Button').length).toBe(0)
  }
  await ui.unmount()
})

test('share: the draft prompt forbids invented facts (no made-up timeframes like "this week")', async ($, on) => {
  await boot($, on, { model: 'post' })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-linkedin' })
  expect(modelSystems.at(-1)).toMatch(/never invent dates, timeframes/)
  expect(modelSystems.at(-1)).toMatch(/Never include secrets/)
  await ui.unmount()
})

test('share: Posted works without drafting first (you wrote the post yourself)', async ($, on) => {
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await clock.advance(MIN)
  await ui.press({ key: 'posted-linkedin' })
  await ui.press({ key: 'posted-x' })
  expect(await unsharedOf(ui)).toBe(0)
  await ui.unmount()
})

test('spacing: the card separates its rows (a gap step), so buttons of one row never overlap the next', async ($, on) => {
  await boot($, on, { model: 'post', git: '## main...origin/main\n' })
  const ui = await $.ui.mount(desk())
  await upd($, 1)
  await ui.press({ key: 'draft-linkedin' })
  const card = shareCard(await ui.drawn())
  expect(card.props.flexDirection).toBe('column')
  expect(card.props.gap).toBe('sm')
  // status sits right after the name in one Text run (no fixed-width columns to misalign)
  const li = (card.children as any[]).find((c: any) => c.type === 'Box' && textAll(c).startsWith('LinkedIn'))
  expect(textAll(li)).toMatch(/^LinkedIn · 1 new$/)
  await ui.unmount()
})

// ====================================================================
// working period: "since" = when you began, breaks counted not reset
// ====================================================================

const submit = ($: any) => $.prompt.submit({ text: 'x' })
const finish = ($: any) => completeTurn($, undefined)
// The time card lives inside the keyed pill Boxes ("timechip", "timesince"): the glass/megaphone pattern.
const timeCardOf = (root: any) =>
  findAllType(root, 'Box').find((b: any) => b.props?.display === 'none' && textAll(b).includes('Working time'))
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
  expect(card).toMatch(/Now · 10m focused/)
  expect(card).toMatch(/Active · 1h31m in this period/) // 81m of work + the 10m turn
  expect(card).toMatch(/Breaks · 2h04m/)
  expect(card).toMatch(/Started · 9:35 AM/)
  expect(card).toMatch(/This chat · 10m active/)
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
  expect(card).toMatch(/Active · 2m in this period/)
  expect(card).toMatch(/Breaks · 0m/)
  expect(card).toMatch(/Started · 1:00 PM/) // the new period began at the prompt
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
  expect(card).toMatch(/Active · 1h00m in this period/)
  expect(card).toMatch(/Breaks · 0m/)
  await ui.unmount()
})

test('period: a new chat continues the period but its own active time starts at zero', async ($, on) => {
  await boot($, on, { store: { period: { startedAt: NOW - 3 * HOUR, lastActive: NOW - MIN, active: 150 * MIN, idle: 30 * MIN, inTurn: false } } })
  const ui = await $.ui.mount(desk())
  const card = await cardText(ui)
  expect(card).toMatch(/Active · 2h30m in this period/)
  expect(card).toMatch(/Breaks · 30m/)
  expect(card).toMatch(/Started · 10:00 AM/)
  expect(card).toMatch(/This chat · 0m active/)
  await ui.unmount()
})

test('period: this chat keeps its own active time across a restart (stored per session)', async ($, on) => {
  await boot($, on, { store: { 'sess:s1': { startedAt: NOW - HOUR, lastActive: NOW - MIN, active: 40 * MIN, idle: 0, inTurn: false } } })
  const ui = await $.ui.mount(desk())
  expect(await cardText(ui)).toMatch(/This chat · 40m active/)
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
  expect(before).toMatch(/Active · 10m/)
  // a start dated in the future is clamped to now when shown
  const rs = await rows(ui)
  expect(rs[1].right).toMatch(/since 1:00 PM/)
  await ui.unmount()
})

test('time card: lives on desktop/editor only, inside keyed pill Boxes (like the glass card), not on the glass or megaphone', async ($, on) => {
  await boot($, on)
  await submit($)
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND(100), surface })
    const root = await ui.drawn()
    const wrappers = findAllType(root, 'Box').filter((b: any) => b.props?.key === 'timechip' || b.props?.key === 'timesince')
    expect(wrappers.map((b: any) => b.props.key).sort()).toEqual(['timechip', 'timesince'])
    for (const w of wrappers) {
      // each wrapper holds its pill text AND a hidden, absolute card
      const card = (w.children as any[]).find((c: any) => c.type === 'Box' && c.props?.display === 'none')
      expect(card).toBeTruthy()
      expect(card.props.position).toBe('absolute') // no extra height
      expect(textAll(card)).toMatch(/Working time/)
      expect(findAllType(w, 'Svg').length).toBe(0) // never wraps the glass or megaphone
    }
    const pillText = (k: string) => textAll({ children: (wrappers.find((b: any) => b.props.key === k).children as any[]).filter((c: any) => c.props?.display !== 'none') })
    expect(pillText('timechip')).toMatch(/work/)
    expect(pillText('timesince')).toMatch(/since/)
    expect(pillText('timechip') + pillText('timesince')).not.toMatch(/app|\d{3,}k/) // the app/token line is not a trigger
    await ui.unmount()
  }
  const term = await $.ui.mount(BAND(100))
  const troot = await term.drawn()
  expect(timeCardOf(troot)).toBeUndefined()
  expect(findAllType(troot, 'Box').filter((b: any) => b.props?.key === 'timechip' || b.props?.key === 'timesince').length).toBe(0)
  await term.unmount()
})

test('time card: the same pattern as the glass card (key + hidden absolute child), not a hover-group scope', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(desk())
  const root = await ui.drawn()
  const keyed = (k: string) => findAllType(root, 'Box').find((b: any) => b.props?.key === k)
  for (const k of ['glass', 'share', 'timechip', 'timesince']) {
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
  expect(await cardText(ui)).toMatch(/Now · idle 35m/)
  await ui.unmount()
})

// ====================================================================
// work sessions list in the time card
// ====================================================================

const SEC = 1000
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
  expect(card).toMatch(/Work sessions/)
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
    const clock = await boot($, on)
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
  expect(card).toMatch(/Breaks · 1h02m/) // 31m + 31m idle
  await ui.unmount()
})

test('sessions: only the six latest are listed, with "+N earlier" for the rest', async ($, on) => {
  // Seeded (not replayed): fast-forwarding hours of 30-second ticks made this test slow and flaky.
  const runs = Array.from({ length: 9 }, (_, i) => ({ start: NOW - (10 - i) * 20 * MIN, end: NOW - (10 - i) * 20 * MIN + MIN }))
  await boot($, on, { store: { period: { startedAt: runs[0]!.start, lastActive: NOW - 5 * MIN, active: 9 * MIN, idle: 0, inTurn: false, runs } } })
  const ui = await $.ui.mount(desk())
  const card = await cardText(ui)
  expect(card).toMatch(/\+3 earlier/)
  expect((card.match(/ · 1m 0s/g) ?? []).length).toBe(5) // five finished sessions...
  expect(card).toMatch(/ · 40m 0s · now/) // ...and the live one, counted through now
  await ui.unmount()
})

test('sessions: after a break that ends the work (idle now), the last session is not marked "now"', async ($, on) => {
  const clock = await boot($, on)
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
  expect(card).toMatch(/1:00 PM · 3m 0s · now/)
  await ui.unmount()
})

test('sessions: a stored period from an older version (no list) shows one session from its start', async ($, on) => {
  await boot($, on, { store: { period: { startedAt: NOW - 2 * HOUR, lastActive: NOW - 2 * MIN, active: 90 * MIN, idle: 0 } } })
  const ui = await $.ui.mount(desk())
  expect(await cardText(ui)).toMatch(/11:00 AM · 2h 00m · now/) // live: counted through now
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
  const clock = await boot($, on)
  const ui = await $.ui.mount(desk())
  await run($, clock, 5 * MIN)
  const rs = await rows(ui)
  expect(rs[0].right + rs[1].right + rs[2].right).not.toMatch(/Work sessions/)
  expect(await cardText(ui)).toMatch(/Work sessions/)
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
  expect(await cardText(ui)).toMatch(/Active · 1h00m in this period/)
  await ui.unmount()
})
