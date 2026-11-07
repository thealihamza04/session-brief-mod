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

Each line is color-coded with the terminal theme's own colors: `◎` purpose (blue), `✓` done (green, the older one dimmed), `●` active / `⏸` idle chips (blue / amber highlight), `◷` start time, `▣` app uptime, `◆` tokens (purple). When a line is cut off to fit a narrow window, hovering that line's own text (not the time column, the glass or the other lines) shows the full text (plus the hidden time column, if it was dropped) in a card that floats over the band and adds no height. The terminal has no floating cards, so there the full line expands in place.

## Water glass

A small glass icon sits at the start of the right column's first row and drains over 45 minutes through five levels: full, three quarters, half, low, empty. On the desktop app and editor it is an image (a filled glass and an empty glass, with the water cut to each level); in the terminal it is drawn with block characters (`▕█▏` ... `▕ ▏`). Hover the glass for a card with the level and time left; on the desktop the card is one compact line (`89% · empty in 40m`) with a **Refill** button (**I drank** when empty) (in the terminal, click the glass itself). The level is shared by all your sessions. When it is empty you get a toast once, then again every 15 minutes while you keep working, and none while you are away (30+ minutes without activity). Change `DRAIN_MS` in `hooks/register.tsx` to drain faster or slower.

The glass images are embedded in `hooks/register.tsx` as small PNGs. They were supplied by the mod's author; check the icons' licenses before redistributing or swap in your own.

## Share your progress (desktop app and editor)

A megaphone icon sits right beside the water glass at the start of the right column's first row, with a number when you have updates you haven't shared. It is tinted by how many are waiting (none, a few, several, many). Hover it for the share card:

- **LinkedIn and X rows:** each shows `up to date` or `N new`. **Draft post** asks the model to write a post from your unshared updates (a plain template if the model is unavailable), copies it, and shows an **Open ↗** link to the platform's compose page, prefilled where the platform allows. Nothing posts until you do. Press **Posted** once you have, and that platform counts as up to date.
- **GitHub row:** whether your code is pushed (`pushed`, `N commits not pushed`, `N files not committed`, or `no upstream`), read from `git status`. Hidden outside a git repo.
- **Per project:** the update log and what you have shared are kept per project folder, so work across sessions on one project counts together.
- **Nudge:** a toast at 3 unshared updates, and again every 3 more.

Every `set_brief` call logs its newest "done" line as an update, so keep those lines specific and free of private details; drafts are AI-written from them and you review before posting. The terminal has no images or floating cards, so there the updates are still logged and the nudge still fires, but the megaphone is not drawn. The platform logos and megaphone are embedded PNGs supplied by the mod's author; check their licenses before redistributing.

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

`stress.test.tsx` holds 107 edge-case tests (months-long uptimes, clock set backwards, corrupt saved data, 5 MB and hostile text, tiny terminals, wide emoji/CJK, 200 parallel `set_brief` calls, absurd token totals). Run them with:

```bash
claude plugin test .
```
