import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, Timer } from 'claude-code'
import { activePrompt, indexRows, jumpNotice, parseRow, preview, promptText, rowKey } from './core'
import type { Prompt } from './core'

type ListKind = 'details' | 'reply' | 'tool' | ''

const PANE = 'prompt-timeline'
const CHUNK = 256 * 1024
const MIN_PREVIEW = 8
// A new key keeps hot reload from reading the old reply-only state shape.
const view = atom({ plugin: 'prompt-timeline', key: 'detailView' } as const, { prompts: [] as Prompt[], current: '', expanded: '', kind: '' as ListKind })

const jumpMarker = atom({ plugin: 'prompt-timeline', key: 'jumpMarker' } as const,
  null as { target: string; sequence: number } | null)
let markerTimer: Timer | undefined
let jumpSequence = 0
let markedSequence = 0

async function markJump($: EngineInterface, target: string, sequence: number) {
  if (sequence <= markedSequence) return
  markedSequence = sequence
  markerTimer?.cancel()
  markerTimer = $.clock.after(1500, () => {
    if (markedSequence === sequence) void update($, jumpMarker, marker => marker?.sequence === sequence ? null : marker)
  })
  await update($, jumpMarker, marker => markedSequence === sequence ? { target, sequence } : marker)
}

type TranscriptRow = RenderInput<'UserMessage' | 'AssistantMessage' | 'ToolUse' | 'ToolGroup'>
async function withJumpMarker($: EngineInterface, e: TranscriptRow, drawn: RenderElement) {
  if (e.surface !== 'terminal' || e.viewport?.isFullscreen === false || e.props.onScreen === null) return drawn
  const marker = await read($, jumpMarker)
  if (!marker || rowKey(marker.target) !== rowKey(e.requestId)) return drawn
  const { Box, Text } = $.ui.resolve(e)
  return <Box flexDirection="column">
    {drawn}
    <Box key="timeline-jump-marker" position="absolute" left={0} top={e.props.onScreen?.first ?? 0}>
      <Text color="suggestion" bold>▍</Text>
    </Box>
  </Box>
}

let path = ''
let offset = 0
let rest = ''
// The 2.1.332 runtime supports streaming UTF-8, but its bundled declarations omit these overloads.
const utf8Decoder = () => new TextDecoder() as { decode(bytes: Uint8Array, options: { stream: boolean }): string }
const decodeBytes = (base64: string) => (Uint8Array as typeof Uint8Array & { fromBase64(text: string): Uint8Array }).fromBase64(base64)
let decoder = utf8Decoder()
let history: NonNullable<ReturnType<typeof parseRow>>[] = []
let index = indexRows(history)
const visible = new Map<string, number>()
const drawn = new Map<string, string>()
let busy = false
let warned = false
let current = ''
// At most one prompt has open details, with at most one list visible.
let expanded = ''
let kind: ListKind = ''
let publishedExpanded = ''
let publishedKind: ListKind = ''
let published = ''
let publishedPrompts = index.prompts
let refreshViewPending = false

const publish = async ($: EngineInterface) => {
  if (current === published && expanded === publishedExpanded && kind === publishedKind && index.prompts === publishedPrompts) return
  published = current
  publishedExpanded = expanded
  publishedKind = kind
  publishedPrompts = index.prompts
  await update($, view, () => ({ prompts: publishedPrompts, current: published, expanded: publishedExpanded, kind: publishedKind }))
}
const updateCurrent = () => {
  current = activePrompt(index.rows, visible) ?? (index.prompts.some(p => p.id === current) ? current : index.prompts.at(-1)?.id ?? '')
}
const report = ($: EngineInterface, id: string, place: { first: number } | null | undefined) => {
  if (place === undefined) return
  if (place === null) visible.delete(rowKey(id))
  else visible.set(rowKey(id), place.first)
  if (refreshViewPending) return
  refreshViewPending = true
  $.clock.after(40, async () => {
    refreshViewPending = false
    updateCurrent()
    await publish($)
  })
}

