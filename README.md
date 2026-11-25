# Claude Code mods

A marketplace for independent Claude Code mods.

- [status-band](plugins/status-band/README.md): session and activity metrics above the prompt.
- [prompt-timeline](plugins/prompt-timeline/README.md): clickable prompt ticks beside the fullscreen transcript.

## Install

```sh
claude plugin marketplace add shkey/claude-code-mods --scope user
claude plugin install status-band@claude-code-mods --scope user
```

Start a fresh Claude Code session without a development `--plugin-dir` for the same plugin.

## Use status-band

| Area | What you can see or do |
| --- | --- |
| SESSION and INFO | Identify the conversation, read its latest automatic recap, and see whether Claude is idle, running, or waiting. |
| CONTEXT, TOKENS and SPEED | Follow context use, token counts and request timing. `tps~` is an end-to-end estimate, not decode speed. |
| TOOLS, FILES and GATE | Click a row with an arrow to expand its recent details. TOOLS shows totals by tool and opens the last ten calls. |
| AGENTS and GIT | Inspect subagents and see the worktree status. The GIT row is omitted when Git is unavailable. |

Use the commands below to customize the display. Settings are local to your Claude Code installation.

```text
/status-band order
/status-band hide tools
/status-band show tools
/status-band expand
/status-band collapse
```

For troubleshooting, verify that the plugin is enabled with `claude plugin list`. Open a new terminal session without a duplicate development copy. If the band appears but lacks history, that session may not provide a transcript. See the [plugin guide](plugins/status-band/README.md) for all rows and commands.

## Update

```sh
claude plugin marketplace update claude-code-mods
claude plugin update status-band@claude-code-mods --scope user
```

## Uninstall

```sh
claude plugin uninstall status-band@claude-code-mods --scope user
claude plugin marketplace remove claude-code-mods
```

Removing the marketplace also removes any other mods installed from it. No personal Claude Code settings are distributed with this repository.

## Upstream references

- [Better Claude / Image Preview](https://github.com/midudev/better-claude/tree/79282ad5c55313a65ab5e0de103d5eda99292e4c/plugins/image-preview): full source import, pinned to `79282ad5c55313a65ab5e0de103d5eda99292e4c`. The original [README](plugins/image-preview/README.md) and [MIT license](plugins/image-preview/LICENSE) are preserved. Its installation examples target the upstream marketplace; install `image-preview@claude-code-mods` to use this repository's copy after publication. Enable only one copy per session.
