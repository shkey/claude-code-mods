import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'status-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 120, rows: 50 },
} as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const START = { cwd: '/repo/my', surface: null, isInteractive: true } as const

const USAGE = {
  startedAt: 1,
  context: { tokens: 122_000, window: 1_000_000, percent: 12 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
  cost: { usd: 5.48 },
  promptCache: { isWarm: true, expiresAt: 3_600_000, ttl: '1h' },
}

const ran = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

const GIT: Record<string, string> = {
  status: '## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n',
  diff: ' 2 files changed, 10 insertions(+), 3 deletions(-)\n',
  log: 'fix login\t2 hours ago\n',
}

const AGENT = {
  id: 'a1',
  type: 'Explore',
  label: 'Find the auth code',
  status: 'running',
  model: 'haiku',
  startTime: 0,
  kind: 'local_agent',
  taskStatus: 'running',
  tokenCount: 0,
  tokenSamples: [],
  description: '',
  cwd: '/repo/my',
  hasRow: true,
}

type World = { git?: Record<string, string> | null; usage?: boolean; agents?: object[]; transcript?: string; ctx?: number; missingContext?: boolean; cache?: boolean }

const world = (on: any, o: World = {}) => {
  const clock = mock.clock(on)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => {
    if (o.usage === false) throw new Error('usage is down')

    const { promptCache, ...bare } = USAGE
    const base = o.cache === false ? bare : { ...bare, promptCache }

    return { value: (o.missingContext ? { ...base, context: { window: USAGE.context.window } } : o.ctx === undefined ? base : { ...base, context: { ...USAGE.context, tokens: o.ctx } }) as never }
  })
  on('session.model', () => ({ value: 'example-provider/claude-sonnet-5-5' }))
  on('session.cwd', () => ({ value: '/repo/my/status-band' }))
  on('session.root', () => ({ value: '/repo/my' }))
  on('session.version', () => ({ value: { version: '2.1.332' } }))
  on('session.info', () => ({ value: { transcriptPath: '/t.jsonl' } as never }))
  on('fs.stat', () => ({ value: { size: (o.transcript ?? '').length } as never }))
  on('fs.read', (_: unknown, e: any) => ({ value: (o.transcript ?? '').slice(e.offset ?? 0, (e.offset ?? 0) + (e.length ?? 1e9)) as never }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const git = o.git === undefined ? GIT : o.git

    return git === null
      ? { value: { exitCode: 128, stdout: '', stderr: 'not a repo', isStdoutTruncated: false, isStderrTruncated: false } }
      : ran(git[e.argv[2] ?? ''] ?? '')
  })
  on('agent.list', () => ({ value: (o.agents ?? []) as never }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  return clock
}

const USAGE_OF = { input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 40, cache_creation_input_tokens: 5, model: 'claude-sonnet-5-5' }

const model = (on: any, usage: typeof USAGE_OF | null = USAGE_OF) =>
  on('turn.step', async function* (_$: unknown, e: any) {
    yield { kind: 'thinking' as const, index: 0, text: 'hm' }
    yield { kind: 'text' as const, index: 1, text: 'hello' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }

    return { turnId: e.turnId, index: 0, answer: 'hello', toolUses: [], stopReason: 'end_turn' as const, usage }
  })

const STEP = { turnId: 'T1', index: 0, model: 'example-provider/claude-sonnet-5-5', effort: 'high' as const, messageCount: 1 }

// The seed from the transcript runs in the background: give it time to finish before the band is drawn.
const settle = async () => {
  for (let i = 0; i < 300; i += 1) await new Promise(r => r(0))
}

// Reads the stream with next(): the value of the step that is done is the result.
const drain = async (s: any) => {
  const seen: unknown[] = []
  let step = await s.next()

  while (!step.done) {
    seen.push(step.value)
    step = await s.next()
  }

  return { seen, result: step.value }
}

const mount = ($: any, over: object = {}) => $.ui.mount({ ...BAND, ...over, surface: 'terminal' })

const has = async (ui: any, text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined

test('draws state, git, context and cache from the session start', async ($, on) => {
  world(on)
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await has(ui, /IDLE/)).toBe(true)
    expect(await has(ui, /Sonnet 5\.5/)).toBe(true)
    expect(await has(ui, /GIT/)).toBe(true)
    expect(await has(ui, /main/)).toBe(true)
    expect(await has(ui, /CONTEXT/)).toBe(true)
    expect(await has(ui, /12%/)).toBe(true)
    expect(await has(ui, /122k\/1M/)).toBe(true)
    expect(await has(ui, /\$5\.48/)).toBe(true)
    expect(await has(ui, /TOKENS/)).toBe(true)
    expect(await has(ui, /SPEED/)).toBe(false)
    await ui.unmount()
  }
})

test('the git row carries what git-band showed: changes, lines, ahead, behind and the last commit', async ($, on) => {
  world(on)
  await $.session.start(START)

  const ui = await mount($)

  expect(await has(ui, /±2/)).toBe(true)
  expect(await has(ui, /\+10/)).toBe(true)
  expect(await has(ui, /−3/)).toBe(true)
  expect(await has(ui, /↑2/)).toBe(true)
  expect(await has(ui, /↓1/)).toBe(true)
  expect(await has(ui, /fix login · 2 hours ago/)).toBe(true)
  await ui.unmount()
})

test('a clean repository says so, and outside a repository there is no git row', async ($, on) => {
  world(on, { git: { status: '## main\n', diff: '', log: 'x\t1 day ago\n' } })
  await $.session.start(START)

  const clean = await mount($)

  expect(await has(clean, /clean/)).toBe(true)
  expect(await has(clean, /±/)).toBe(false)
  await clean.unmount()
})

test('outside a git repository the band still draws, without a git row', async ($, on) => {
  world(on, { git: null })
  await $.session.start(START)

  const ui = await mount($)

  expect(await has(ui, /IDLE/)).toBe(true)
  expect(await has(ui, /GIT/)).toBe(false)
  await ui.unmount()
})

test('the state follows the turn: running, then idle with a receipt', async ($, on) => {
  world(on)
  await $.session.start(START)

  await $.turn.start({ text: 'hi', turnId: 'T1' })
  const busy = await mount($)
  expect(await has(busy, /INFO/)).toBe(true)
  expect(JSON.stringify(await busy.drawn())).toMatch(/INFO.*RUNNING.*Sonnet/)
  expect(await has(busy, /RUNNING/)).toBe(true)
  expect(await has(busy, /IDLE/)).toBe(false)
  await busy.unmount()

  await $.turn.complete({ answer: 'ok', durationMs: 12_000, isAborted: false, turnId: 'T1', reason: 'answer' })
  const idle = await mount($)
  expect(await has(idle, /INFO/)).toBe(true)
  expect(JSON.stringify(await idle.drawn())).toMatch(/INFO.*IDLE.*Sonnet/)
  expect(await has(idle, /IDLE/)).toBe(true)
  expect(await has(idle, /last turn 12s/)).toBe(true)
  await idle.unmount()
})

test('a permission check that asks puts the band in WAITING until the call it guards has run', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'ask' as const }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await $.turn.start({ text: 'hi', turnId: 'T1' })

  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'u1' })

  const waiting = await mount($)

  expect(JSON.stringify(await waiting.drawn())).toMatch(/INFO.*WAITING.*needs you/)
  expect(await has(waiting, /WAITING/)).toBe(true)
  expect(await has(waiting, /needs you: permission prompt/)).toBe(true)
  await waiting.unmount()

  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })

  const busy = await mount($)

  expect(await has(busy, /RUNNING/)).toBe(true)
  expect(await has(busy, /WAITING/)).toBe(false)
  await busy.unmount()
})

