import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const id = 'prompt-timeline'
const pane = {
  plugin: id, component: 'Pane', requestId: id, surface: 'terminal',
  props: { title: 'Prompt timeline', placement: 'dock', isFocused: false, bodyColumns: 24, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  viewport: { columns: 140, rows: 30 },
} as const
const row = (uuid: string, parentUuid: string | null, type: string) =>
  `${JSON.stringify({ uuid, parentUuid, type, message: { content: '重复提问' } })}\n`

test('restores distinct prompts, updates on scroll, and clears state when the session changes', async ($, on) => {
  const clock = mock.clock(on)
  let path = '/synthetic.jsonl'
  let transcript = row('first', null, 'user') + row('answer', 'first', 'assistant') + row('second', 'answer', 'user').slice(0, -1)
  let reads = 0
  const encode = (s: string) => new TextEncoder().encode(s)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: path } as never }))
  let stats = 0
  const notices: string[] = []
  on('fs.exists', () => ({ value: Boolean(transcript) }))
  on('fs.stat', () => {
    stats++
    if (!transcript) throw new Error('ENOENT')
    return { value: { size: encode(transcript).length } as never }
  })
  on('ui.toast', (_, e) => { notices.push(e.text); return { value: undefined } })
  on('fs.read', (_, e) => {
    reads++
    const at = e.offset ?? 0
    const bytes = encode(transcript).subarray(at, at + (e.length ?? Infinity))
    return { value: { base64: (bytes as Uint8Array & { toBase64(): string }).toBase64() } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => { expect(e.columns).toBe(24); return { value: { isPlaced: true } } })

  const pass = ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>fixture</Text> }
  on('ui.render', { component: 'AssistantMessage' }, pass)
  await $.session.start({ cwd: '/fixture', surface: 'terminal', isInteractive: true })
  await clock.advance(750)
  const ui = await $.ui.mount(pane)
  const has = async (text: string) => (await ui.find({ type: 'Button', text })) !== undefined
  expect(await has('━ 重复提问')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'reply:first' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'reply:second' })).toBeUndefined()
  expect(await has('─ 重复提问')).toBe(false)

  transcript += '\n'
  await clock.advance(750)
  expect(await has('─ 重复提问')).toBe(true)
  const savedReads = reads
  await clock.advance(750)
  expect(reads).toBe(savedReads)
  const reply = await $.ui.mount({ plugin: id, component: 'AssistantMessage', surface: 'terminal', requestId: 'answer',
    props: { onScreen: { first: 3, last: 9, of: 15 } } } as never)
  await clock.advance(40)
  expect(await has('━ 重复提问')).toBe(true)

  path = '/another-synthetic.jsonl'
  transcript = ''
  const previousStats = stats
  await clock.advance(750)
  expect(stats).toBe(previousStats)
  expect(notices).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'jump:first' })).toBeUndefined()
  transcript = row('third', null, 'user')
  await clock.advance(750)
  expect(await ui.find({ type: 'Button', key: 'jump:third' })).toBeDefined()
  await reply.unmount()
  await ui.unmount()
})


