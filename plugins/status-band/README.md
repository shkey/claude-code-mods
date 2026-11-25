# status-band

A Claude Code mod that draws a band above the prompt: whether Claude is running, idle or waiting for you, the git state, context gauge, estimated cost, prompt cache countdown, tokens, measured time to first token and tokens per second, the tool calls and files, the permission gate, and the subagents with buttons to view or stop one. It redraws on session events. A small idle check picks up transcript changes that do not emit a turn event.

Needs Claude Code 2.1.287 or later (tested on 2.1.332). Mods are early access and their API may change between releases.

## Requirements and installation

- Claude Code with mod support. Tested on Claude Code 2.1.332 in the terminal.
- Git on PATH is optional at runtime. Without it, only the GIT row is omitted.
- No separate Python, Node.js, Bun, gateway, or other plugin is required at runtime.
- Historical metrics require the session transcript that Claude Code supplies. Without it, the band uses live events.

The mod reads the local session transcript and displays a short preview of tool targets. It does not upload transcript contents. Hide the TOOLS row or the whole band before sharing a screen that may contain sensitive arguments or paths.

Install and update from the marketplace using the [repository instructions](../../README.md).

To develop from this directory without installing, run `claude --plugin-dir .`.

## Look

The band is drawn in the visual language of the cockpit mods, and uses Claude Code's own theme keys, so it follows your theme (dark, light, colour-blind) and sits beside the other bands without colours of its own.

- A thin rail and an upper-case label, in the row's hue. Cockpit gives one hue to each subject (purple for git, orange for the session, blue for the project, teal for the day); the rows here are spread over those four hues so no two neighbours in the shipped order share one.
- Figures in the terminal's own text colour, dim for what is secondary. Green, amber and red appear only for the state of a value: a gauge turns amber at 60% and red at 85%, `+` is green, `−` is red, `↑` is amber.
- Thin-line gauges (`━━●────`) for the context window and for each rate-limit window, as in the cockpit usage band.

| Row | Theme key |
| --- | --- |
| SESSION | `merged` (purple) |
| INFO | `suggestion` (blue); only the status value uses `success` / `warning` / `inactive` |
| CONTEXT, TOOLS, TODO | `claude` (orange) |
| TOKENS, FILES | `suggestion` (blue) |
| SPEED, GATE | `remember` (teal) |
| AGENTS, GIT | `merged` (purple) |

To change a hue, edit `ROW_HUE` in `hooks/core.ts`.

## Rows

SESSION stays at the top of the band, even before the title or Recap arrives. INFO is second by default. The rows below SESSION follow `/status-band order`; git is last by default. A label with an arrow (`▸`/`▾`) is a button: press it to open or close that section's lines. `/status-band expand` and `collapse` do all at once, and the choices are kept between sessions.

| Row | Shows | Source |
| --- | --- | --- |
| SESSION | title (`Untitled` until available) and latest automatic Recap for the main session, on one line | local transcript: `custom-title` wins over `ai-title`; newest `system/away_summary` supplies Recap |
| INFO (`state`) | RUNNING / WAITING / IDLE first, with its clock, then model and effort (a 💭 when requests go out with thinking on), `project/dir`, last turn, Claude Code's version | derived from `turn.start`, `turn.complete`, `tool.check`, `tool.call` |
| GIT | branch, `±changed +added −removed`, `↑ahead ↓behind`, last commit and its age | `git status`, `diff --shortstat`, `log -1` every 60 s and after edits; what git-band showed |
| CONTEXT | gauge, tokens/window (`>200k` in red past 200k), 5H and 7D on small gauges, `cost~` (an estimate), `+added −removed` lines the edits changed, uptime and API time | `session.measure`; lines from the diff each Edit and Write returns |
| TOKENS | cache countdown, last request `in/out` and cache read/write, session totals and request count, subagent totals | `session.measure`, `turn.step` usage; a session already running when the mod loads starts from its transcript |
| SPEED | `ttft`, `tpot`, `tps`, `e2e` of the last request, p50 of the last 10 | `turn.step` stream timing |
| AGENTS ▸ | running, done, failed; what each running agent is doing. Open: one line per agent with model, task, current or last command, clock, context, steps, and `[view]` `[stop]`; its name opens its last three calls | `$.agent.list()`, `turn.start`, `turn.step`, `tool.call` |
| TOOLS ▸ | total calls in the main session and counts for the five most-used tools. Open: the last 10 individual calls, newest first, with time, tool, target and outcome; live entries also show measured duration and subagent when available | `tool.call` plus the main session transcript on load |
| FILES ▸ | edited and read files. Open: the last 10 with counts | `tool.call` inputs |
| GATE ▸ | allowed, asked, denied. Open: the last 10 checks | `tool.check` |
| TODO | the item in progress and the count done | `TodoWrite`, `TaskCreate`, `TaskUpdate` |