test('a request is forwarded untouched and then shows in the band', async ($, on) => {
  world(on)
  model(on)
  await $.session.start(START)

  const { seen, result } = await drain($.turn.step(STEP))

  expect(seen.length).toBe(3)
  expect((seen[1] as { text: string }).text).toBe('hello')
  expect(result.answer).toBe('hello')
  expect(result.usage?.output_tokens).toBe(120)

  const ui = await mount($)

  expect(await has(ui, /SPEED/)).toBe(true)
  expect(await has(ui, /ttft/)).toBe(true)
  expect(await has(ui, /e2e/)).toBe(true)
  expect(await has(ui, /in 10 out 120/)).toBe(true)
  expect(await has(ui, /cache r40 w5/)).toBe(true)
  expect(await has(ui, /1 req/)).toBe(true)
  await ui.unmount()
})

test('a request with no usage still comes back whole', async ($, on) => {
  world(on)
  model(on, null)
  await $.session.start(START)

  const { result } = await drain($.turn.step(STEP))

  expect(result.answer).toBe('hello')
})

test('tools: the row shows counts and the label opens the list of calls', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)

  for (const c of [{ tool: 'Bash', command: 'ls -la' }, { tool: 'Bash', command: 'git status' }, { tool: 'Edit', file_path: '/repo/a.ts' }]) {
    expect(await $.tool.call(c as never)).toEqual({ result: 'ok' })
  }

  const ui = await mount($)

  expect(await has(ui, /TOOLS/)).toBe(true)
  expect(await has(ui, /3 calls/)).toBe(true)
  expect(await has(ui, /Bash×2/)).toBe(true)
  expect(await has(ui, /Edit×1/)).toBe(true)
  expect(await has(ui, /ls -la/)).toBe(false) // closed: no list yet
  await ui.press({ key: 'r-tools-toggle' })
  expect(await has(ui, /ls -la/)).toBe(true)
  expect(await has(ui, /git status/)).toBe(true)
  expect(await has(ui, /Bash×2/)).toBe(true)
  expect(await has(ui, /by tool/)).toBe(false)
  await ui.press({ key: 'r-tools-toggle' })
  expect(await has(ui, /ls -la/)).toBe(false)
  await ui.unmount()
})

