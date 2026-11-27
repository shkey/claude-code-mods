import { expect, test } from 'claude-code/testing'
import { activePrompt, jumpNotice, indexRows, parseRow, preview, rowKey } from '../hooks/core'

const user = (uuid: string, parentUuid: string | null, text: string, extra = {}) =>
  ({ uuid, parentUuid, type: 'user', message: { content: text }, ...extra })
const reply = (uuid: string, parentUuid: string) => ({
  uuid, parentUuid, type: 'assistant', message: { content: [{ type: 'tool_use', id: `tool-${uuid}` }] },
})
const calls = (uuid: string, parentUuid: string, ...tools: [string, string, unknown][]) => ({
  uuid, parentUuid, type: 'assistant',
  message: { content: tools.map(([id, name, input]) => ({ type: 'tool_use', id, name, input })) },
})
const index = (...rows: object[]) => indexRows(rows.flatMap(row => parseRow(JSON.stringify(row)) ?? []))

test('preserves repeated questions, maps replies and tools, skips tool results and engine rows', () => {
  const history = index(user('one', null, 'same'), reply('reply', 'one'),
    user('result', 'reply', '', { message: { content: [{ type: 'tool_result' }] } }),
    user('meta', 'result', 'injected', { isMeta: true }),
    user('summary', 'meta', 'summary', { isCompactSummary: true }),
    user('two', 'summary', 'same'), reply('last', 'two'))
  expect(history.prompts).toEqual([
    { id: 'one', text: 'same', replies: [], tools: [{ id: 'tool-reply', name: '', target: '', owner: 'reply' }] },
    { id: 'two', text: 'same', replies: [], tools: [{ id: 'tool-last', name: '', target: '', owner: 'last' }] },
  ])
  expect(history.rows.get('tool-reply')?.prompt).toBe('one')
  expect(history.rows.get('last')?.prompt).toBe('two')
})

test('uses the active branch and follows the logical parent across compaction', () => {
  const history = index(user('one', null, 'first'), user('discarded', 'one', 'old branch'),
    user('two', null, 'new branch', { logicalParentUuid: 'one' }),
    user('side', 'two', 'subagent', { isSidechain: true }))
  expect(history.prompts.map(p => p.id)).toEqual(['one', 'two'])
})

test('uses the reply clipped at the top; otherwise uses the earliest visible known row', () => {
  const { rows } = index(user('one', null, 'first'), reply('reply', 'one'), user('two', 'reply', 'second'))
  expect(activePrompt(rows, new Map([['two', 0], ['reply', 3]]))).toBe('one')
  expect(activePrompt(rows, new Map([['two', 2], ['reply', 0]]))).toBe('two')
  expect(activePrompt(rows, new Map([['unknown', 5]]))).toBeUndefined()
})

test('correlates truncated render IDs with UUIDs, not prompt text', () => {
  expect(rowKey('12345678-1234-1234-1234-123456789abc')).toBe('12345678-1234-1234-1234-')
  expect(rowKey('tool-id')).toBe('tool-id')
})


test('fits a single label in terminal cells and strips control characters', () => {
  expect(preview('你好 ABCD', 8)).toBe('你好 AB…')
  expect(preview('你好', 4)).toBe('你好')
  expect(preview('abcdE', 4)).toBe('abc…')
  expect(preview('A\u001b\u202eB', 2)).toBe('AB')
})


test('groups adjacent text blocks from one response and keeps later replies in order', () => {
  const answer = (uuid: string, parentUuid: string, text: string, extra = {}) => ({
    uuid, parentUuid, type: 'assistant', message: { content: [{ type: 'text', text }] }, ...extra,
  })
  const history = index(user('one', null, 'first'), reply('tool', 'one'),
    answer('error', 'tool', 'error', { isApiErrorMessage: true }), answer('answer', 'error', 'first answer', { requestRef: 'r1' }),
    answer('part', 'answer', 'continued', { requestRef: 'r1' }),
    answer('later', 'part', 'more', { requestRef: 'r2' }), user('two', 'later', 'second'), reply('pending', 'two'))
  expect(history.prompts.map(p => [p.id, p.replies])).toEqual([
    ['one', [{ id: 'answer', text: 'first answer continued' }, { id: 'later', text: 'more' }]], ['two', []],
  ])
})


