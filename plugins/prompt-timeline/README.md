# prompt-timeline

A right-hand timeline for the main conversation in Claude Code's fullscreen terminal. Each tick shows a one-line preview of one text prompt. Long previews end in an ellipsis. Click a tick to reveal the original prompt. Click `回复` to jump directly to a single text reply. When a prompt has several reply segments, click `回复 N` to expand their numbered previews, then click a preview to jump to that segment. Click `回复 N` again to collapse the list. Tool-only rows and API errors do not count as replies. The heavier tick marks the prompt associated with the visible transcript. Scroll inside the pane to browse ticks that do not fit.

Each prompt that triggered tool calls also has a separate `工具 N` button. Click it to list those calls in the order the model made them, then click an entry to jump to that tool row, or to its folded group when Claude Code draws the call inside one. Click `工具 N` again to collapse the list. One list is open at a time: opening replies or tools closes the other, and opening one on another prompt closes the previous. Entries show the tool name and, for a few tools, a short safe target: a file's base name for `Read`, `Edit` and `Write`, the host for `WebFetch`, the subagent type for `Task` and the skill name for `Skill`. Commands, search patterns, queries and URL paths or credentials are never shown. In a narrow pane the button moves to its own line below the prompt so the prompt and `回复` keep their usual width.

Tested with Claude Code 2.1.332. The shared pane uses the renderer's width rules: an automatic open requires at least 144 columns on this version. At 110–143 columns, run `/prompt-timeline` to open it. Below 110 columns or in classic mode the mod does not render the timeline. The plugin requests the minimum dock width of 24 columns. A width remembered by Claude Code takes priority. If the dock is wider, drag its left divider to the right. The pane shares space with other docked panes; it does not replace the native scrollbar.

After compaction, older prompts can remain in the timeline even when Claude Code no longer renders their messages. If a jump to a prompt, reply or tool call fails and the transcript confirms that the message holding it was not retained, the mod points you to the local transcript and the `Ctrl+O` compaction summary. Retained messages still use the normal jump path.

## Try locally

From the marketplace checkout:

```sh
claude --plugin-dir ./plugins/prompt-timeline
```

Use the fullscreen renderer. Close the pane with its native close button and reopen it with `/prompt-timeline`. No persistent settings are changed by the mod.

## Implementation

The index reads the current session's local transcript. It uses message IDs instead of text to distinguish repeated prompts. It follows the active branch and does not list tool results, slash commands, subagent transcripts, or attachment-only prompts. The mod does not modify the transcript or send its contents over the network.

The docked pane and message-jump design were inspired by [prompt-rail](https://github.com/oikon48/prompt-rail).