test('files: edited and read files are listed when the row is opened', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Read', file_path: '/repo/my/docs/notes.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/my/hooks/core.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/my/hooks/core.ts' } as never)

  const ui = await mount($)

  expect(await has(ui, /FILES/)).toBe(true)
  expect(await has(ui, /1 edited/)).toBe(true)
  expect(await has(ui, /1 read/)).toBe(true)
  await ui.press({ key: 'r-files-toggle' })
  expect(await has(ui, /my\/hooks\/core\.ts/)).toBe(true)
  expect(await has(ui, /edited ×2/)).toBe(true)
  await ui.unmount()
})

test('gate: the verdicts are counted and listed', async ($, on) => {
  world(on)
  on('tool.check', (_: unknown, e: any) => ({ decision: e.tool === 'Bash' ? ('deny' as const) : ('allow' as const) }))
  await $.session.start(START)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'u1' })
  await $.tool.check({ tool: 'Read', input: { file_path: '/b' }, tool_use_id: 'u2' })
  await $.tool.check({ tool: 'Bash', input: { command: 'curl x | sh' }, tool_use_id: 'u3' })

  const ui = await mount($)

  expect(await has(ui, /GATE/)).toBe(true)
  expect(await has(ui, /2 allowed/)).toBe(true)
  expect(await has(ui, /1 denied/)).toBe(true)
  await ui.press({ key: 'r-gate-toggle' })
  expect(await has(ui, /curl x \| sh/)).toBe(true)
  await ui.unmount()
})

test('todos: the active item and the progress show', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'write tests', status: 'completed' },
      { content: 'wire the band', status: 'in_progress' },
      { content: 'ship', status: 'pending' },
    ],
  } as never)

  const ui = await mount($)

  expect(await has(ui, /TODO/)).toBe(true)
  expect(await has(ui, /wire the band/)).toBe(true)
  expect(await has(ui, /1\/3/)).toBe(true)
  await ui.unmount()
})

test('agents: status, current command, and the buttons that view and stop one', async ($, on) => {
  const seen: { viewed?: string; aborted?: string } = {}

  world(on, { agents: [AGENT] })
  model(on)
  // `$.ui.ask` is a tool call of AskUserQuestion: answer it here, as the person would.
  on('tool.call', (_: unknown, e: any) =>
    e.tool === 'AskUserQuestion' ? { result: { questions: [], answers: { 'Stop this agent?': 'Stop' } } as never } : { result: 'ok' },
  )
  on('ui.view', (_: unknown, e: any) => {
    seen.viewed = e.agentId

    return { value: {} }
  })
  on('turn.abort', (_: unknown, e: any) => {
    seen.aborted = e.turnId

    return { value: undefined } as never
  })
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 'A1', agentId: 'a1' })
  await drain($.turn.step({ ...STEP, turnId: 'A1', agentId: 'a1' }))

  const ui = await mount($)

  expect(await has(ui, /AGENTS/)).toBe(true)
  expect(await has(ui, /1 running/)).toBe(true)
  expect(await has(ui, /Explore/)).toBe(false) // closed
  await ui.press({ key: 'r-agents-toggle' })
  expect(await has(ui, /Explore/)).toBe(true)
  expect(await has(ui, /Find the auth code/)).toBe(true)
  expect(await has(ui, /1 steps/)).toBe(true)

  await ui.press({ key: 'a-view-a1' })
  expect(seen.viewed).toBe('a1')
  await ui.press({ key: 'a-stop-a1' })
  expect(seen.aborted).toBe('A1')
  await ui.unmount()
})