test('keeps compacted prompts and retained replies in the timeline', async ($, on) => {
  const clock = mock.clock(on)
  const transcript = row('old', null, 'user') + row('retained', 'old', 'assistant') +
    JSON.stringify({ uuid: 'boundary', logicalParentUuid: 'retained', type: 'system', subtype: 'compact_boundary',
      compactMetadata: { preservedMessages: { allUuids: ['retained'] } } }) + '\n' + row('new', 'boundary', 'user')
  const bytes = new TextEncoder().encode(transcript)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: '/synthetic.jsonl' } as never }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { size: bytes.length } as never }))
  on('fs.read', () => ({ value: { base64: (bytes as Uint8Array & { toBase64(): string }).toBase64() } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/fixture', surface: 'terminal', isInteractive: true })
  await clock.advance(750)
  const ui = await $.ui.mount(pane)
  for (const key of ['jump:old', 'reply:old', 'jump:new']) {
    expect(await ui.find({ type: 'Button', key })).toBeDefined()
  }
  await ui.unmount()
})


test('expands three reply segments under their own prompt, including after compaction', async ($, on) => {
  const clock = mock.clock(on)
  const transcript = row('first', null, 'user') + row('a', 'first', 'assistant') +
    row('b', 'a', 'assistant') + row('c', 'b', 'assistant') +
    JSON.stringify({ uuid: 'boundary', logicalParentUuid: 'c', type: 'system', subtype: 'compact_boundary',
      compactMetadata: { preservedMessages: { allUuids: ['b', 'c'] } } }) + '\n' +
    row('second', 'boundary', 'user') + row('d', 'second', 'assistant')
  const bytes = new TextEncoder().encode(transcript)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: '/fixture.jsonl' } as never }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { size: bytes.length } as never }))
  on('fs.read', () => ({ value: { base64: (bytes as Uint8Array & { toBase64(): string }).toBase64() } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/fixture', surface: 'terminal', isInteractive: true })
  await clock.advance(750)
  const ui = await $.ui.mount(pane)
  await ui.press({ key: 'reply:first' })
  for (const id of ['a', 'b', 'c']) {
    expect(await ui.find({ type: 'Button', key: `segment:first:${id}` })).toBeDefined()
  }
  expect(await ui.find({ type: 'Button', key: 'reply:second', text: '回复' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'segment:first:d' })).toBeUndefined()
  await ui.press({ key: 'reply:first' })
  expect(await ui.find({ type: 'Button', key: 'segment:first:a' })).toBeUndefined()
  await ui.unmount()
})


const message = (uuid: string, parentUuid: string | null, type: string, content: unknown) =>
  `${JSON.stringify({ uuid, parentUuid, type, message: { content } })}\n`
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input })
const secret = 'Bearer SECRET-TOKEN'
// Prompt one: two reply segments and three tools. Prompt two: one tool, no reply. Prompt three: neither.
const detailTranscript = message('first', null, 'user', '提问一') +
  message('a1', 'first', 'assistant', [{ type: 'text', text: '第一段' }, toolUse('toolu_read', 'Read', { file_path: '/home/me/app.ts' }),
    toolUse('toolu_bash', 'Bash', { command: `curl -H "Authorization: ${secret}" https://example.com` })]) +
  message('r1', 'a1', 'user', [{ type: 'tool_result', tool_use_id: 'toolu_read' }]) +
  message('a2', 'r1', 'assistant', [{ type: 'text', text: '第二段' }, toolUse('toolu_grep', 'Grep', { pattern: secret })]) +
  message('second', 'a2', 'user', '提问二') +
  message('a3', 'second', 'assistant', [toolUse('toolu_web', 'WebFetch', { url: `https://user:${secret}@a.example/x?k=${secret}` })]) +
  message('third', 'a3', 'user', '提问三')

type Test = Parameters<TestBody>
const serve = async ($: Test[0], on: Test[1], transcript: string, toasts: string[] = []) => {
  const clock = mock.clock(on)
  const bytes = new TextEncoder().encode(transcript)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: '/detail.jsonl' } as never }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { size: bytes.length } as never }))
  on('fs.read', () => ({ value: { base64: (bytes as Uint8Array & { toBase64(): string }).toBase64() } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  const pass = ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>fixture</Text> }
  on('ui.render', { component: 'AssistantMessage' }, pass)
  on('ui.render', { component: 'ToolUse' }, pass)
  on('ui.render', { component: 'ToolGroup' }, pass)
  await $.session.start({ cwd: '/fixture', surface: 'terminal', isInteractive: true })
  await clock.advance(750)
  return { clock, ui: await $.ui.mount(pane) }
}
const labels = async (ui: Awaited<ReturnType<typeof serve>>['ui'], prefix: string) =>
  (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith(prefix)).map(b => [b.key, b.props.label])

test('shows an independent tool button per prompt and lists tools in call order without sensitive arguments', async ($, on) => {
  const { ui } = await serve($, on, detailTranscript)
  await ui.press({ key: 'details:first' })
  expect((await ui.find({ type: 'Button', key: 'tools:first' }))?.props.label).toBe('工具 3 ▸')
  expect((await ui.find({ type: 'Text', text: '工具 3 ▸' }))?.props.color).toBe('#c67a3d')
  expect((await ui.find({ type: 'Text', text: '回复 2 ▸' }))?.props.color).toBe('#628fcf')
  expect((await ui.find({ type: 'Button', key: 'tools:second' }))?.props.label).toBe('工具 1 ▸')
  expect(await ui.find({ type: 'Button', key: 'tools:third' })).toBeUndefined()
  expect(await labels(ui, 'tool:')).toEqual([])
  await ui.press({ key: 'tools:first' })
  expect(await labels(ui, 'tool:')).toEqual([
    ['tool:first:toolu_read', '  1  Read app.ts'], ['tool:first:toolu_bash', '  2  Bash'], ['tool:first:toolu_grep', '  3  Grep'],
  ])
  expect((await ui.find({ type: 'Button', key: 'tools:first' }))?.props.label).toBe('工具 3 ▾')
  expect(JSON.stringify(await ui.drawn())).not.toContain(secret)
  await ui.press({ key: 'tools:second' })
  expect(await labels(ui, 'tool:')).toEqual([['tool:second:toolu_web', '  1  WebFetch a.example']])
  expect(JSON.stringify(await ui.drawn())).not.toContain('SECRET')
  expect(JSON.stringify(await ui.drawn())).not.toContain('curl')
  await ui.unmount()
})

test('keeps one list open across prompts and switches between replies and tools', async ($, on) => {
  const { ui } = await serve($, on, detailTranscript)
  await ui.press({ key: 'details:first' })
  await ui.press({ key: 'reply:first' })
  expect(await labels(ui, 'segment:')).toHaveLength(2)
  await ui.press({ key: 'tools:first' })
  expect(await labels(ui, 'segment:')).toHaveLength(0)
  expect(await labels(ui, 'tool:')).toHaveLength(3)
  await ui.press({ key: 'tools:first' })
  expect(await labels(ui, 'tool:')).toHaveLength(0)
  expect(await labels(ui, 'reply:first')).toHaveLength(1)
  await ui.press({ key: 'tools:second' })
  expect(await labels(ui, 'tool:')).toHaveLength(1)
  expect(await labels(ui, 'reply:first')).toHaveLength(0)
  await ui.unmount()
})

test('keeps collapsed rows single-line and preserves the expanded list across widths', async ($, on) => {
  const many = Array.from({ length: 120 }, (_, i) => toolUse(`toolu_${i}`, 'Bash', { command: 'git status' }))
  const transcript = detailTranscript.replace('提问一', '检查提交并更新文档检查提交并更新文档').replace(
    message('third', 'a3', 'user', '提问三'),
    message('third', 'a3', 'user', '提问三') + message('a4', 'third', 'assistant', [...many, { type: 'text', text: 'done' }]),
  )
  const { ui } = await serve($, on, transcript)
  const rows = async (key: string) => (await ui.find({ type: 'Box', key: `turn:${key}` }))?.children as { type: string }[]
  expect(await rows('first')).toHaveLength(1)
  expect(await rows('third')).toHaveLength(1)
  expect(await labels(ui, 'details:')).toEqual([['details:first', '详情'], ['details:third', '详情']])
  expect((await ui.find({ type: 'Text', text: '详情' }))?.props.color).toBe('#ba922c')
  expect(await labels(ui, 'tools:')).toEqual([['tools:second', '工具 1 ▸']])
  await ui.press({ key: 'details:third' })
  expect(await labels(ui, 'tools:third')).toEqual([['tools:third', '工具 120 ▸']])
  await ui.press({ key: 'details:first' })
  expect(await rows('third')).toHaveLength(1)
  await ui.press({ key: 'reply:first' })
  await ui.unmount()
  const wide = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 48 } })
  expect(await labels(wide, 'details:')).toEqual([])
  expect(await labels(wide, 'segment:first:')).toHaveLength(2)
  expect(await labels(wide, 'tools:third')).toEqual([['tools:third', '工具 120 ▸']])
  await wide.unmount()
  const narrow = await $.ui.mount(pane)
  expect(await labels(narrow, 'segment:first:')).toHaveLength(2)
  await narrow.press({ key: 'details:first' })
  expect(await labels(narrow, 'segment:first:')).toEqual([])
  expect(await labels(narrow, 'tools:')).toEqual([['tools:second', '工具 1 ▸']])
  await narrow.unmount()
})

