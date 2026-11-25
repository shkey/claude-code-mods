import { expect, test } from 'claude-code/testing'

import {
  CALL_LIMIT,
  newScan,
  patchLines,
  requestStats,
  scanChunk,
  titleOf,
  DEFAULT_ORDER,
  ROW_HUE,
  toneOf,
  orderFrom,
  parseRowId,
  visibleOrder,
  DEFAULT_PREFS,
  EMPTY_GATE,
  EMPTY_TOTALS,
  addUsage,
  agentSummary,
  applyTodoCall,
  callStatusOf,
  countOf,
  fileOf,
  finishCall,
  patchTrack,
  readPrefs,
  recordGate,
  setAllOpen,
  shortPath,
  startCall,
  toggleAgent,
  toggleOpen,
  touchFile,
  fmtDur,
  fmtMs,
  fmtSecs,
  fmtTok,
  fmtTps,
  fmtUsd,
  foldTool,
  gauge,
  median,
  modelLabel,
  parseGitInfo,
  pushRecent,
  summarizeStep,
  toMeasure,
  toolTarget,
} from '../hooks/core'

const near = (a: number | null, b: number, eps = 0.05) => expect(a !== null && Math.abs(a - b) < eps).toBe(true)

const usage = (output: number) => ({ input: 100, output, cacheRead: 0, cacheWrite: 0 })

// Times are in milliseconds, as performance.now() gives them.
const sample = (over: Partial<Parameters<typeof summarizeStep>[0]> = {}) => ({
  sentAt: 1000,
  endAt: 13_000,
  firstAt: 1800,
  firstKind: 'text',
  lastContentAt: 12_800,
  contentChunks: 200,
  hasThinking: false,
  ...over,
})

test('a streamed answer gives ttft, decode speed and tpot', () => {
  const s = summarizeStep(sample(), usage(1101), 'm', 0)

  near(s.ttft, 0.8, 1e-05)
  near(s.tps, 100.09, 0.1) // 1101 tokens over the 11 s the chunks took
  near(s.tpot, 10, 0.1) // 11000 ms over 1100 gaps
  near(s.tpsE2e, 91.75, 0.1) // 1101 tokens over the 12 s request
  near(s.e2e, 12, 1e-05)
  expect(s.note).toBe('')
})

test('a request with thinking has no decode speed, only the end-to-end one', () => {
  const s = summarizeStep(sample({ hasThinking: true, firstKind: 'thinking' }), usage(500), 'm', 0)

  near(s.ttft, 0.8, 1e-05)
  expect(s.tps).toBeNull()
  expect(s.tpot).toBeNull()
  near(s.tpsE2e, 41.67, 0.1)
  expect(s.note).toMatch(/thinking/)
})

test('a response that arrives in one burst has no decode speed', () => {
  // 300 tokens inside 0.6 s is 500 tok/s: the limit is 600, so make it denser.
  const s = summarizeStep(sample({ firstAt: 5000, lastContentAt: 5600, endAt: 5700 }), usage(900), 'm', 0)

  expect(s.tps).toBeNull()
  expect(s.note).toMatch(/burst/)
})

test('too few chunks or too short a window is not decode speed either', () => {
  expect(summarizeStep(sample({ contentChunks: 3 }), usage(500), 'm', 0).tps).toBeNull()
  expect(summarizeStep(sample({ firstAt: 5000, lastContentAt: 5300, endAt: 5400 }), usage(50), 'm', 0).tps).toBeNull()
})

test('a request with no content chunk has no ttft and does not throw', () => {
  const s = summarizeStep(sample({ firstAt: 0, lastContentAt: 0, contentChunks: 0 }), usage(0), 'm', 0)

  expect(s.ttft).toBeNull()
  expect(s.tps).toBeNull()
  expect(s.tpsE2e).toBeNull()
})