test('a subagent request counts under agents, not under the session', async ($, on) => {
  world(on, { agents: [AGENT] })
  model(on)
  await $.session.start(START)
  await drain($.turn.step({ ...STEP, agentId: 'a1' }))

  const ui = await mount($)

  expect(await has(ui, /SPEED/)).toBe(false)
  expect(await has(ui, /agents in/)).toBe(true)
  await ui.unmount()
})

test('expand and collapse open and close every section; the choice is remembered', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'echo hi' } as never)

  await $.command.run({ ...RUN, command: 'status-band', args: 'expand' })
  const open = await mount($)
  expect(await has(open, /echo hi/)).toBe(true)
  await open.unmount()

  await $.command.run({ ...RUN, command: 'status-band', args: 'collapse' })
  const closed = await mount($)
  expect(await has(closed, /echo hi/)).toBe(false)
  await closed.unmount()
})

test('hide removes the band, show brings it back, reset clears the counters', async ($, on) => {
  world(on)
  model(on)
  await $.session.start(START)
  await drain($.turn.step(STEP))

  expect((await $.command.run({ ...RUN, command: 'status-band', args: 'hide' })).text).toMatch(/hidden/)
  const hidden = await mount($)
  expect(await has(hidden, /IDLE/)).toBe(false)
  await hidden.unmount()

  await $.command.run({ ...RUN, command: 'status-band', args: 'show' })
  await $.command.run({ ...RUN, command: 'status-band', args: 'reset' })
  const shown = await mount($)
  expect(await has(shown, /CONTEXT/)).toBe(true)
  expect(await has(shown, /SPEED/)).toBe(false)
  await shown.unmount()
})

test('debug says why decode speed was skipped', async ($, on) => {
  world(on)
  model(on)
  await $.session.start(START)

  expect((await $.command.run({ ...RUN, command: 'status-band', args: 'debug' })).text).toMatch(/no request/)
  await drain($.turn.step(STEP))
  expect((await $.command.run({ ...RUN, command: 'status-band', args: 'debug' })).text).toMatch(/decode skipped/)
})

test('when session usage fails the hooks still run and requests still go through', async ($, on) => {
  world(on, { usage: false })
  model(on)
  await $.session.start(START)

  const { result } = await drain($.turn.step(STEP))

  expect(result.answer).toBe('hello')

  const ui = await mount($)

  expect(await has(ui, /CONTEXT/)).toBe(false)
  expect(await has(ui, /SPEED/)).toBe(true)
  await ui.unmount()
})

test('draws nothing while a survey is open', async ($, on) => {
  world(on)
  await $.session.start(START)

  const ui = await mount($, { props: { ...BAND.props, hasSurvey: true } })

  expect(await has(ui, /IDLE/)).toBe(false)
  await ui.unmount()
})

test('what was open last time is open again: the choice is kept in the store', async ($, on) => {
  world(on)
  mock.store(on, { prefs: { open: { tools: true } } })
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'echo kept' } as never)

  const ui = await mount($)

  expect(await has(ui, /echo kept/)).toBe(true) // open from the stored choice
  await ui.press({ key: 'r-tools-toggle' })
  expect(await has(ui, /echo kept/)).toBe(false)
  await ui.unmount()
})

const rowKeys = (tree: any): string[] => {
  const out: string[] = []
  const walk = (n: any) => {
    if (n && typeof n === 'object') {
      const k = n.props?.key

      if (n.type === 'Box' && typeof k === 'string' && /^r-/.test(k)) out.push(k.slice(2))
      ;(n.children ?? []).forEach?.(walk)
    }
  }

  walk(tree)

  return out
}

