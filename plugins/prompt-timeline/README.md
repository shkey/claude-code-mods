# prompt-timeline

A right-hand timeline for the main conversation in Claude Code's fullscreen terminal. Each tick shows a one-line preview of one text prompt. Long previews end in an ellipsis. Click a tick to reveal the original prompt. Click `回复` to jump to the first text reply in that turn. The reply button only appears once the local transcript has a text reply. The heavier tick marks the prompt associated with the visible transcript. Scroll inside the pane to browse ticks that do not fit.

Tested with Claude Code 2.1.332. The shared pane uses the renderer's width rules: an automatic open requires at least 144 columns on this version. At 110–143 columns, run `/prompt-timeline` to open it. Below 110 columns or in classic mode the mod does not render the timeline. The plugin requests the minimum dock width of 24 columns. A width remembered by Claude Code takes priority. If the dock is wider, drag its left divider to the right. The pane shares space with other docked panes; it does not replace the native scrollbar.

## Try locally

From the marketplace checkout:

```sh
claude --plugin-dir ./plugins/prompt-timeline
```

Use the fullscreen renderer. Close the pane with its native close button and reopen it with `/prompt-timeline`. No persistent settings are changed by the mod.

## Implementation

The index reads the current session's local transcript. It uses message IDs instead of text to distinguish repeated prompts. It follows the active branch and does not list tool results, slash commands, subagent transcripts, or attachment-only prompts. The mod does not modify the transcript or send its contents over the network.

The docked pane and message-jump design were inspired by [prompt-rail](https://github.com/oikon48/prompt-rail).
