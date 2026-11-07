import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Brief, ChatTimer, Draft, Git, Meter, Share, Water } from '../types'

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

// A gap longer than this starts a new working period (breaks inside a period are counted, not reset).
const PERIOD_GAP_MS = 4 * 60 * 60 * 1000

const MAX_RUNS = 40
const emptyMeter = (): Meter => ({ startedAt: 0, lastActive: 0, active: 0, idle: 0, inTurn: false, runs: [] })
// The working period is shared by every session; `sess` is this chat's own active time.
const period = atom({ plugin: 'session-brief', key: 'period' } as const, emptyMeter())
const sess = atom({ plugin: 'session-brief', key: 'sess' } as const, emptyMeter())

// ---------- share tracker (per project) ----------

type Plat = 'linkedin' | 'x'
const PLATS: readonly Plat[] = ['linkedin', 'x']
const PLAT_LABEL: Record<Plat, string> = { linkedin: 'LinkedIn', x: 'X' }
const MAX_LOG = 100
// Nudge when this many updates are unshared, then again every this many more.
const NUDGE_AT = 3

const emptyShare = (): Share => ({ log: [], shared: { linkedin: 0, x: 0 }, drafts: {}, nudged: 0, drafting: '' })
const share = atom({ plugin: 'session-brief', key: 'share' } as const, emptyShare())
const git = atom(
  { plugin: 'session-brief', key: 'git' } as const,
  { kind: 'none', ahead: 0, dirty: 0, branch: '' } as Git,
)

