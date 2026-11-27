import { expect, test } from 'claude-code/testing'
import { activePrompt, jumpNotice, indexRows, parseRow, preview, rowKey } from '../hooks/core'

const user = (uuid: string, parentUuid: string | null, text: string, extra = {}) =>
  ({ uuid, parentUuid, type: 'user', message: { content: text }, ...extra })
const reply = (uuid: string, parentUuid: string) => ({
  uuid, parentUuid, type: 'assistant', message: { content: [{ type: 'tool_use', id: `tool-${uuid}` }] },
})
const index = (...rows: object[]) => indexRows(rows.flatMap(row => parseRow(JSON.stringify(row)) ?? []))

test('preserves repeated questions, maps replies and tools, skips tool results and engine rows', () => {
  const history = index(user('one', null, 'same'), reply('reply', 'one'),
    user('result', 'reply', '', { message: { content: [{ type: 'tool_result' }] } }),
    user('meta', 'result', 'injected', { isMeta: true }),
    user('summary', 'meta', 'summary', { isCompactSummary: true }),
    user('two', 'summary', 'same'), reply('last', 'two'))
  expect(history.prompts).toEqual([{ id: 'one', text: 'same', replies: [] }, { id: 'two', text: 'same', replies: [] }])
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
