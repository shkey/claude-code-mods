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
  expect((await ui.find({ type: 'Button', key: 'tools:first' }))?.props.label).toBe('  工具 3 ▸')
  expect((await ui.find({ type: 'Button', key: 'tools:second' }))?.props.label).toBe('工具 1 ▸')
  expect(await ui.find({ type: 'Button', key: 'tools:third' })).toBeUndefined()
  expect(await labels(ui, 'tool:')).toEqual([])
  await ui.press({ key: 'tools:first' })
  expect(await labels(ui, 'tool:')).toEqual([
    ['tool:first:toolu_read', '  1  Read app.ts'], ['tool:first:toolu_bash', '  2  Bash'], ['tool:first:toolu_grep', '  3  Grep'],
  ])
  expect((await ui.find({ type: 'Button', key: 'tools:first' }))?.props.label).toBe('  工具 3 ▾')
  await ui.press({ key: 'tools:second' })
  expect(await labels(ui, 'tool:')).toEqual([['tool:second:toolu_web', '  1  WebFetch a.example']])
  expect(JSON.stringify(await ui.drawn())).not.toContain('SECRET')
  expect(JSON.stringify(await ui.drawn())).not.toContain('curl')
  await ui.unmount()
})

test('keeps one list open: tools and replies exclude each other across prompts', async ($, on) => {
  const { ui } = await serve($, on, detailTranscript)
  await ui.press({ key: 'reply:first' })
  expect((await labels(ui, 'segment:')).length).toBe(2)
  await ui.press({ key: 'tools:first' })
  expect((await labels(ui, 'segment:')).length).toBe(0)
  expect((await labels(ui, 'tool:')).length).toBe(3)
  expect((await ui.find({ type: 'Button', key: 'reply:first' }))?.props.label).toBe('回复 2 ▸')
  await ui.press({ key: 'reply:first' })
  expect((await labels(ui, 'segment:')).length).toBe(2)
  expect((await labels(ui, 'tool:')).length).toBe(0)
  expect((await ui.find({ type: 'Button', key: 'tools:first' }))?.props.label).toBe('  工具 3 ▸')
  await ui.press({ key: 'tools:second' })
  expect((await labels(ui, 'segment:')).length).toBe(0)
  await ui.press({ key: 'tools:second' })
  expect(await labels(ui, 'tool:')).toEqual([])
  await ui.unmount()
})

test('keeps the tool button beside the prompt when it fits and drops it to a second row in narrow panes', async ($, on) => {
  const { ui } = await serve($, on, detailTranscript)
  const lines = async (key: string) => {
    const turn = await ui.find({ type: 'Box', key: `turn:${key}` })
    return (turn?.children as { type: string, children: unknown[] }[]).filter(child => child.type === 'Box').map(box => JSON.stringify(box))
  }
  // Prompt one has replies and tools at 24 columns: the reply row stays as before, tools take a second row.
  let first = await lines('first')
  expect(first.length).toBe(2)
  expect(first[0]).toContain('reply:first')
  expect(first[0]).not.toContain('tools:first')
  expect(first[1]).toContain('tools:first')
  expect((await ui.find({ type: 'Button', key: 'jump:first' }))?.props.label).toBe('─ 提问一')
  // Prompt two has no reply button, so the tool button fits beside a short prompt.
  expect((await lines('second')).length).toBe(1)
  expect((await lines('second'))[0]).toContain('tools:second')
  await ui.unmount()
  const wide = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 48 } })
  first = await (async () => {
    const turn = await wide.find({ type: 'Box', key: 'turn:first' })
    return (turn?.children as { type: string }[]).filter(child => child.type === 'Box').map(box => JSON.stringify(box))
  })()
  expect(first.length).toBe(1)
  expect(first[0]).toContain('tools:first')
  await wide.unmount()
})