test('totals add each request and its api time', () => {
  const t = addUsage(addUsage(EMPTY_TOTALS, { input: 10, output: 2, cacheRead: 5, cacheWrite: 1 }, 1500), usage(8), 500)

  expect(t).toEqual({ input: 110, output: 10, cacheRead: 5, cacheWrite: 1, reqs: 2, apiMs: 2000 })
})

test('recent keeps the newest few', () => {
  expect(pushRecent([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
})

test('median of an odd and an even count', () => {
  expect(median([3, 1, 2])).toBe(2)
  expect(median([4, 1, 3, 2])).toBe(2.5)
  expect(median([])).toBeNull()
})

test('numbers read short', () => {
  expect(fmtTok(344)).toBe('344')
  expect(fmtTok(1250)).toBe('1.3k')
  expect(fmtTok(10_000)).toBe('10k')
  expect(fmtTok(121_935)).toBe('122k')
  expect(fmtTok(1_000_000)).toBe('1M')
  expect(fmtTok(1_500_000)).toBe('1.5M')
  expect(fmtSecs(0.82)).toBe('820ms')
  expect(fmtSecs(4.66)).toBe('4.7s')
  expect(fmtSecs(125)).toBe('125s')
  expect(fmtMs(5.06)).toBe('5.1ms')
  expect(fmtMs(18.4)).toBe('18ms')
  expect(fmtTps(3.26)).toBe('3.3 tok/s')
  expect(fmtTps(91.3)).toBe('91 tok/s')
  expect(fmtDur(45_000)).toBe('45s')
  expect(fmtDur(125_000)).toBe('2m05s')
  expect(fmtDur(7_229_000)).toBe('2h00m')
  expect(fmtUsd(5.4831)).toBe('$5.48')
  expect(fmtUsd(0.0563)).toBe('$0.0563')
})

test('model names lose the provider and the claude prefix', () => {
  expect(modelLabel('example-provider/claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('claude-opus-5-5-20261101')).toBe('Opus 5.5')
  expect(modelLabel('some/other-model')).toBe('other-model')
})

test('git output becomes the band state, as git-band reads it', () => {
  const info = parseGitInfo(
    '## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n',
    ' 2 files changed, 10 insertions(+), 3 deletions(-)\n',
    'fix login\t2 hours ago\n',
  )

  expect(info).toEqual({ branch: 'main', changed: 2, added: 10, removed: 3, ahead: 2, behind: 1, subject: 'fix login', age: '2 hours ago' })
  expect(parseGitInfo('## master\n', '', '')).toEqual({ branch: 'master', changed: 0, added: 0, removed: 0, ahead: 0, behind: 0, subject: '', age: '' })
  expect(parseGitInfo('## No commits yet on dev\n', '', '')?.branch).toBe('dev')
  expect(parseGitInfo('fatal: not a git repository', '', '')).toBeNull()
})

test('tools get a short target and mcp names fold', () => {
  expect(toolTarget({ command: 'ls -la /very/long/path/that/keeps/going/forever' })).toBe('ls -la /very/long/path/that/…')
  expect(toolTarget({ file_path: '/a/b/register.tsx' })).toBe('register.tsx')
  expect(toolTarget({ pattern: 'TODO' })).toBe('TODO')
  expect(foldTool('mcp__github__create_issue')).toBe('github:create_issue')
  expect(foldTool('Bash')).toBe('Bash')
})

test('the gauge puts a knob at the percent', () => {
  expect(gauge(0, 10)).toEqual({ fill: '●', rest: '─'.repeat(9) })
  expect(gauge(100, 10)).toEqual({ fill: '━'.repeat(9) + '●', rest: '' })
})

test('session usage becomes the band state', () => {
  const m = toMeasure(
    {
      context: { tokens: 122_000, window: 1_000_000, percent: 12 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
      cost: { usd: 5.48 },
      promptCache: { isWarm: true, expiresAt: 3_600_000, ttl: '1h' },
    },
    99,
  )

  expect(m).toEqual({
    startedAt: 99,
    tokens: 122_000,
    window: 1_000_000,
    percent: 12,
    costUsd: 5.48,
    limits: [{ kind: 'five_hour', percentUsed: 12 }],
    cache: { isWarm: true, expiresAt: 3_600_000, ttl: '1h' },
  })
  expect(toMeasure({ context: { window: 200_000 }, rateLimits: [] }, 0).tokens).toBeNull()
})

const call = (id: number) => ({ id, name: 'Bash', target: 'ls', agentId: null, at: id, ms: null, status: 'running' as const })

test('the call log keeps the newest and finishing one call leaves the rest alone', () => {
  let log: ReturnType<typeof startCall> = []

  for (let i = 1; i <= CALL_LIMIT + 5; i += 1) log = startCall(log, call(i))

  expect(log.length).toBe(CALL_LIMIT)
  expect(log[0]?.id).toBe(6)

  const done = finishCall(log, 10, 'error', 250)

  expect(done.find(c => c.id === 10)).toEqual({ ...call(10), status: 'error', ms: 250 })
  expect(done.find(c => c.id === 11)?.status).toBe('running')
})

test('tool counts accumulate and the result of a call says how it went', () => {
  expect(countOf(countOf(countOf({}, 'Bash'), 'Edit'), 'Bash')).toEqual({ Bash: 2, Edit: 1 })
  expect(callStatusOf({ result: 'ok' })).toBe('ok')
  expect(callStatusOf({ isError: true, result: 'x' })).toBe('error')
  expect(callStatusOf({ deny: 'no' })).toBe('denied')
  expect(callStatusOf(undefined)).toBe('ok')
})

test('files: reads and edits are told apart, and the last touched file comes last', () => {
  expect(fileOf('Read', { file_path: '/a/b.ts' })).toEqual({ path: '/a/b.ts', kind: 'r' })
  expect(fileOf('Edit', { file_path: '/a/b.ts' })).toEqual({ path: '/a/b.ts', kind: 'w' })
  expect(fileOf('Bash', { command: 'ls' })).toBeNull()
  expect(fileOf('Read', {})).toBeNull()

  let f = touchFile([], '/a.ts', 'r', 1)

  f = touchFile(f, '/b.ts', 'w', 2)
  f = touchFile(f, '/a.ts', 'w', 3)

  expect(f.map(x => x.path)).toEqual(['/b.ts', '/a.ts'])
  expect(f[1]).toEqual({ path: '/a.ts', r: 1, w: 1, at: 3 })
  expect(shortPath('/workspace/status-band/hooks/core.ts')).toBe('status-band/hooks/core.ts')
})

test('the gate counts each verdict and keeps the recent ones', () => {
  const g = recordGate(recordGate(EMPTY_GATE, { tool: 'Bash', target: 'ls', decision: 'allow', agentId: null, at: 1 }), {
    tool: 'Bash',
    target: 'rm x',
    decision: 'deny',
    agentId: 'a1',
    at: 2,
  })

  expect([g.allow, g.ask, g.deny, g.recent.length]).toEqual([1, 0, 1, 2])
})

test('todos: write replaces, create appends, update moves one entry', () => {
  const written = applyTodoCall([], 'TodoWrite', { todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'in_progress' }] })

  expect(written.map(t => t.status)).toEqual(['pending', 'in_progress'])

  const created = applyTodoCall(written, 'TaskCreate', { subject: 'c' })

  expect(created.length).toBe(3)
  expect(applyTodoCall(created, 'TaskUpdate', { taskId: '3', status: 'completed' })[2]?.status).toBe('completed')
  expect(applyTodoCall(created, 'TaskUpdate', { taskId: '9', status: 'completed' }).length).toBe(3)
  expect(applyTodoCall(created, 'Bash', { command: 'ls' }).length).toBe(3)
})

test('agents are counted by what they are doing now', () => {
  const a = (id: string, status: string) => ({ id, type: 'x', label: '', status, model: null, startTime: 0 })

  expect(agentSummary([a('1', 'running'), a('2', 'waiting'), a('3', 'completed'), a('4', 'failed'), a('5', 'killed')])).toEqual({
    live: 2,
    done: 1,
    failed: 2,
  })
  expect(patchTrack({}, 'a1', t => ({ ...t, steps: 2 }))['a1']?.steps).toBe(2)
})

test('stored preferences are read defensively, and toggles flip one thing', () => {
  expect(readPrefs(null)).toEqual(DEFAULT_PREFS)
  expect(readPrefs({ hidden: 'yes', open: { tools: 1, files: true }, agentOpen: [1, 'a'] })).toEqual({
    ...DEFAULT_PREFS,
    open: { ...DEFAULT_PREFS.open, files: true },
    agentOpen: ['a'],
  })
  expect(toggleOpen(DEFAULT_PREFS, 'gate').open.gate).toBe(true)
  expect(toggleAgent(toggleAgent(DEFAULT_PREFS, 'a1'), 'a1').agentOpen).toEqual([])
  expect(setAllOpen(DEFAULT_PREFS, true).open).toEqual({ tools: true, files: true, gate: true, agents: true })
})

test('rows draw in the saved order, git last as shipped, and the listed rows come first', () => {
  expect(DEFAULT_ORDER[DEFAULT_ORDER.length - 1]).toBe('git')
  expect(orderFrom(['git'])[0]).toBe('git')
  expect(orderFrom(['git', 'tools']).slice(0, 3)).toEqual(['git', 'tools', 'state'])
  expect(orderFrom(['git', 'git', 'nope' as never]).filter(x => x === 'git').length).toBe(1)
  expect(orderFrom([]).length).toBe(DEFAULT_ORDER.length)
  expect(visibleOrder({ ...DEFAULT_PREFS, hiddenRows: ['tools', 'git'] })).not.toContain('git')
  expect(parseRowId('Session')).toBe('state')
  expect(parseRowId('ctx')).toBe('context')
  expect(parseRowId('nope')).toBeNull()
})

test('stored order and hidden rows survive a bad value', () => {
  const p = readPrefs({ order: ['gate', 'gate', 'x'], hiddenRows: ['git', 7] })

  expect(p.order[0]).toBe('gate')
  expect(p.order.length).toBe(DEFAULT_ORDER.length)
  expect(p.hiddenRows).toEqual(['git'])
})

test('neighbouring rows never share a hue, and the hues are the cockpit ones', () => {
  const hues = new Set(DEFAULT_ORDER.map(id => ROW_HUE[id]))

  for (const h of ['claude', 'suggestion', 'remember', 'merged']) expect(hues.has(h)).toBe(true)

  for (let i = 1; i < DEFAULT_ORDER.length; i += 1) {
    expect(ROW_HUE[DEFAULT_ORDER[i - 1] as keyof typeof ROW_HUE]).not.toBe(ROW_HUE[DEFAULT_ORDER[i] as keyof typeof ROW_HUE])
  }
})

test('a gauge turns amber at 60 and red at 85, as in the cockpit mods', () => {
  expect([toneOf(5), toneOf(59), toneOf(60), toneOf(84), toneOf(85), toneOf(100)]).toEqual([
    'success',
    'success',
    'warning',
    'warning',
    'error',
    'error',
  ])
})

const asst = (id: string, tool?: { id: string; name: string }, over: object = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-11-25T04:00:10.000Z',
    message: {
      id,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
      content: tool ? [{ type: 'tool_use', id: tool.id, name: tool.name }] : [{ type: 'text', text: 'hi' }],
    },
    ...over,
  })

test('the transcript scan counts a message once, a tool call once, and keeps the newest title', () => {
  const acc = newScan()
  const text = [
    asst('m1'),
    asst('m1', { id: 't1', name: 'Bash' }), // a second block of the same message
    asst('m2', { id: 't2', name: 'Bash' }),
    asst('m2', { id: 't2', name: 'Bash' }), // the same tool call again
    asst('m3', { id: 't3', name: 'Read' }, { isSidechain: true }), // a subagent's: not the session's
    JSON.stringify({ type: 'ai-title', aiTitle: 'old name' }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'new name' }),
    JSON.stringify({ type: 'user', message: { content: 'a "usage" mention' } }),
    '{ not json "usage"',
  ].join('\n')

  scanChunk(acc, text, true)

  expect(acc.reqs).toBe(2)
  expect(acc.usage).toEqual({ input: 20, output: 40, cacheRead: 200, cacheWrite: 10 })
  expect(acc.counts).toEqual({ Bash: 2 })
  expect(acc.lastAt).toBe(Date.parse('2026-11-25T04:00:10.000Z'))
  expect(titleOf(acc)).toBe('new name')
  expect(titleOf({ ...acc, customTitle: 'mine' })).toBe('mine')
})

test('a line cut between two pieces is joined, and a piece that ends a line is not held back', () => {
  const acc = newScan()
  const whole = asst('m1') + '\n' + asst('m2')
  const cut = Math.floor(whole.length * 0.7)

  scanChunk(acc, whole.slice(0, cut), false)
  expect(acc.reqs).toBe(1) // the first line was whole; the second is kept for the next piece
  scanChunk(acc, whole.slice(cut), true)
  expect(acc.reqs).toBe(2)
})

test('lines changed come from the diff an edit returns, or from the content of a new file', () => {
  expect(patchLines({ structuredPatch: [{ lines: [' same', '+one', '+two', '-gone'] }, { lines: ['-x'] }] })).toEqual({ added: 2, removed: 2 })
  expect(patchLines({ type: 'create', content: 'a\nb\nc\n', structuredPatch: [] })).toEqual({ added: 3, removed: 0 })
  expect(patchLines({ type: 'update', structuredPatch: [] })).toBeNull()
  expect(patchLines('ok')).toBeNull()
  expect(patchLines(undefined)).toBeNull()
})

test('the request scan finds each request, its first block, its time and the settings of the newest', () => {
  const at = (sec: number) => new Date(sec * 1000).toISOString()
  const acc = newScan()
  const lines = [
    JSON.stringify({ type: 'api-request', id: 'a', timestamp: at(10), params: { model: 'm1', thinking: { type: 'disabled' }, output_config: { effort: 'low' } }, cacheControl: [{ value: { ttl: '5m' } }] }),
    JSON.stringify({ type: 'api-request', id: 'b', timestamp: at(30), params: { model: 'm2', thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }, cacheControl: [{ value: { ttl: '1h' } }] }),
    JSON.stringify({ type: 'assistant', requestRef: 'b', apiBlockIndex: 0, timestamp: at(34), toolInputStreamMs: 500, message: { id: 'x', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'Read' }], usage: { input_tokens: 10, output_tokens: 20 } } }),
    JSON.stringify({ type: 'assistant', requestRef: 'a', apiBlockIndex: 0, timestamp: at(12), message: { id: 'y', stop_reason: null, content: [{ type: 'text' }], usage: { input_tokens: 1, output_tokens: 1 } } }),
  ].join('\n')

  scanChunk(acc, lines, true)

  const { stats, apiMs } = requestStats(acc)

  expect(stats.length).toBe(1) // the request still going has no end yet
  expect(stats[0]?.model).toBe('m2')
  near(stats[0]?.ttft ?? null, 3.5, 0.01) // 4 s to the end of the block, 0.5 s of it spent on the call
  near(stats[0]?.e2e ?? null, 4, 0.01)
  near(stats[0]?.tpsE2e ?? null, 5, 0.01)
  expect(stats[0]?.tps).toBeNull()
  expect(apiMs).toBe(4000)
  expect(acc.meta).toEqual({ at: 30_000, effort: 'high', thinking: true, cacheTtl: '1h' })
})

test('model names of other makers read well too', () => {
  expect(modelLabel('gpt-6.2-sol[1m]')).toBe('GPT-6.2 Sol')
  expect(modelLabel('example-provider/gpt-6.2-sol')).toBe('GPT-6.2 Sol')
  expect(modelLabel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(modelLabel('mystery')).toBe('mystery')
})
