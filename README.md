# Claude Code mods: statusline, prompt timeline, and image preview

An independent plugin marketplace for the Claude Code terminal. See context and token usage at a glance, jump back to earlier prompts and replies, or preview pasted images before sending. Install only the plugins you want.

| Plugin | What it does |
| --- | --- |
| [status-band](plugins/status-band/README.md) | A statusline above the prompt with context usage, token counts, request timing, tool activity, subagents, and Git status. |
| [prompt-timeline](plugins/prompt-timeline/README.md) | A sidebar for conversation navigation. Click a prompt or reply to jump to its message in the current view. |
| [image-preview](plugins/image-preview/README.md) | Hover a pasted image label to preview it. Click to open the original in your system viewer. |

Tested with Claude Code 2.1.332. Prompt navigation and image hover use the fullscreen terminal renderer.

## Install

Add the marketplace once, then run the install commands for the mods you want:

```sh
claude plugin marketplace add shkey/claude-code-mods --scope user
claude plugin install status-band@claude-code-mods --scope user
claude plugin install prompt-timeline@claude-code-mods --scope user
claude plugin install image-preview@claude-code-mods --scope user --config window=true
```

If this marketplace is already installed but a mod is missing, refresh it using the first command under [Update](#update). Restart Claude Code without a development `--plugin-dir` for the same mod. Use Claude Code's fullscreen terminal renderer for the timeline and image hover. Select it in `/config`, or set `"tui": "fullscreen"` in your Claude Code settings.

If you already use Better Claude's Image Preview, disable that copy before running this one. This leaves it installed:

```sh
claude plugin disable image-preview@better-claude --scope user
```

## Use and configure

### status-band

The band appears above the prompt. Click rows with an arrow to see tool-call, file, permission, or agent details. When more than five tool types are counted, click `[all N types]` to see every type and its count above the recent calls. Click `[history]` in the Git row or run `/status-band git` to browse commits reachable from the local `HEAD`. Scroll in the pane and click `Load older commits` to load the next page. Git is optional; without it, the Git row is omitted. Historical metrics depend on the current session's local transcript. `tps~` is an end-to-end estimate, not decode speed.

Use these commands to inspect or change local display preferences:

```text
/status-band order
/status-band hide tools
/status-band show tools
/status-band expand
/status-band collapse
```

See the [status-band guide](plugins/status-band/README.md) for all rows and commands.

### prompt-timeline

Click a prompt in the fullscreen terminal's right-hand pane to jump to it. Click `回复` to jump to a single reply, or `回复 N` to choose a segment when the prompt has multiple replies. Click `工具 N` to list that prompt's tool calls and jump to a call or its folded group. Recognized Bash commands show a short preview without raw arguments. After compaction, older entries can remain in the timeline even if Claude Code no longer displays those messages. Scroll within the pane to see more entries. Use the native close button to hide it. To reopen it, run:

```text
/prompt-timeline
```

On Claude Code 2.1.332, the pane opens automatically at 144 columns or more. At 110–143 columns, open it with the command. Below 110 columns or in classic mode, it does not render. There are no mod-specific settings. If Claude Code remembers a wider dock, drag the divider to resize it. See the [prompt-timeline guide](plugins/prompt-timeline/README.md) for details.

### image-preview

Paste an image in fullscreen mode. Hover its `[Image #N]` label above the input to preview it. Move away to dismiss the preview, or click the label to open the original. Hover is also available on supported image labels in sent messages. Mouse and image rendering support depend on the terminal.

The `window` setting defaults to `true`: where supported, the mod can fall back to a floating desktop window. Set it to `false` to keep hover previews in the terminal when there is room. If there is no room, you can still click the label to open the image. For an existing installation, open the configuration dialog:

```text
/plugin configure image-preview@claude-code-mods
```

The upstream guide documents [platform requirements and rendering fallbacks](plugins/image-preview/README.md). Its installation examples point to the Better Claude marketplace; use the commands above to install this repository's copy.

## Update

Refresh the marketplace and update each mod you installed. Restart Claude Code afterward.

```sh
claude plugin marketplace update claude-code-mods
claude plugin update status-band@claude-code-mods --scope user
claude plugin update prompt-timeline@claude-code-mods --scope user
claude plugin update image-preview@claude-code-mods --scope user
```

To check the installed source, version, scope, and enabled state:

```sh
claude plugin list --json
```

## Uninstall

Run the commands for the mods you want to remove:

```sh
claude plugin uninstall status-band@claude-code-mods --scope user
claude plugin uninstall prompt-timeline@claude-code-mods --scope user
claude plugin uninstall image-preview@claude-code-mods --scope user
```

If you no longer want any mods from this marketplace, remove the marketplace too:

```sh
claude plugin marketplace remove claude-code-mods
```

## Upstream & acknowledgments

Thanks to the maintainers of these projects. The source import is listed separately from design references: you do not need to install any of these upstream plugins to use this marketplace.

| Project | Relationship |
| --- | --- |
| [Better Claude / Image Preview](https://github.com/midudev/better-claude/tree/79282ad5c55313a65ab5e0de103d5eda99292e4c/plugins/image-preview) by midudev | **Source import.** This repository ships the upstream plugin pinned at `79282ad5c55313a65ab5e0de103d5eda99292e4c`. The [MIT license and copyright notice](plugins/image-preview/LICENSE) are preserved. Local differences: Windows/WSL viewer launch and no in-band hover fallback when the transcript is short. |
| [prompt-rail](https://github.com/oikon48/prompt-rail) by oikon48 | **Design reference.** Inspired `prompt-timeline`'s docked prompt markers and click-to-jump interaction. |
| [Cockpit](https://github.com/MatheusChiodi/cockpit) by MatheusChiodi | **Design reference.** Inspired `status-band`'s theme-based colors, thin gauges, and Git summary. |
| [Claude Flightdeck](https://github.com/scasella/claude-flightdeck) by scasella | **Design reference.** Inspired `status-band`'s subagent controls and permission summaries. |
| [context-band](https://github.com/EricJamie/claude-code-mods) by EricJamie | **Design reference.** Informed early `status-band` context layouts and color experiments. |
