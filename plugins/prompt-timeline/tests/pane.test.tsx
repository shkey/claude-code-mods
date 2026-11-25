import { expect, mock, test } from 'claude-code/testing'

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