const run = ($: any, args: string) => $.command.run({ ...RUN, command: 'status-band', args })

test('rows draw in the saved order: git last as shipped, and /status-band order moves them', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)

  const first = await mount($)
  const before = rowKeys(await first.drawn())

  expect(before.slice(0, 2)).toEqual(['session', 'state'])
  expect(await has(first, /Untitled/)).toBe(true)
  expect(before[before.length - 1]).toBe('git')
  await first.unmount()

  expect((await run($, 'order git')).text).toMatch(/^order: git state/)

  const moved = await mount($)

  expect(rowKeys(await moved.drawn()).slice(0, 2)).toEqual(['session', 'git'])
  await moved.unmount()

  await run($, 'order reset')
  const again = await mount($)

  expect(rowKeys(await again.drawn()).pop()).toBe('git')
  await again.unmount()
})

test('order and hide say which rows exist when a name is wrong, and take aliases', async ($, on) => {
  world(on)
  await $.session.start(START)

  expect((await run($, 'order nope')).text).toMatch(/no row called nope/)
  expect((await run($, 'hide nope')).text).toMatch(/no row called nope/)
  expect((await run($, 'order ctx')).text).toMatch(/^order: context/)
})

test('a row can be hidden and shown again without hiding the band', async ($, on) => {
  world(on)
  await $.session.start(START)

  await run($, 'hide git')

  const hidden = await mount($)

  expect(await has(hidden, /GIT/)).toBe(false)
  expect(await has(hidden, /CONTEXT/)).toBe(true)
  await hidden.unmount()

  await run($, 'show git')

  const shown = await mount($)

  expect(await has(shown, /GIT/)).toBe(true)
  await shown.unmount()
})

