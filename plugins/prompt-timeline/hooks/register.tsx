import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { activePrompt, indexRows, jumpNotice, parseRow, preview, promptText, rowKey } from './core'
import type { Prompt } from './core'

const PANE = 'prompt-timeline'
const CHUNK = 256 * 1024
// A new key keeps hot reload from reading the old single-reply state shape.
const view = atom({ plugin: 'prompt-timeline', key: 'replyView' } as const, { prompts: [] as Prompt[], current: '', expanded: '' })

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
let expanded = ''
let publishedExpanded = ''
let published = ''
let publishedPrompts = index.prompts
let refreshViewPending = false

const publish = async ($: EngineInterface) => {
  if (current === published && expanded === publishedExpanded && index.prompts === publishedPrompts) return
  published = current
  publishedExpanded = expanded
  publishedPrompts = index.prompts
  await update($, view, () => ({ prompts: publishedPrompts, current: published, expanded: publishedExpanded }))
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
      }
      path = nextPath
      offset = 0
      rest = ''
      decoder = utf8Decoder()
      history = []
      current = ''
      expanded = ''
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
      if (!index.prompts.some(p => p.id === expanded && p.replies.length > 1)) expanded = ''
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

export const register: Register = on => {
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

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.surface === 'terminal' && promptText(e.props.text)) {
      if (['composer', 'bridge', 'sdk'].includes(e.props.origin.kind)) drawn.set(rowKey(e.requestId), e.requestId)
      report($, e.requestId, e.props.onScreen)
    }
    return next(e)
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.surface === 'terminal') {
      drawn.set(rowKey(e.requestId), e.requestId)
      report($, e.requestId, e.props.onScreen)
    }
    return next(e)
  })
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    if (e.surface === 'terminal') report($, e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    const id = e.props.calls.find(call => call.tool_use_id)?.tool_use_id
    if (id && e.surface === 'terminal') report($, id, e.props.onScreen)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.placement !== 'dock') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const state = await read($, view)
    if (e.props.view.agentId) return <Text dimColor>Switch to the main chat.</Text>
    return <Box flexDirection="column">
      <Text dimColor>Prompts · {state.prompts.length}</Text>
      {state.prompts.map(p => {
        const count = p.replies.length
        const opened = state.expanded === p.id
        const label = count > 1 ? `回复 ${count} ${opened ? '▾' : '▸'}` : '回复'
        const buttonWidth = count > 1 ? 8 + String(count).length : 4
        return <Box key={`turn:${p.id}`} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key={`jump:${p.id}`} plain dimColor={p.id !== state.current}
              label={`${p.id === state.current ? '━' : '─'} ${preview(p.text, e.props.bodyColumns - (count ? buttonWidth + 4 : 3))}`} onPress={() => {}} />
            {count > 0 && <Button key={`reply:${p.id}`} plain label={label} onPress={() => {}} />}
          </Box>
          {opened && p.replies.map((reply, i) => {
            const prefix = `  ${i + 1}  `
            return <Button key={`segment:${p.id}:${reply.id}`} plain
              label={prefix + preview(reply.text, e.props.bodyColumns - prefix.length)} onPress={() => {}} />
          })}
        </Box>
      })}
    </Box>
  })
  on('ui.press', { component: 'Pane', requestId: PANE, plugin: PANE }, async ($, e, next) => {
    const result = await next(e)
    const match = /^(jump|reply|segment):([^:]+)(?::([^:]+))?$/.exec(e.element)
    if (!match) return result
    const prompt = index.prompts.find(p => p.id === match[2])
    if (!prompt) return result
    if (match[1] === 'reply' && prompt.replies.length > 1) {
      expanded = expanded === prompt.id ? '' : prompt.id
      await publish($)
      return result
    }
    const id = match[1] === 'jump' ? prompt.id : match[1] === 'reply' ? prompt.replies[0]?.id
      : expanded === prompt.id ? prompt.replies.find(reply => reply.id === match[3])?.id : undefined
    if (!id) return result
    const target = drawn.get(rowKey(id)) ?? id
    const jump = await $.ui.scroll({ to: { requestId: target }, block: 'start' })
    if (jump.deny) $.ui.toast(jumpNotice(index, id, jump.deny))
    else {
      visible.clear()
      current = prompt.id
      await publish($)
    }
    return result
  })
}