const refresh = async ($: EngineInterface) => {
  if (busy) return
  busy = true
  try {
    const nextPath = (await $.session.info()).transcriptPath
    // A fresh session gets a transcript path before the engine creates the file.
    const size = nextPath && await $.fs.exists(nextPath) ? (await $.fs.stat(nextPath)).size : 0
    const reset = nextPath !== path || size < offset
    if (reset) {
      if (path) {
        visible.clear()
        drawn.clear()
        markedSequence = ++jumpSequence
        markerTimer?.cancel()
        await update($, jumpMarker, () => null)
      }
      path = nextPath
      offset = 0
      rest = ''
      decoder = utf8Decoder()
      history = []
      current = ''
      expanded = ''
      kind = ''
    }
    const before = history.length
    while (offset < size) {
      const { base64 } = await $.fs.read(path, { as: 'bytes', offset, length: Math.min(CHUNK, size - offset) })
      const bytes = decodeBytes(base64)
      if (!bytes.length) break
      const lines = (rest + decoder.decode(bytes, { stream: true })).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const row = parseRow(line)
        if (row) history.push(row)
      }
      offset += bytes.length
    }
    if (reset || history.length !== before) {
      index = indexRows(history)
      if (!index.prompts.some(p => p.id === expanded && (kind === 'reply' ? p.replies.length > 1 : kind === 'details' ? p.replies.length > 0 && p.tools.length > 0 : kind === 'tool' && p.tools.length > 0))) {
        expanded = ''
        kind = ''
      }
      updateCurrent()
      await publish($)
    }
    warned = false
  } catch (error) {
    if (!warned) $.ui.toast(`Prompt timeline could not read session history: ${String(error)}`)
    warned = true
  } finally {
    busy = false
  }
}

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Prompt timeline', columns: 24 })