// Platform logos and the megaphone in four tints (none / a few / several / many unshared), 36px and 44px PNGs.
const SHARE_PNG = {"linkedin": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAEtElEQVR42u2YTWxUVRTHf+feNzP9mIFC+QZrFASRoICmBF1IWGGg0cSVMdEEtWpMhA10OWFhSEoMSnRhjJ8RY0hcqbhzJS4A0WKiNZAIKR8mIEKnX/Peu/e4eK8fg31tU9uuvMnNvNxz3r3/ez7+57wRymXDwYOejm9fxJrX8X4d6nOAMLtDERNhbTdR9A6du96nXDbJoQe+fouGeXsJh8BFzOmwOcjXQf/toxxu2yt0nNhDffEDBisORRDMnAJSPIJSX7IM9r1gwB8grHpU5x4MgGBQlRTD/gBkDS40iGTogxFBAa86S6DE4EIQ7jOAzdIzIqiCG4rw1Th9d3YjymSDFnwYUwgMj65dzMP3LASvaOxnFVSQZRkfxmxa1cSxZzfzwJIiAN9d+Itnjp3lel+IBIn1ZnqY8WJGVcnnLJ+lYGKvxF7ZsaaZI09uQCOHmSUzmfFcpaFj7bISG5YU8aoERjAiOFV2rG6mvlTAxX5WmNNkRDOVaoxXTYJaFecT/wxEjjh2iJkjC3lVbM5y6c8Kn569gjWCFSFnk9+jJy8SDcYYk1BBdlKMzv8c1F4VyVle/fIXrvUOsXv9Uqqx5+Mzl3n3+z8wdQGqWusyAZQEqIJ3HlRBBDGCMTJi5Yl5suMbzbxi5KAaQ10ACgzF0JBL2CJyMNZtXpP1MAYjlIoFinlL1XluVqoQOqQ+h07HQlYENxTxxIPLObRzHbFXrAih8zx/vIvui3+z5/HVvLbtblwa9H3VmJ0fnuaxNc3s376ajctKFAuWaqxcuNHPR2d6eO+HS5jAoIkxpw5IBIiVbS0LeGj5vBrZ/UuKdP9+ne33LmTLylrZkbb1tLe21KwV89Dc0sTWlia2rJrPy190YQqJy6eeZWlMDEYer0roPJH3OFXCOImL/jAekXlNeKq9tQXndeT2zo9maeQ87a0ttG1agR+MsBlZOmF1N5Kw9vC0IiNZM3bdiBCkwWyNUI0cnuQZIX1P8Kq8svWuCVu/YKb4wysoSseJbo6fvUIpH/DGrvU8tWFpQiXpZTavmE9DqcDAUIyMQx0z0v/EXjECn/x4mTe/+o2eSpVfr97mueNd3ByIEvZPj17UkGdpYx68IuOQ1IwAGt7385+vYusCcoEhaMxTqVTputab1sdEJ2eFYiEgqzLPiMtsiuhGf4QTQX3K0qr0pn3UcKoLEBjJzPtZbVk1o6GbqJzMfQ89rWr/P6ApAtJpyqajNyVANmXX4anKSOtqhVpZRrCaKepNKe37whgjQt6O7tAfJmk8GPl/yaqRry0LCmGsk+tN1g8NN/rFQsAjq5oSTgGGYs+pnlvEsWdRqcDGZaUR/f7QcbrnFn7sHl5Z2VTPusWNw70aA5HjVM8tsnq17AaNlF5DV7tWCJLTnCZN2lhyyY/zzek8xH5yvTEuc1lfryKCqc/VuMCpgoJYwQTjyO7cIzCYnJ1Ubxi+Ac5j8x5VP16GOK+jc8xGqtmyO408qZ6qTzBw3oAcJl8wiCiKn3PiUTwimmDwhy0nj/1E69MLaJi3DdWkMs7lCHJCXaNhoPdtOtsOGcplQ+fufQz2v4RwDjHhNPhsun/phQjnGKi007l7H+Wy+QcUu06c/kLuhwAAAABJRU5ErkJggg==", "x": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAADQElEQVR42s2YXYhNURTHf+feIUMKSbz4KDUeBnkZk7eRoZRSU9Q8jJFoHqR8pDyQwZSEIh/NiweaN4VSnjA1xIg00hh5YUJopvEVzcy953jw31pzOvfec858mFO7e89ee6/132uv/zp7bfj7VAMdwG/AB4IJar5sPhAGAKqAgQkEUah9FRY61TH8H8E4250ekAMygMfIJ0fhJxsxvtQTAPki8wPA9/Rn0jxlESg9xVSLPJdX8Hl6zwC7gYXqz8TwTKBxJ4EPwD5gibEXOcG1nEBsL2JkbYK4c2P2aG4jMCg7UeMjqegL1ApgHvAS6FWrk+JzMUAN6feM5mwN2YgFKDDon0tRg5F9BuYD5UC3CdZCnrluct0vEwJBEkBWYYsUXjWyW8ZITs2PWNBjYCqwGPhYBHwsQL4xVA1M15Y5hU0C1RxagJO/lSdnAF0hoKkAWeVvxMgao/gnUCH2PDEx4wPfgJUCfCdh4o3NkksycNrIHom2lYqPIS1io8a2pvgKJErtG2Soy8iOqm+v3nfp/VCIaWMKyDHjPTATWC5DLqCr5Kn6EL2HU5weYg90Adkmo/tN8L9S8AKsj0nvUQOyW7dFxu8aWav6mkZ5ekg0OK/Wrwy+QOcY571NAnUjAc1HBcgauS3K1xuwn4C5AvvFLGBcAfkG1DJ5pM3Ib6qvLuXWJQbjDDTK8DRgFvDOeGNn6HOTGy9ALqecMAHcrv/rQll8qVJErzk9jCkg55lrAlCjc00AHFDfWTP+ofpqE+akRGDalQArgD4jG1SyLANemHlHBOp8gniKzarXwBxgNtBjZE7+TKxbFZHFp5g5+bH42vfJKx5wP2K14bPTQUOCHgFaLX25tAc0R+8hxYtlzXCBsXlgjcbeM/KL6jsWY+tK0nublB0v8fXOm60tBxYpizv5Zul5WiIVFFXeLCU7YjLFLeKCqTD61bqVxSvNtvlxADnXnzK0zcXY+zCo2iJlVEOIEP9aVKGYBX7I3YdV1GVNsVjqcYXjFeCyMeorLWS14O9i7IhiMW4pHaSo5VOX0vkSlw3ZlGDs5ULcMt7PKKF5EbcdZWppPeMZHVEtvHhPWCbNhdWAu7CaDFd6He5K7w9+N54kmuH/WwAAAABJRU5ErkJggg==", "github": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAADD0lEQVR42s2YO2gUQRjHf3t3iYWiImqhSIIEo6BC7ERRsQ2IFtoHrWIaRQTtNIiNkFbwUWitiMbKxlcjVgHfCYj4SFBQ1Kjxkt2z8P/Bx3jZmz3wkoFhd2dn/t9/v+fMApT42w4BI8BvIANq/7lnkjUi2TguDLWAQKM+ZGT6NDADpHNAJJXsGtCXAM+BdaHKWtwyXV8lYldmfrQ0kaqKtppz/EQdZ4ZE2k6KAjdDKC2g0bSo9osQqgVrHgJ3gafAR71bAWwEdgHbA/ykiPpjIsHurwA9Ebg9mlsPI69Hk5kAep3AElBRL6vbs4/WXq2NJRVF5o1LDdYqAalKMOZbtzBiSOWm9hT4DmwScDuwBVgSYbKlMlubnjcDk0ozWTOELHv2OxOt19h74IQEHgAG1Pdr7CQwLsGdzoQDAXY0IVPrE4HZV+5uojRsdSYuKypnNV2pQSo/r3ub905AZk5cLZpxY2aWKvDBaTgVppfRMOzNvlWgS3Pa3K4ga6Byb/IMOBtgdAHTgaxck5kqx6RmS2jL5ZS1yP2S4XxxQZAIc2w2s5VyMvJ4UHjXAAtdrWrUSi7aVuu+LMyJQNY/i+q16eC5WoCMF5ZqbYiV+xX12uLA+d4Cn525YncEn5xjZwF2FCEb69DCTA45CQzrfTWHmBGZ1twbwE/5TibMjjyF5DnkjmC/s1I7zNgcNKIdgOWyBNjZoITUHbSwvOgcul9OuQw4B4wC34KIy4CvwDPgjBzaosuC40IgI4pQpv4DWAssAq4CjwLtHnU5x/LO4cAUfvfYKcwsJ3U0rGXDDvwlcE01rRt47ObaF1/X3AXO3Fb9bzdby0JSgwLcFjH3gdNKyZnqdASZqA2aAZwS8CrgCHAsyLg2755ItDvNDkaSiSLkgW66kAW4H/hQDbjj3m8AbhUgE03IA/4CLgH7gNdOQxbGL4A9wGXNLUKmVvQYVPhYU3RNM+cy08hsh0G/GygXPSzOu6N0SRk3y9vBtehnQwaMllX49jpCyRyQMfMen5c/rKzuHFR1nmrhL72p8JfeHzzJmZpByxWhAAAAAElFTkSuQmCC", "mega0": "data:image/png;base64,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", "mega1": "data:image/png;base64,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", "mega2": "data:image/png;base64,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", "mega3": "data:image/png;base64,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"} as const
const imgSvg = (png: string, px: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"><image width="${px}" height="${px}" xlink:href="${png}" href="${png}"/></svg>`


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

const asMeter = (x: unknown): Meter => {
  const o = x as (Partial<Record<keyof Meter, unknown>> & { runs?: unknown }) | null
  const runs = (Array.isArray(o?.runs) ? (o.runs as unknown[]) : [])
    .map(r => ({ start: num((r as { start?: unknown })?.start), end: num((r as { end?: unknown })?.end) }))
    .filter(r => r.start > 0 && r.end >= r.start)
    .slice(-MAX_RUNS)
  return { startedAt: num(o?.startedAt), lastActive: num(o?.lastActive), active: num(o?.active), idle: num(o?.idle), inTurn: o?.inTurn === true, runs }
}

/**
 * Count the time since the last activity as active (a short gap, or a turn in progress) or idle
 * (a long gap), then make now the last activity. A short gap extends the current work session; a
 * long one closes it and opens the next. `resetAfter` starts a fresh meter after a very long gap.
 */
const tickMeter = (m: Meter, now: number, kind: 'prompt' | 'done', resetAfter = 0): Meter => {
  if (!m.startedAt || (resetAfter > 0 && now - m.lastActive > resetAfter)) {
    return { startedAt: now, lastActive: now, active: 0, idle: 0, inTurn: kind === 'prompt', runs: [{ start: now, end: now }] }
  }
  const d = Math.max(0, now - m.lastActive)
  const isActive = m.inTurn || d <= BREAK_MS
  // A store from before sessions were listed has no runs: start with one covering what we know.
  const runs = m.runs.length ? [...m.runs] : [{ start: m.startedAt, end: Math.max(m.startedAt, m.lastActive) }]
  const last = runs[runs.length - 1]!
  if (isActive) runs[runs.length - 1] = { start: last.start, end: Math.max(last.end, now) }
  else runs.push({ start: now, end: now })
  return {
    ...m,
    active: m.active + (isActive ? d : 0),
    idle: m.idle + (isActive ? 0 : d),
    lastActive: Math.max(m.lastActive, now),
    inTurn: kind === 'prompt',
    runs: runs.slice(-MAX_RUNS),
  }
}

/** 45s, 40m 12s, 1h 25m: seconds while it is under an hour, as asked. */
const fmtDur = (ms: number) => {
  const t = Math.max(0, Math.floor(num(ms) / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  if (h > 0) return `${h}h ${pad2(m)}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

/** Today -> "6:58 PM", yesterday -> "yest 6:58 PM", older -> "Nov 6 6:58 PM". */
const dayTime = (ms: number, now: number) => {
  const d = new Date(ms)
  const n = new Date(now)
  const sameDay = d.toDateString() === n.toDateString()
  const y = new Date(n)
  y.setDate(n.getDate() - 1)
  const mon = d.toLocaleString('en-US', { month: 'short' })
  const when = sameDay ? '' : d.toDateString() === y.toDateString() ? 'yest ' : `${mon} ${d.getDate()} `
  return `${when}${clockTime(ms)}`
}

/** Multi-line text from storage or the model: ANSI/control stripped, blank runs collapsed, clipped by characters. */
const block = (x: unknown, max: number) =>
  typeof x === 'string'
    ? Array.from(
        x
          .slice(0, max * 3)
          .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
          .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
          .replace(/\r\n?/g, '\n')
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim(),
      )
        .slice(0, max)
        .join('')
    : ''

const asDraft = (x: unknown): Draft | undefined => {
  const o = x as { text?: unknown; url?: unknown; at?: unknown } | null
  const text = block(o?.text, 1300)
  const url = typeof o?.url === 'string' && /^https:\/\//.test(o.url) && o.url.length <= 2048 ? o.url : ''
  return text && url ? { text, url, at: num(o?.at) } : undefined
}

/** A share state read back from the store: every field validated, nothing trusted. */
const asShare = (x: unknown): Share => {
  const o = x as { log?: unknown; shared?: Record<string, unknown>; drafts?: Record<string, unknown>; nudged?: unknown } | null
  const log = (Array.isArray(o?.log) ? (o.log as unknown[]) : [])
    .map(e => ({ at: num((e as { at?: unknown })?.at), text: clean((e as { text?: unknown })?.text, 160) }))
    .filter(e => e.at > 0 && e.text !== '')
    .slice(-MAX_LOG)
  const drafts: Share['drafts'] = {}
  for (const p of PLATS) {
    const d = asDraft(o?.drafts?.[p])
    if (d) drafts[p] = d
  }
  return {
    log,
    shared: { linkedin: num(o?.shared?.linkedin), x: num(o?.shared?.x) },
    drafts,
    nudged: Math.floor(num(o?.nudged)),
    drafting: '',
  }
}

const shareKey = (cwd: string) => `share:${cwd.slice(0, 300)}`
const projectName = (cwd: string) => clean(cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'this project', 60) || 'this project'
const unsharedFor = (s: Share, p: Plat) => s.log.filter(e => e.at > s.shared[p])
/** Updates not yet shared on at least one platform: what the badge counts. */
const unsharedAny = (s: Share) => s.log.filter(e => e.at > Math.min(s.shared.linkedin, s.shared.x)).length
const badgeLevel = (n: number) => (n <= 0 ? 0 : n < NUDGE_AT ? 1 : n < NUDGE_AT * 2 ? 2 : 3)
const badgeColor = ['subtle', 'suggestion', 'warning', 'error'] as const

const SYSTEM = `You write short social posts for a developer sharing progress on their own project. First person, plain and specific, no hype or buzzwords. Use only facts that are in the updates you are given: never invent dates, timeframes (such as "this week"), numbers, results or plans. Never include secrets, credentials, personal data, client names, file paths or private details; generalise anything that looks private. Output only the post text, with no preface and no quotes.`

const promptFor = (p: Plat, project: string, items: string[]) => {
  const bullets = items.slice(-20).map(i => `- ${i}`).join('\n')
  const ask =
    p === 'x'
      ? `Write one X post (max 260 characters, at most 2 hashtags)`
      : `Write a LinkedIn post (about 80 to 120 words, short paragraphs, at most 3 hashtags at the end)`
  return `${ask} about progress on the project "${project}". Updates since my last post, oldest first:\n${bullets}`
}

/** A plain draft from the update lines, for when the model is unavailable. */
const fallbackDraft = (p: Plat, project: string, items: string[]) => {
  const last = items.slice(-4)
  return p === 'x'
    ? block(`Progress on ${project}: ${last.slice(-2).join('; ')}`, 260)
    : block(`Progress update on ${project}:\n\n${last.map(i => `- ${i}`).join('\n')}`, 1000)
}

/** An https compose link, prefilled with the text where it fits (the clipboard always has the text). */
const composeUrl = (p: Plat, text: string) => {
  const base = p === 'x' ? 'https://x.com/intent/post?text=' : 'https://www.linkedin.com/feed/?shareActive=true&text='
  const url = base + encodeURIComponent(text)
  if (url.length <= 1900) return url
  return p === 'x' ? 'https://x.com/compose/post' : 'https://www.linkedin.com/feed/?shareActive=true'
}

/** `git status --porcelain=v1 -b` -> is the code pushed? */
const parseGit = (out: string): Git => {
  const lines = out.split('\n').filter(l => l.trim() !== '')
  const head = lines[0] ?? ''
  if (!head.startsWith('##')) return { kind: 'none', ahead: 0, dirty: 0, branch: '' }
  const dirty = Math.min(9999, lines.length - 1)
  const m = head.match(/^## (?:No commits yet on |Initial commit on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/)
  const ahead = Math.min(9999, Number(m?.[3]?.match(/ahead (\d+)/)?.[1] ?? 0))
  const kind: Git['kind'] = ahead > 0 ? 'ahead' : dirty > 0 ? 'dirty' : !m?.[2] ? 'noup' : 'clean'
  return { kind, ahead, dirty, branch: clean(m?.[1] ?? '', 40) }
}

/** Run a write that must never take the hook down with it. */
const safely = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch {
    // a lost redraw or a busy value is not worth failing the user's turn
  }
}

let lastGitAt = 0
/** Re-read `git status` for the project (hidden when it is not a repo or git is missing). Throttled unless forced. */
const refreshGit = async ($: any, force = false) => {
  await safely(async () => {
    const now = await $.clock.now()
    if (!force && now - lastGitAt < 3000) return
    lastGitAt = now
    const r = await $.process.run(['git', 'status', '--porcelain=v1', '-b'], { timeoutMs: 5000 })
    const g: Git = r.exitCode === 0 ? parseGit(String(r.stdout)) : { kind: 'none', ahead: 0, dirty: 0, branch: '' }
    await update($, git, () => g)
  })
}

// Share writes go through one queue, so parallel calls never fight over the saved value.
let shareQueue: Promise<unknown> = Promise.resolve()
/** Change the share state and keep it in the store, per project. Never throws. */
const commitShare = ($: any, fn: (s: Share) => Share): Promise<unknown> => {
  const run = shareQueue.then(() =>
    safely(async () => {
      await update($, share, fn)
      const cwd = await $.session.cwd()
      await $.store.set(shareKey(cwd), { ...(await read($, share)), drafting: '' })
    }),
  )
  shareQueue = run
  return run
}

/**
 * Open an https link in the user's default browser. No shell is involved, so "&" in a URL is safe.
 * A launcher that stays alive (some xdg-open setups wait for the browser) is not a failure: it timed out
 * only because the browser took over, so a timeout counts as opened.
 */
const openUrl = async ($: any, url: string): Promise<boolean> => {
  if (!/^https:\/\//.test(url) || url.length > 2048) return false
  const run = async (argv: string[]) => {
    const t0 = await $.clock.now()
    try {
      const r = await $.process.run(argv, { timeoutMs: 2500 })
      return r.exitCode === 0
    } catch {
      return (await $.clock.now()) - t0 >= 2400 // still running at the timeout: the browser is up
    }
  }
  let os = ''
  try {
    const r = await $.process.run(['uname', '-s'], { timeoutMs: 2000 })
    if (r.exitCode === 0) os = String(r.stdout).trim()
  } catch {
    // no uname: Windows
  }
  if (os === 'Darwin') return run(['open', url])
  if (os) return run(['xdg-open', url])
  return run(['rundll32', 'url.dll,FileProtocolHandler', url])
}

/** Record an activity (a prompt, or a finished turn) in the working period and in this chat's meter. */
const tickMeters = async ($: any, kind: 'prompt' | 'done') => {
  await safely(async () => {
    const now = await $.clock.now()
    const id = await $.session.id()
    const per = tickMeter(asMeter(await $.store.get('period')), now, kind, PERIOD_GAP_MS)
    const se = tickMeter(asMeter(await $.store.get(`sess:${id}`)), now, kind)
    await $.store.set('period', per)
    await $.store.set(`sess:${id}`, se)
    await update($, period, () => per)
    await update($, sess, () => se)
  })
}

/** XML-escape text placed inside an SVG. */
const xml = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Small stroke icons for the time card (16x16 viewBox, drawn at 14px).
const ICON_BODY = {
  clock: (c: string) => `<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>`,
  focus: (c: string) => `<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.6" fill="${c}"/>`,
  active: (c: string) => `<polyline points="1.5,9 4.5,9 6.5,3.5 9.5,13 11.5,8 14.5,8"/>`,
  breaks: (c: string) => `<path d="M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M11 7h1.2a1.6 1.6 0 0 1 0 3.2H11"/><path d="M5.5 2.5v1.5M8 2.5v1.5"/>`,
  started: (c: string) => `<path d="M3.5 14.5V2"/><path d="M3.5 3h8.5l-2 3 2 3H3.5"/>`,
  chat: (c: string) => `<path d="M2 3h12v8H7.5L4 14v-3H2z"/>`,
} as const
type IconKind = keyof typeof ICON_BODY
const iconSvg = (kind: IconKind, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON_BODY[kind](color)}</svg>`

/** The whole period on one line: work sessions as blue bars (the live one green), gaps are the breaks. */
const timelineSvg = (list: { start: number; end: number; live: boolean }[], spanEnd: number, startLabel: string, endLabel: string) => {
  const W = 240
  const t0 = list[0]?.start ?? 0
  const span = Math.max(1, spanEnd - t0)
  const bars = list
    .map(r => {
      const x = Math.min(W - 3, Math.max(0, ((r.start - t0) / span) * W))
      const w = Math.max(3, Math.min(W - x, ((r.end - r.start) / span) * W))
      return `<rect x="${x.toFixed(1)}" y="6" width="${w.toFixed(1)}" height="8" rx="4" fill="${r.live ? '#5BB85D' : '#4C9BEA'}"/>`
    })
    .join('')
  const label = (x: number, anchor: string, text: string) =>
    `<text x="${x}" y="28" font-size="10" fill="#9AA3AF" text-anchor="${anchor}" font-family="sans-serif">${xml(text)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="32" viewBox="0 0 ${W} 32"><rect y="6" width="${W}" height="8" rx="4" fill="#6b7280" fill-opacity="0.4"/>${bars}${label(0, 'start', startLabel)}${label(W, 'end', endLabel)}</svg>`
}

const RULES = `A "session brief" is shown to the user above their prompt and goes stale unless you keep it current. At the end of EVERY turn in which you did anything (edited files, ran commands, pushed, answered a question), as your last tool call before your final message, call ${TOOL} with: purpose (max 80 chars: what this session is for), and done (exactly 2 strings, max 70 chars each: the two most recent things you COMPLETED, newest first). The newest done line is also logged as a shareable progress update for the user's project, so make it a real, specific accomplishment written as one clear sentence (for example "Added login rate limiting"); never put questions, waiting states, plans or apologies in done, and keep secrets, credentials, personal data and client names out of it. If nothing new was completed, repeat the previous done lines unchanged. Keep it terse and factual, change purpose only when the goal changes, and do not mention this call in your reply.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    const now = await $.clock.now()

    const saved = asBrief(await $.store.get(`brief:${id}`))
    if (saved) await safely(() => update($, brief, () => saved))
    const savedTokens = num(await $.store.get(`tokens:${id}`))
    if (savedTokens > 0) await safely(() => update($, tokens, () => savedTokens))

    // Share tracker: this project's update log and what has been shared, plus its git status.
    const cwd0 = await $.session.cwd()
    const storedShare = asShare(await $.store.get(shareKey(cwd0)))
    await safely(() => update($, share, () => storedShare))
    await refreshGit($, true)

    // The glass is shared by every session too.
    const savedDrink = num(((await $.store.get('water')) as { lastDrink?: unknown } | undefined)?.lastDrink)
    await safely(() => update($, water, () => ({ lastDrink: savedDrink || now })))
    if (!savedDrink) await safely(() => $.store.set('water', { lastDrink: now }))

    // The work stretch is shared by every session (kept in the plugin store).
    const stretch = asStretch(await $.store.get('stretch'))

    // The working period (migrated from the old stretch the first time) and this chat's own meter.
    const storedPeriod = await $.store.get('period')
    let per = storedPeriod ? asMeter(storedPeriod) : emptyMeter()
    if (!per.startedAt && stretch) per = { ...emptyMeter(), startedAt: stretch.startedAt, lastActive: stretch.lastActive }
    if (!storedPeriod && per.startedAt) await safely(() => $.store.set('period', per))
    await safely(() => update($, period, () => per))
    const mine = asMeter(await $.store.get(`sess:${id}`))
    await safely(() => update($, sess, () => mine))

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
    let tick = 0
    $.clock.every(30000, async () => {
      tick += 1
      if (tick % 2 === 0) await refreshGit($)
      await safely(async () => {
        // Another session of this project may have logged or shared: pick it up.
        const cur = await read($, share)
        if (!cur.drafting) {
          const fresh = asShare(await $.store.get(shareKey(await $.session.cwd())))
          if (JSON.stringify(fresh) !== JSON.stringify(cur)) await update($, share, () => fresh)
        }
      })
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
            description: 'The two most recent things COMPLETED, newest first, max 70 chars each. The first is logged as a shareable update, so keep it specific and free of secrets or private details.',
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
    await safely(async () => {
      // Log the newest update (once), count what is unshared and nudge, in one queued write; then refresh git.
      const at = await $.clock.now()
      const line = next.done[0] ?? ''
      let nudgeN = 0
      await commitShare($, s => {
        const log = s.log.at(-1)?.text === line ? s.log : [...s.log, { at, text: line }].slice(-MAX_LOG)
        const grown = { ...s, log }
        const n = unsharedAny(grown)
        if (n >= NUDGE_AT && n >= s.nudged + NUDGE_AT) {
          nudgeN = n
          return { ...grown, nudged: n }
        }
        return grown
      })
      if (nudgeN > 0) $.ui.toast(`${nudgeN} updates not shared yet. Draft a post from the megaphone icon.`, { timeoutMs: 8000 })
      await refreshGit($)
    })
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
    await tickMeters($, 'prompt')
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
      await tickMeters($, 'done')

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
    // A fixed one-cell spacer: plain spaces collapse next to images, so gaps are real boxes.
    const gap: Seg = { t: ' ', spacer: true }

    // Share tracker: how many updates are not shared yet (the megaphone's badge), and git state.
    const sh = await read($, share)
    const gh = await read($, git)
    const unshared = unsharedAny(sh)
    const lvl = badgeLevel(unshared)
    const shareSegs: Seg[] = Svg
      ? [{ t: '   ', press: 'share' }, ...(unshared > 0 ? [gap, { t: String(unshared), c: badgeColor[lvl], bold: true }] : []), gap]
      : []
    // A line is a list of styled runs; widths are measured on their plain text.
    type Seg = { t: string; c?: string; bg?: string; bold?: boolean; press?: 'water' | 'share'; spacer?: boolean; group?: { key: string; segs: Seg[] } }
    const plain = (line: Seg[]) => line.map(x => x.t).join('')

    const left: Seg[][] = [
      [{ t: '◎ ', c: 'suggestion', bold: true }, { t: b.purpose, c: 'text', bold: true }],
      ...b.done.map((d, i): Seg[] => [{ t: '✓ ', c: 'success', bold: true }, { t: d, c: i === 0 ? 'text' : 'subtle' }]),
    ]

    // Working period: when you began (breaks inside it do not reset it), and active vs break time.
    // State held across a reload can come from an older version (no `runs` yet): re-validate it.
    const per = asMeter(await read($, period))
    const se = asMeter(await read($, sess))
    const periodStart = Math.min(num(per.startedAt) || startedAt, now)
    const timeRows: [string, string, string, IconKind, string][] = [
      ['Now', isIdle ? `idle ${fmt(now - lastActive)}` : `${fmt(now - startedAt)} focused`, isIdle ? 'warning' : 'suggestion', 'focus', isIdle ? '#E3A33B' : '#4C9BEA'],
      ['Active', `${fmt(per.active)} in this period`, 'text', 'active', '#5BB85D'],
      ['Breaks', fmt(per.idle), 'subtle', 'breaks', '#E3A33B'],
      ['Started', dayTime(periodStart, now), 'text', 'started', '#9AA3AF'],
      ['This chat', `${fmt(se.active)} active`, 'text', 'chat', '#9B8CF2'],
    ]
    // Work sessions of this period: each stretch between breaks, with its start and length.
    // No activity yet means no sessions (not a phantom 0s one); an old store without a list gets one from its start.
    const known = per.runs.length ? per.runs : per.startedAt ? [{ start: per.startedAt, end: Math.max(per.startedAt, per.lastActive) }] : []
    const runList = known.map((r, i) => {
      const live = i === known.length - 1 && !isIdle
      const start = Math.min(r.start, now)
      const len = Math.max(0, (live ? Math.max(r.end, now) : Math.min(r.end, now)) - start)
      return { start, end: start + len, len, live }
    })
    const shownRuns = runList.slice(-6)
    const earlierRuns = runList.length - shownRuns.length
    // Timeline items: each shown session, with the break between it and the one before it.
    const timeline: ({ brk: string } | { run: (typeof runList)[number] })[] = []
    shownRuns.forEach((r, i) => {
      const prev = shownRuns[i - 1]
      if (prev && r.start - prev.end >= 60_000) timeline.push({ brk: fmt(r.start - prev.end) })
      timeline.push({ run: r })
    })
    const lastEnd = runList[runList.length - 1]?.end ?? 0
    const barSvg = runList.length ? timelineSvg(runList, isIdle ? lastEnd : now, dayTime(runList[0]!.start, now), isIdle ? `last ${clockTime(lastEnd)}` : 'now') : ''
    // A group is a keyed Box holding the top chip's runs plus the time card: the same pattern as the
    // glass and megaphone cards. (t is the plain text, so width maths still sees the group.)
    const grp = (key: string, segs: Seg[]): Seg => ({ t: segs.map(x => x.t).join(''), group: { key, segs } })

    const appLine: Seg[] = [
      { t: '▣ ', c: 'subtle' },
      { t: `${fmt(now - openedAt)} app`, c: 'subtle' },
      ...(tok > 0 ? [{ t: ' · ', c: 'subtle' }, { t: `◆ ${compact(tok)}`, c: 'merged', bold: true }] : []),
    ]
    const right: Seg[][] =
      startedAt === 0
        ? [[glass, gap, ...shareSegs], [], []]
        : isIdle
          ? [
              [glass, gap, ...shareSegs, grp('timechip', [{ t: '⏸ ', c: 'warning', bold: true }, { t: ` idle ${fmt(now - lastActive)} `, c: 'inverseText', bg: 'warning', bold: true }])],
              [{ t: '◷ ', c: 'subtle' }, { t: 'last ', c: 'subtle' }, { t: fmt(lastActive - startedAt), c: 'text' }],
              appLine,
            ]
          : [
              [glass, gap, ...shareSegs, grp('timechip', [{ t: ` ${fmt(now - startedAt)} `, c: 'inverseText', bg: 'suggestion', bold: true }, { t: ' work', c: 'subtle' }])],
              [{ t: '◷ ', c: 'subtle' }, { t: 'since ', c: 'subtle' }, { t: dayTime(periodStart, now), c: 'text' }],
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
    // Draft a post for one platform from the updates not shared there yet, copy it, and keep it for "Open".
    const draftFor = async (p: Plat) => {
      const cur = await read($, share)
      const items = unsharedFor(cur, p).map(x => x.text)
      if (cur.drafting || items.length === 0) return
      await commitShare($, st => ({ ...st, drafting: p }))
      try {
        const cwd = await $.session.cwd()
        const project = projectName(cwd)
        let text = ''
        const r = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt: promptFor(p, project, items), maxTokens: 700 })
        if (r.isAnswered) text = block(r.text, p === 'x' ? 280 : 1300)
        if (!text) text = fallbackDraft(p, project, items)
        const at = await $.clock.now()
        await commitShare($, st => ({ ...st, drafts: { ...st.drafts, [p]: { text, url: composeUrl(p, text), at } } }))
        await safely(() => $.ui.copy({ text, surface: e.surface }))
        $.ui.toast(`${PLAT_LABEL[p]} draft ready and copied. Hover the megaphone and press Open.`, { timeoutMs: 6000 })
      } finally {
        await commitShare($, st => ({ ...st, drafting: '' }))
      }
    }
    // Open the prefilled compose page in the browser; if that fails, hand the link over via the clipboard.
    const openFor = async (p: Plat) => {
      const url = (await read($, share)).drafts[p]?.url
      if (!url) return
      if (await openUrl($, url)) {
        $.ui.toast(`Opening ${PLAT_LABEL[p]}. Review the post there, then press Post.`, { timeoutMs: 5000 })
      } else {
        await safely(() => $.ui.copy({ text: url, surface: e.surface }))
        $.ui.toast(`Couldn't open the browser. The ${PLAT_LABEL[p]} link is copied.`, { timeoutMs: 6000 })
      }
    }
    // The user says they posted: that platform is up to date as of now.
    const postedFor = async (p: Plat) => {
      const at = await $.clock.now()
      await commitShare($, st => {
        const drafts = { ...st.drafts }
        delete drafts[p]
        return { ...st, shared: { ...st.shared, [p]: at }, drafts, nudged: 0 }
      })
      $.ui.toast(`${PLAT_LABEL[p]} marked as shared. Nice.`, { timeoutMs: 3000 })
    }

    const ghText =
      gh.kind === 'clean'
        ? 'pushed'
        : gh.kind === 'ahead'
          ? `${gh.ahead} commit${gh.ahead === 1 ? '' : 's'} not pushed`
          : gh.kind === 'dirty'
            ? `${gh.dirty} file${gh.dirty === 1 ? '' : 's'} not committed`
            : 'no upstream, not pushed'

    // The megaphone: an image; hover opens the share card (absolute, so it adds no height).
    const shareNode = () =>
      Svg ? (
        <Box key="share">
          <Svg source={imgSvg(SHARE_PNG[`mega${lvl}` as 'mega0'], 22)} alt={`Share progress: ${unshared} updates not shared`} width={22} height={22} />
          <Box position="absolute" top={0} right={2} display="none" hover={{ display: 'flex' }} flexDirection="column" gap="sm">
            <Box gap={1}>
              <Text bold>Share your progress</Text>
              <Text color={unshared === 0 ? 'success' : badgeColor[lvl]}>{unshared === 0 ? 'all shared' : `${unshared} not shared`}</Text>
            </Box>
            {PLATS.map(p => {
              const n = unsharedFor(sh, p).length
              const d = sh.drafts[p]
              // One compact line: logo, "Name · status", then only the buttons this state needs.
              return (
                <Box gap={1} alignItems="center">
                  <Svg source={imgSvg(SHARE_PNG[p], 18)} alt={PLAT_LABEL[p]} width={18} height={18} />
                  <Text>
                    <Text bold>{PLAT_LABEL[p]}</Text>
                    <Text color="subtle">{' · '}</Text>
                    <Text color={n === 0 ? 'success' : badgeColor[badgeLevel(n)]}>{n === 0 ? 'up to date' : `${n} new`}</Text>
                  </Text>
                  <Box flexGrow={1} />
                  {n > 0 && !d ? (
                    <Button key={`draft-${p}`} label={sh.drafting === p ? 'Drafting…' : 'Draft'} onPress={() => draftFor(p)} />
                  ) : null}
                  {d ? (
                    <Button key={`draft-${p}`} label={sh.drafting === p ? '…' : '↻'} onPress={() => draftFor(p)} />
                  ) : null}
                  {d ? <Button key={`open-${p}`} label="Open" onPress={() => openFor(p)} /> : null}
                  {n > 0 || d ? <Button key={`posted-${p}`} label="Posted" onPress={() => postedFor(p)} /> : null}
                </Box>
              )
            })}
            {gh.kind !== 'none' ? (
              <Box gap={1} alignItems="center">
                <Svg source={imgSvg(SHARE_PNG.github, 18)} alt="GitHub" width={18} height={18} />
                <Text wrap="truncate-end">
                  <Text bold>GitHub</Text>
                  <Text color="subtle">{' · '}</Text>
                  <Text color={gh.kind === 'clean' ? 'success' : 'warning'}>{ghText}</Text>
                  {gh.branch ? <Text color="subtle">{` · ${gh.branch}`}</Text> : null}
                </Text>
              </Box>
            ) : null}
            <Text color="subtle" wrap="truncate-end">
              Nothing posts until you do.
            </Text>
          </Box>
        </Box>
      ) : null

    const timeCardNode = () =>
      Svg ? (
        <Box position="absolute" top={0} right={0} display="none" hover={{ display: 'flex' }} flexDirection="column" gap="sm">
          <Box gap={1} alignItems="center">
            <Svg source={iconSvg('clock', '#9AA3AF')} alt="Working time" width={14} height={14} />
            <Text bold>Working time</Text>
          </Box>
          {timeRows.map(([k, v, c, icon, ic]) => (
            <Box gap={1} alignItems="center">
              <Svg source={iconSvg(icon, ic)} alt={k} width={14} height={14} />
              <Text>
                <Text color="subtle">{`${k} · `}</Text>
                <Text color={c} bold>{v}</Text>
              </Text>
            </Box>
          ))}
          <Text bold>Work sessions</Text>
          {barSvg ? <Svg source={barSvg} alt="Timeline of this period: work sessions and breaks" width={240} height={32} /> : <Text color="subtle">No sessions yet</Text>}
          {earlierRuns > 0 ? <Text color="subtle">{`+${earlierRuns} earlier`}</Text> : null}
          {timeline.map(it =>
            'brk' in it ? (
              <Text color="subtle">{`╎ break ${it.brk}`}</Text>
            ) : (
              <Text>
                <Text color={it.run.live ? 'success' : 'suggestion'} bold>{'● '}</Text>
                <Text color="subtle">{`${dayTime(it.run.start, now)} · `}</Text>
                <Text color={it.run.live ? 'success' : 'text'} bold>{fmtDur(it.run.len)}</Text>
                {it.run.live ? <Text color="subtle">{' · now'}</Text> : null}
              </Text>
            ),
          )}
        </Box>
      ) : null

    const runs = (line: Seg[]): any[] =>
      line.map(x =>
        x.group ? (
          Svg ? (
            <Box key={x.group.key}>
              {runs(x.group.segs)}
              {timeCardNode()}
            </Box>
          ) : (
            <Box>{runs(x.group.segs)}</Box>
          )
        ) : x.spacer ? (
          <Box width={1} />
        ) : x.press === 'share' ? (
          shareNode()
        ) : x.press ? (
          Svg ? (
            // Desktop / editor / mobile: the glass is an image; the card (absolute, so no height) holds the info and the button.
            <Box key="glass">
              <Svg source={glassSvg(level)} alt={`Water glass, ${Math.round(level * 100)}% full`} width={22} height={22} />
              <Box position="absolute" top={0} right={2} display="none" hover={{ display: 'flex' }} gap={1} alignItems="center">
                {level <= 0 ? (
                  <Text color="error" bold wrap="truncate-end">
                    Empty. Time for water!
                  </Text>
                ) : (
                  <Text wrap="truncate-end">
                    <Text color={glassColor(level)} bold>{`${Math.round(level * 100)}%`}</Text>
                    <Text color="subtle">{` · empty in ${leftMin}m`}</Text>
                  </Text>
                )}
                <Button key="water" label={level <= 0 ? 'I drank' : 'Refill'} onPress={refill} />
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
          // A card only where the text is really cut off, never for a line that fits.
          const isCut = cells(full) > avail
          const hidden = !hasRight && plain(right[i] ?? []) !== ''
          const tip = `${full}${hidden ? `  ·  ${plain(right[i] ?? [])}` : ''}`
          // The card belongs to a hover group that only this line's own text joins, so the
          // time column, the glass and the other lines never open it.
          const group = `tip${i}`
          return (
            <Box flexDirection="column">
              <Box justifyContent="space-between">
                {isCut ? (
                  <Box hover={{ scope: group }}>
                    <Text>{runs(fit(l, avail))}</Text>
                  </Box>
                ) : (
                  <Text>{runs(fit(l, avail))}</Text>
                )}
                <Box>{hasRight ? runs(right[i] ?? []) : <Text>{''}</Text>}</Box>
              </Box>
              {isCut ? (
                Svg ? (
                  // Desktop / editor: a hover card (absolute, so no height) with the whole line.
                  <Box position="absolute" top={0} left={0} display="none" hover={{ scope: group, display: 'flex' }}>
                    <Text wrap="wrap">{tip}</Text>
                  </Box>
                ) : (
                  // Terminal: the full line expands in place.
                  <Box display="none" hover={{ scope: group, display: 'flex' }}>
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