A row with nothing to show is left out.

SESSION resolves titles from the current transcript independently of request counters. On startup or transcript change it can look back beyond the regular tail; a manual title takes precedence. SESSION omits Recap if the transcript has none. It reads existing records and never runs a model request to generate one. The manual `/recap` command output is not tracked. During idle, the band checks transcript metadata every five seconds and reads at most the last 512 KiB when it changes.

CONTEXT prefers the engine's reported fill. If only the window size is available, `~` marks the latest same-model main request's input (including reported cached input), not the current draft or cumulative session usage. Without usable request data it shows an empty track and `ctx unavailable`.

## Commands

| Command | Does |
| --- | --- |
| `/status-band order` | show the order; with row names, put those first in that order, the rest after in the shipped order, e.g. `order git state` |
| `/status-band order reset` | back to the shipped order |
| `/status-band hide` and `show` | hide or show the band; with a row name (`hide git`) only that row |
| `/status-band expand` and `collapse` | open or close every section |
| `/status-band notify on` and `off` | desktop notification when Claude waits for you, and when a turn over a minute ends (off by default) |
| `/status-band reset` | clear counters, calls, files, gate and agent tracking |
| `/status-band debug` | how the last request was timed |

Row names: `state`, `context`, `tokens`, `speed`, `agents`, `tools`, `files`, `gate`, `todo`, `git`. A few aliases work (`info` for `state`, `ctx`, `session`, `cache`, `tool`, `file`, `agent`).

`[view]` shows that agent's transcript in the main view, `[main]` goes back. `[stop]` asks first, then aborts the agent's turn.

## Against the statusline script

Checked line by line against `statusline.py`. Everything it showed is here, except these:

| Statusline showed | Here |
| --- | --- |
| Directories added with `--add-dir` (`+/path`) | Not shown: the mods API has no list of them. |
| `fast`, vim mode, output style, worktree, PR and repo labels | Not shown: no mods API for them. |
| `>200k` from Claude Code's own flag | Shown when the context passes 200k tokens. |
| `+added −removed` from Claude Code's counter | Summed from the diffs of the edits made since the mod loaded; edits before that are not in it. |
| The provider after the model name (`GPT-6.2 Sol · provider`) | Not shown: the model name the API gives has no provider. |

When the mod loads in a session already under way, it reads the transcript once, so these start where the statusline had them and not at zero: the session totals and request count, the tool counts, the last request and the median of the last ten (`ttft`, `tps~`, `e2e`), the API time, the cache clock, the session's name, the effort and the thinking setting. The cache lifetime is the one the requests ask for (`1h` or `5m`); when that is unknown the countdown uses five minutes. A transcript over 128 MiB is not read.

## What it replaces

The git row does what the git-band mod did, and AGENTS, TOOLS, FILES and GATE cover the parts of flightdeck that were used daily. To drop the two mods, disable them in `/plugin`, or `/cockpit off git-band`.

## State is derived

Claude Code 2.1.332 has no event for "busy, idle or waiting for you". RUNNING starts with a turn and IDLE ends it. WAITING shows while a permission check has answered `ask` and while a question is open; the next request or tool call ends it. Other waits (a dialog, a sandbox request) are not shown.

## How speed is measured

The `turn.step` hook watches each request's stream and forwards every chunk unchanged.

- `ttft`: from sending the request to its first text, thinking, tool or input chunk. It includes hooks beneath this one, the network and the gateway.
- `tps` and `tpot`: output tokens over the time between the first and the last content chunk. Shown only when the response was streamed: no thinking, at least 8 content chunks, a window of at least 0.5 s, at most 600 tok/s.
- `tps~`: output tokens over the whole request, so it includes `ttft` and any thinking the server did before it streamed. It stands in when decode speed is not measurable.

With thinking on, the server often holds the response back and sends it in one burst, so decode speed cannot be measured from the client. `/status-band debug` says which rule skipped it.

## Files

- `hooks/register.tsx`: hooks and drawing. `hooks/core.ts`: pure logic. `hooks/kit.tsx`: element helpers.
- `tests/`: `claude plugin test`. `claude plugin validate .` checks the manifest and what the hooks call.