test('shows a Bash operation in the expanded tools list', async ($, on) => {
  const transcript = message('first', null, 'user', '状态') +
    message('a', 'first', 'assistant', [toolUse('toolu_git', 'Bash', { command: 'git status --short' })])
  const { ui } = await serve($, on, transcript)
  await ui.press({ key: 'tools:first' })
  expect(await labels(ui, 'tool:')).toEqual([['tool:first:toolu_git', '  1  Bash git status --…']])
  await ui.unmount()
})


test('hide tools without hiding prompt or reply navigation', { options: { showTools: false } }, async ($, on) => {
  const { ui } = await serve($, on, detailTranscript)
  expect(await labels(ui, 'tools:')).toEqual([])
  expect(await labels(ui, 'details:')).toEqual([])
  expect(await labels(ui, 'tool:')).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'jump:first' })).toBeDefined()
  await ui.press({ key: 'reply:first' })
  expect(await labels(ui, 'segment:first:')).toHaveLength(2)
  expect(await labels(ui, 'tool:')).toEqual([])
  await ui.unmount()
})


test('only the jump target gets an out-of-flow marker, keeping the original drawing', async ($, on) => {
  on('state.get', { plugin: id, key: 'jumpMarker' }, () => ({ value: { value: { target: 'answer', sequence: 1 }, version: 1 } }))
  const { ui } = await serve($, on, detailTranscript)
  for (const requestId of ['answer', 'other']) {
    const row = await $.ui.mount({ plugin: id, component: 'AssistantMessage', surface: 'terminal', requestId,
      props: { text: 'Fixture', isFirstOfReply: true }, viewport: { columns: 140, rows: 30, isFullscreen: true } })
    const marker = await row.find({ type: 'Box', key: 'timeline-jump-marker' })
    expect(marker?.props.position).toBe(requestId === 'answer' ? 'absolute' : undefined)
    expect(await row.find({ type: 'Text', text: 'fixture' })).toBeDefined()
    await row.unmount()
  }
  await ui.unmount()
})
