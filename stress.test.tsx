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
const completeTurn = ($: any, u: any) => {
  nextUsage = u
  return $.turn.complete({ reason: 'answer', answer: '' })
}

type Boot = { store?: Record<string, unknown>; ps?: string | Error; now?: number }

async function boot($: any, on: any, o: Boot = {}) {
  const clock = mock.clock(on, { now: o.now ?? NOW })
  mock.store(on, o.store ?? {})
  on('session.id', () => ({ value: 's1' }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('process.run', () => {
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

type Row = { left: string; right: string; reveal: string | null }

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

const textOf = (n: any): string =>
  typeof n === 'string' ? n : (n?.children ?? []).map(textOf).join('')

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
        reveal: reveal ? textOf(reveal) : null,
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

test('1,000 turns of 10M tokens each: stays one short token', async ($, on) => {
  await boot($, on)
  for (let i = 0; i < 1000; i++) {
    await completeTurn($, { input_tokens: 10_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'm' })
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
  expect(rs[0]).toMatch(/^◎ Ship the thing\s+●\s+\d+m\s+work$/)
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

test('hover reveal: when the right column is hidden, hovering shows it too', async ($, on) => {
  await boot($, on, { ps: ' 01:07:00 /usr/lib/claude-desktop/claude-desktop\n' })
  await setBrief($, { purpose: 'Short', done: ['a', 'b'] })
  const rs = await bandRows($, 20)
  expect(rs[0].right).toBe('')
  expect(rs[0].reveal).toMatch(/Short/)
  expect(rs[2].reveal).toMatch(/app/) // the app/token info was hidden, so the hover has it
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
  test(`${surface}: a cut line gets a native tooltip (SVG <title>), absolutely placed, no in-flow reveal`, async ($, on) => {
    await boot($, on)
    const purpose = 'Purpose with <tags> & "quotes" that is far too long for a narrow band to show in full'
    await setBrief($, { purpose, done: ['short', 'tiny'] })
    const ui = await $.ui.mount({ ...BAND(40), surface })
    const root = await ui.drawn()
    const svgs = findAllType(root, 'Svg')
    expect(svgs.length).toBe(1) // only the cut line, not the two short ones
    const svg = svgs[0]
    expect(svg.props.isInteractive).toBe(true)
    expect(svg.props.source).toContain('<title>')
    expect(svg.props.source).toContain('&lt;tags&gt; &amp; &quot;quotes&quot;') // escaped, cannot inject markup
    expect(svg.props.source).not.toMatch(/<tags>/)
    expect(svg.props.alt).toContain('Purpose with') // full text for screen readers
    // placed absolutely, so it adds no height to the band
    const boxes = findAllType(root, 'Box').filter((b: any) => b.props?.position === 'absolute')
    expect(boxes.length).toBe(1)
    // and no terminal-style hover reveal Box is drawn alongside
    expect(findAllType(root, 'Box').filter((b: any) => b.props?.display === 'none').length).toBe(0)
    await ui.unmount()
  })
}

test('desktop: a wide band draws no tooltip at all', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'Short', done: ['a', 'b'] })
  const ui = await $.ui.mount({ ...BAND(120), surface: 'desktop' })
  expect(findAllType(await ui.drawn(), 'Svg').length).toBe(0)
  await ui.unmount()
})

test('terminal still uses the in-band hover reveal (no Svg exists there)', async ($, on) => {
  await boot($, on)
  await setBrief($, { purpose: 'x'.repeat(200), done: ['a', 'b'] })
  const ui = await $.ui.mount(BAND(40))
  const root = await ui.drawn()
  expect(findAllType(root, 'Svg').length).toBe(0)
  expect(findAllType(root, 'Box').filter((b: any) => b.props?.display === 'none').length).toBe(1)
  await ui.unmount()
})
