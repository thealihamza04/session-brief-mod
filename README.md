# session-brief

A Claude Code mod that draws three dim lines above the prompt:

```
◎ What this session is for                                   42m work
✓ Most recent thing done                                since 2:05 PM
✓ Second most recent thing done                            25h29m app · 184k
```

- **Left:** the session's purpose and the two latest results. Claude keeps them current by calling a `set_brief` tool at the end of each turn. They are saved per session, so reopening a session restores them.
- **Right:** a compact timer, the same in every session: your current work stretch (resets after a 30-minute break), when it started, how long the Claude desktop app has been running (read from the OS process list; falls back to when the mod was first seen), and this session's token total (input + output + cache writes, cache reads excluded).

## Colors, icons and hover

Each line is color-coded with the terminal theme's own colors: `◎` purpose (blue), `✓` done (green, the older one dimmed), `●` active / `⏸` idle chips (blue / amber highlight), `◷` start time, `▣` app uptime, `◆` tokens (purple). When a line is cut to fit a narrow window, hovering it shows the full text (plus the hidden time column, if it was dropped). On the desktop app and editor this is the browser's own native tooltip (an invisible, absolutely placed SVG `<title>`), so it never changes the band's height; the terminal has no tooltips, so there the full line expands in place.

## Install

At the prompt of a terminal `claude` session:

```
/plugin install session-brief --marketplace thealihamza04/session-brief-mod
```

From a shell:

```
claude plugin install session-brief --marketplace thealihamza04/session-brief-mod
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every new session.

## Notes

- A new session shows placeholder text until Claude's first `set_brief` call.
- The work stretch is saved in the mod's store, so a new session continues it instead of starting at zero.

## Tests

`stress.test.tsx` holds 50 edge-case tests (months-long uptimes, clock set backwards, corrupt saved data, 5 MB and hostile text, tiny terminals, wide emoji/CJK, 200 parallel `set_brief` calls, absurd token totals). Run them with:

```bash
claude plugin test .
```