test('colours are theme keys, as in the cockpit mods: a hue on the rail and label, never a ground or a hex', async ($, on) => {
  world(on)
  await $.session.start(START)

  const ui = await mount($)
  const json = JSON.stringify(await ui.drawn())

  expect(json).toContain('"color":"merged"') // the git row's hue
  expect(json).toContain('"color":"claude"') // the context row's
  expect(json).toContain('"color":"success"')
  expect(json).not.toContain('backgroundColor')
  expect(json).not.toMatch(/"color":"#/)
  expect(await has(ui, /▍ GIT/)).toBe(true)
  await ui.unmount()
})

test('the context row has the gauge and the limits on small gauges, like the cockpit usage band', async ($, on) => {
  world(on)
  await $.session.start(START)

  const ui = await mount($)

  expect(await has(ui, /━+●/)).toBe(true)
  expect(await has(ui, /5H/)).toBe(true)
  expect(await has(ui, /12%/)).toBe(true)
  await ui.unmount()
})

test('context keeps a placeholder, then uses only the latest same-model input when host fill is absent', async ($, on) => {
  world(on, { missingContext: true })
  model(on, { ...USAGE_OF, input_tokens: 10_000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2_000 })
  await $.session.start(START)
  const ui = await mount($)
  expect(await has(ui, /ctx unavailable/)).toBe(true)
  await drain($.turn.step(STEP))
  await drain($.turn.step(STEP))
  expect(await has(ui, /~5%/)).toBe(true)
  expect(await has(ui, /52k\/1M/)).toBe(true)
  await ui.unmount()
})

const recapLine = (content: string, isSidechain = false) =>
  JSON.stringify({ type: 'system', subtype: 'away_summary', content, isSidechain })

test('the pinned session row restores the title and only the latest main-session recap', async ($, on) => {
  const fixture = {
    transcript: [
      JSON.stringify({ type: 'custom-title', customTitle: 'Fix session metrics' }),
      recapLine('old recap'),
      recapLine('Next: check reload\n behavior (turn off recaps in /config)'),
      recapLine('sidechain recap', true),
    ].join('\n'),
  }
  world(on, fixture)
  await $.session.start(START)
  await settle()
  await run($, 'order git')

  const ui = await mount($)
  expect(rowKeys(await ui.drawn()).slice(0, 2)).toEqual(['session', 'git'])
  expect(await has(ui, /Fix session metrics/)).toBe(true)
  expect(await has(ui, /Next: check reload behavior/)).toBe(true)
  expect(await has(ui, /old recap|sidechain recap|turn off recaps/)).toBe(false)
  await ui.unmount()
})

test('a recap written while idle appears without a fresh turn or reload', async ($, on) => {
  const fixture = { transcript: '' }
  const clock = world(on, fixture)
  await $.session.start(START)
  await settle()
  const ui = await mount($)
  const initialRows = rowKeys(await ui.drawn())
  expect(initialRows.slice(0, 2)).toEqual(['session', 'state'])
  expect(await has(ui, /Untitled/)).toBe(true)
  expect(await has(ui, /Recap/)).toBe(false)

  fixture.transcript = JSON.stringify({ type: 'ai-title', aiTitle: 'Initial title' }) + '\n' + recapLine('Continue the regression check') + '\n'
  await clock.advance(5_000)
  await settle()
  expect(await has(ui, /Continue the regression check/)).toBe(true)
  expect(await has(ui, /Initial title/)).toBe(true)
  expect(rowKeys(await ui.drawn())).toEqual(initialRows)
  await ui.unmount()
})

test('the state row has the project and directory, effort, the thinking bubble and the version', async ($, on) => {
  const line = (o: object) => JSON.stringify(o)
  const transcript = [
    line({ type: 'ai-title', aiTitle: 'statusline config' }),
    line({ type: 'custom-title', customTitle: 'my rename' }),
    line({ type: 'api-request', id: 'r1', timestamp: '1970-01-01T00:00:01.000Z', params: { model: 'x', thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }, cacheControl: [{ value: { ttl: '1h' } }] }),
  ].join('\n')

  world(on, { transcript })
  await $.session.start(START)
  await settle()

  const ui = await mount($)

  expect(await has(ui, /my rename/)).toBe(true) // /rename wins over the generated name
  expect(await has(ui, /my\//)).toBe(true) // the project, then the directory
  expect(await has(ui, /status-band/)).toBe(true)
  expect(await has(ui, /◑ high/)).toBe(true) // the effort, before any request of this run
  expect(await has(ui, /💭/)).toBe(true) // requests go out with thinking on
  expect(await has(ui, /v2\.1\.332/)).toBe(true)
  await ui.unmount()
})

test('a session that began before the mod: the totals, the tool counts and the cache clock start from its transcript', async ($, on) => {
  const m = (id: string, tool?: { id: string; name: string }) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: '1970-01-01T00:00:02.000Z',
      message: {
        id,
        usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        content: tool ? [{ type: 'tool_use', id: tool.id, name: tool.name }] : [{ type: 'text', text: 'x' }],
      },
    })
  const transcript = [m('a'), m('b', { id: 't1', name: 'Bash' }), m('c', { id: 't2', name: 'Bash' })].join('\n')

  world(on, { transcript })
  await $.session.start(START)
  await settle()

  const ui = await mount($)

  expect(await has(ui, /session in 3k out 150/)).toBe(true)
  expect(await has(ui, /3 req/)).toBe(true)
  expect(await has(ui, /2 calls/)).toBe(true)
  expect(await has(ui, /Bash×2/)).toBe(true)
  await ui.press({ key: 'r-tools-toggle' })
  expect(await has(ui, /^Bash$/)).toBe(true)
  expect(await has(ui, /cache/)).toBe(true)
  await ui.unmount()
})

test('tools: reload restores distinct calls and matches results by tool use id', async ($, on) => {
  const use = (id: string, command: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command } })
  const result = (tool_use_id: string, is_error: boolean) => ({ type: 'tool_result', tool_use_id, is_error, content: 'private result' })
  const entry = (type: string, content: object[]) => JSON.stringify({ type, timestamp: '2026-11-25T04:00:10.000Z', message: { content } })
  const first = use('t1', 'echo historical first')
  const transcript = [
    entry('assistant', [first, use('t2', 'echo historical second'), use('t3', 'echo historical unknown')]),
    entry('assistant', [first]),
    entry('user', [result('t2', true), result('t1', false)]),
  ].join('\n')
  world(on, { transcript })
  await $.session.start(START)
  await settle()
  const ui = await mount($)
  expect(await has(ui, /3 calls/)).toBe(true)
  expect(await has(ui, /historical/)).toBe(false)
  await ui.press({ key: 'r-tools-toggle' })
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.indexOf('historical unknown')).toBeLessThan(tree.indexOf('historical second'))
  expect(tree.indexOf('historical second')).toBeLessThan(tree.indexOf('historical first'))
  expect(tree.match(/historical first/g)?.length).toBe(1)
  expect(await has(ui, /✗ /)).toBe(true)
  expect(await has(ui, /\? /)).toBe(true)
  expect(await has(ui, /private result/)).toBe(false)
  await ui.unmount()
})