test('explains only confirmed compacted targets and leaves retained replies eligible', () => {
  const history = index(user('old', null, 'old'), reply('old-reply', 'old'),
    user('later', 'old-reply', 'later'), reply('kept', 'later'),
    { uuid: 'boundary', logicalParentUuid: 'kept', type: 'system', subtype: 'compact_boundary',
      compactMetadata: { preservedSegment: { headUuid: 'kept', tailUuid: 'kept' }, preservedMessages: { allUuids: ['kept'] } } },
    user('new', 'boundary', 'new'))
  expect(history.prompts.map(p => p.id)).toEqual(['old', 'later', 'new'])
  const deny = 'nothing drawn under that requestId'
  expect(jumpNotice(history, 'old-reply', deny)).toContain('Ctrl+O')
  expect(jumpNotice(history, 'later', deny)).toContain('压缩后')
  for (const id of ['kept', 'new', 'unknown']) expect(jumpNotice(history, id, deny)).not.toContain('压缩')
  expect(jumpNotice(history, 'old', 'no-surface')).not.toContain('压缩')
})

test('does not attribute ambiguous compaction metadata to compaction', () => {
  const history = index(user('old', null, 'old'),
    { uuid: 'boundary', logicalParentUuid: 'old', type: 'system', subtype: 'compact_boundary',
      compactMetadata: { preservedSegment: { headUuid: 'unknown', tailUuid: 'unknown' } } },
    user('new', 'boundary', 'new'))
  expect(jumpNotice(history, 'old', 'nothing drawn under that requestId')).not.toContain('压缩')
})


test('lists tools per prompt in call order with the owning message UUID', () => {
  const history = index(user('one', null, 'first'),
    calls('a', 'one', ['t1', 'Read', { file_path: '/home/me/project/app.ts' }], ['t2', 'Grep', { pattern: 'api_key=SECRET' }]),
    user('r', 'a', '', { message: { content: [{ type: 'tool_result' }] } }),
    calls('b', 'r', ['t3', 'Bash', { command: 'curl -H "Authorization: Bearer SECRET" https://x' }]),
    user('two', 'b', 'second'), calls('c', 'two', ['t4', 'Edit', { file_path: 'C:\\work\\main.go' }]),
    { uuid: 'side', parentUuid: 'c', isSidechain: true, type: 'assistant', message: { content: [{ type: 'tool_use', id: 'sub', name: 'Read' }] } })
  expect(history.prompts.map(p => p.tools.map(t => [t.id, t.name, t.target, t.owner]))).toEqual([
    [['t1', 'Read', 'app.ts', 'a'], ['t2', 'Grep', '', 'a'], ['t3', 'Bash', '', 'b']],
    [['t4', 'Edit', 'main.go', 'c']],
  ])
  expect(history.rows.get('t3')?.prompt).toBe('one')
})

test('shows only names, file basenames, hosts and agent types as tool targets', () => {
  const target = (name: string, input: unknown) =>
    index(user('one', null, 'q'), calls('a', 'one', ['t', name, input])).prompts[0]!.tools[0]!.target
  expect(target('WebFetch', { url: 'https://user:pw@example.com:8443/path?token=SECRET#x' })).toBe('example.com')
  expect(target('WebFetch', { url: 'not a url' })).toBe('')
  expect(target('WebSearch', { query: 'my password' })).toBe('')
  expect(target('Task', { subagent_type: 'code-reviewer', prompt: 'SECRET' })).toBe('code-reviewer')
  expect(target('Skill', { skill: 'ste', args: 'SECRET' })).toBe('ste')
  expect(target('Read', { file_path: '/a/b/' })).toBe('')
  expect(target('Read', { file_path: 42 })).toBe('')
  expect(target('Read', null)).toBe('')
  expect(target('Read', { file_path: `/a/${'x'.repeat(100)}.ts` })).toHaveLength(40)
  expect(target('Read', { file_path: '/a/\u001bb\u202e.ts' })).toBe('b.ts')
  expect(target('mcp__srv__lookup', { id: 'SECRET' })).toBe('')
})

test('judges compaction by the message that owns a tool call, not by the tool id', () => {
  const history = index(user('old', null, 'old'), calls('old-msg', 'old', ['toolu_old', 'Read', {}]),
    user('later', 'old-msg', 'later'), calls('kept', 'later', ['toolu_kept', 'Read', {}]),
    { uuid: 'boundary', logicalParentUuid: 'kept', type: 'system', subtype: 'compact_boundary',
      compactMetadata: { preservedMessages: { allUuids: ['kept'] } } },
    user('new', 'boundary', 'new'))
  const deny = 'nothing drawn under that requestId'
  const tools = history.prompts.flatMap(p => p.tools)
  expect(jumpNotice(history, tools[0]!.owner, deny)).toContain('Ctrl+O')
  expect(jumpNotice(history, tools[1]!.owner, deny)).not.toContain('压缩')
  expect(jumpNotice(history, tools[0]!.id, deny)).not.toContain('压缩')
})