export const register: Register = (on, options) => {
  const showTools = options.showTools !== false
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (e.surface !== 'terminal') return started
    await $.command.register({ name: PANE, description: 'Open the prompt timeline', immediate: true })
    void refresh($)
    $.clock.every(750, () => refresh($))
    await open($)
    return started
  })
  on('command.run', async ($, e, next) => {
    if (e.command !== PANE) return next(e)
    await open($)
    return {}
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface === 'terminal' && promptText(e.props.text)) {
      if (['composer', 'bridge', 'sdk'].includes(e.props.origin.kind)) drawn.set(rowKey(e.requestId), e.requestId)
      report($, e.requestId, e.props.onScreen)
    }
    return withJumpMarker($, e, await next(e))
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface === 'terminal') {
      drawn.set(rowKey(e.requestId), e.requestId)
      report($, e.requestId, e.props.onScreen)
    }
    return withJumpMarker($, e, await next(e))
  })
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface === 'terminal') {
      drawn.set(rowKey(e.requestId), e.requestId)
      report($, e.requestId, e.props.onScreen)
    }
    return withJumpMarker($, e, await next(e))
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const id = e.props.calls.find(call => call.tool_use_id)?.tool_use_id
    if (e.surface === 'terminal') {
      // A folded call has no row of its own; its group is the nearest thing to scroll to.
      for (const call of e.props.calls) if (call.tool_use_id) drawn.set(rowKey(call.tool_use_id), e.requestId)
      if (id) report($, id, e.props.onScreen)
    }
    return withJumpMarker($, e, await next(e))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.placement !== 'dock') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const state = await read($, view)
    if (e.props.view.agentId) return <Text dimColor>Switch to the main chat.</Text>
    return <Box flexDirection="column">
      <Text><Text color="#4a9b62">Prompts</Text><Text dimColor> · {state.prompts.length}</Text></Text>
      {state.prompts.map(p => {
        const replies = p.replies.length
        const tools = showTools ? p.tools.length : 0
        const repliesOpen = state.expanded === p.id && state.kind === 'reply'
        const toolsOpen = tools > 0 && state.expanded === p.id && state.kind === 'tool'
        const replyLabel = replies > 1 ? `回复 ${replies} ${repliesOpen ? '▾' : '▸'}` : '回复'
        const replyWidth = replies > 1 ? 8 + String(replies).length : 4
        const toolLabel = `工具 ${tools} ${toolsOpen ? '▾' : '▸'}`
        const toolWidth = 8 + String(tools).length
        const room = e.props.bodyColumns - 2 - (replies ? replyWidth + 1 : 0) - (tools ? toolWidth + 1 : 0)
        const compact = replies > 0 && tools > 0 && room < MIN_PREVIEW
        const detailsOpen = compact && state.expanded === p.id
        const replyButton = replies > 0 && <Button key={`reply:${p.id}`} plain label={replyLabel} onPress={() => {}}><Text color="#628fcf" bold={repliesOpen}>{replyLabel}</Text></Button>
        const toolButton = tools > 0 && <Button key={`tools:${p.id}`} plain label={toolLabel} onPress={() => {}}><Text color="#c67a3d" bold={toolsOpen}>{toolLabel}</Text></Button>
        return <Box key={`turn:${p.id}`} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key={`jump:${p.id}`} plain onPress={() => {}}>
              <Text color={p.id === state.current ? '#4a9b62' : undefined} dimColor={p.id !== state.current}>{p.id === state.current ? '━ ' : '─ '}</Text>
              <Text bold={p.id === state.current}>{preview(p.text, compact ? e.props.bodyColumns - 7 : room)}</Text>
            </Button>
            {compact ? <Button key={`details:${p.id}`} plain label={detailsOpen ? '收起' : '详情'} onPress={() => {}}><Text color="#ba922c">{detailsOpen ? '收起' : '详情'}</Text></Button> : replyButton}
            {!compact && toolButton}
          </Box>
          {detailsOpen && <Box flexDirection="row" gap={1}>{replyButton}{toolButton}</Box>}
          {repliesOpen && p.replies.map((reply, i) => {
            const prefix = `  ${i + 1}  `
            return <Button key={`segment:${p.id}:${reply.id}`} plain
              label={prefix + preview(reply.text, e.props.bodyColumns - prefix.length)} onPress={() => {}}>
              <Text color="#628fcf">{prefix}</Text><Text>{preview(reply.text, e.props.bodyColumns - prefix.length)}</Text>
            </Button>
          })}
          {toolsOpen && p.tools.map((tool, i) => {
            const prefix = `  ${i + 1}  `
            const name = tool.name || '工具'
            const shown = preview(tool.target ? `${name} ${tool.target}` : name, e.props.bodyColumns - prefix.length)
            return <Button key={`tool:${p.id}:${tool.id}`} plain label={prefix + shown} onPress={() => {}}>
              <Text color="#9e77c6">{prefix}</Text><Text color="#c67a3d">{shown.startsWith(name) ? name : shown}</Text>
              {shown.startsWith(name) && <Text>{shown.slice(name.length)}</Text>}
            </Button>
          })}
        </Box>
      })}
    </Box>
  })
  on('ui.press', { component: 'Pane', requestId: PANE, plugin: PANE }, async ($, e, next) => {
    const result = await next(e)
    const match = /^(jump|details|reply|segment|tools|tool):([^:]+)(?::(.+))?$/.exec(e.element)
    if (!match || (!showTools && (match[1] === 'details' || match[1] === 'tools' || match[1] === 'tool'))) return result
    const prompt = index.prompts.find(p => p.id === match[2])
    if (!prompt) return result
    if (match[1] === 'details' && prompt.replies.length && prompt.tools.length) {
      const closing = expanded === prompt.id
      expanded = closing ? '' : prompt.id
      kind = closing ? '' : 'details'
      await publish($)
      return result
    }
    if ((match[1] === 'reply' && prompt.replies.length > 1) || (match[1] === 'tools' && prompt.tools.length)) {
      const list = match[1] === 'tools' ? 'tool' : 'reply'
      const closing = expanded === prompt.id && kind === list
      const keepDetails = closing && showTools && prompt.replies.length > 0 && prompt.tools.length > 0
      expanded = closing && !keepDetails ? '' : prompt.id
      kind = closing ? (keepDetails ? 'details' : '') : list
      await publish($)
      return result
    }
    const open = expanded === prompt.id ? kind : ''
    const tool = match[1] === 'tool' && open === 'tool' ? prompt.tools.find(t => t.id === match[3]) : undefined
    const id = match[1] === 'jump' ? prompt.id : match[1] === 'reply' ? prompt.replies[0]?.id
      : match[1] === 'segment' && open === 'reply' ? prompt.replies.find(reply => reply.id === match[3])?.id : tool?.id
    if (!id) return result
    const target = drawn.get(rowKey(id)) ?? id
    const sequence = ++jumpSequence
    const jump = await $.ui.scroll({ to: { requestId: target }, block: 'start' })
    // Compaction is judged on the transcript message; a tool call lives inside its owning message.
    if (jump.deny) $.ui.toast(jumpNotice(index, tool?.owner ?? id, jump.deny))
    else if (sequence > markedSequence) {
      await markJump($, target, sequence)
      visible.clear()
      current = prompt.id
      await publish($)
    }
    return result
  })
}