test('without a cache report from the API the countdown is worked out from the last response and the lifetime the requests ask for', async ($, on) => {
  const clock = world(on, { cache: false })

  model(on)
  await $.session.start(START)
  await clock.advance(5_000)
  await drain($.turn.step(STEP))
  await clock.advance(60_000)

  const ui = await mount($)

  expect(await has(ui, /cache/)).toBe(true)
  expect(await has(ui, /4m00s/)).toBe(true) // no lifetime known: five minutes, minus the minute that has passed
  await ui.unmount()
})

test('a long cache lifetime in the transcript gives a long countdown, and a short one gives expired', async ($, on) => {
  const req = (ttl: string) =>
    JSON.stringify({ type: 'api-request', id: 'r1', timestamp: '1970-01-01T00:00:01.000Z', params: { model: 'x' }, cacheControl: [{ value: { ttl } }] }) +
    '\n' +
    JSON.stringify({ type: 'assistant', requestRef: 'r1', apiBlockIndex: 0, timestamp: '1970-01-01T00:00:03.000Z', message: { id: 'm1', stop_reason: 'end_turn', content: [{ type: 'text' }], usage: { input_tokens: 5, output_tokens: 5 } } })

  world(on, { transcript: req('1h'), cache: false })
  await $.session.start(START)
  await settle()

  const long = await mount($)

  expect(await has(long, /59m|1h00m/)).toBe(true)
  await long.unmount()
})

test('the speed row, the last request and the api time start from the transcript too', async ($, on) => {
  const at = (sec: number) => new Date(sec * 1000).toISOString()
  const rows: string[] = []

  for (let i = 0; i < 4; i += 1) {
    const t0 = 10 + i * 20

    rows.push(
      JSON.stringify({ type: 'api-request', id: 'r' + i, timestamp: at(t0), params: { model: 'example-provider/claude-sonnet-5-5' }, cacheControl: [] }),
      JSON.stringify({ type: 'assistant', requestRef: 'r' + i, apiBlockIndex: 0, timestamp: at(t0 + 4), thinkingDurationMs: 1000, message: { id: 'm' + i, stop_reason: 'tool_use', content: [{ type: 'thinking' }], usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
      JSON.stringify({ type: 'assistant', requestRef: 'r' + i, apiBlockIndex: 1, timestamp: at(t0 + 5), message: { id: 'm' + i, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't' + i, name: 'Bash' }], usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    )
  }
  world(on, { transcript: rows.join('\n'), missingContext: true })
  await $.session.start(START)
  await settle()

  const ui = await mount($)

  expect(await has(ui, /~0%/)).toBe(true)
  expect(await has(ui, /100\/1M/)).toBe(true)
  expect(await has(ui, /SPEED/)).toBe(true)
  expect(await has(ui, /ttft 3\.0s/)).toBe(true) // 4 s to the end of thinking, 1 s of it spent thinking
  expect(await has(ui, /e2e 5\.0s/)).toBe(true)
  expect(await has(ui, /tps~ 8\.0 tok\/s/)).toBe(true) // 40 tokens over 5 s
  expect(await has(ui, /p50×4/)).toBe(true)
  expect(await has(ui, /last in 100 out 40/)).toBe(true)
  expect(await has(ui, /api 20s/)).toBe(true) // four requests of five seconds
  await ui.unmount()
})

test('lines the edits changed add up, and a context over 200k says so', async ($, on) => {
  world(on, { ctx: 250_000 })
  on('tool.call', () => ({ result: { structuredPatch: [{ lines: ['+a', '+b', '-c'] }] } as never }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'x', new_string: 'y' } as never)

  const ui = await mount($)

  expect(await has(ui, /\+4/)).toBe(true)
  expect(await has(ui, /−2/)).toBe(true)
  expect(await has(ui, />200k/)).toBe(true)
  await ui.unmount()
})
