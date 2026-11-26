import {
  AGENT_GLYPH,
  ROW_HUE,
  STATE_HUE,
  STATE_WORD,
  agentSummary,
  baseName,
  cacheLeftMs,
  effortLabel,
  fmtAgo,
  fmtClock,
  fmtDur,
  fmtMs,
  fmtSecs,
  fmtTok,
  fmtTps,
  fmtUsd,
  foldTool,
  isLive,
  limitLabel,
  median,
  modelLabel,
  shortPath,
  toneOf,
  ttlMs,
  visibleOrder,
  titleOf,
} from './core'
import { action, detail, dim, kv, line, meter, nums, plain, row } from './kit'

import type {
  AgentInfoRow,
  AgentTrack,
  CallEntry,
  FileEntry,
  GateState,
  GitInfo,
  Identity,
  LinesChanged,
  MeasureState,
  OpenKey,
  PerfState,
  Prefs,
  Receipt,
  RowId,
  SessionStatus,
  Todo,
  Totals,
} from './core'
import type { Ui } from './kit'
import type { Color } from 'claude-code'

/** Everything the band draws, read once per drawing. */
export type Snap = {
  now: number
  columns: number
  viewAgent: string | null
  status: SessionStatus
  identity: Identity
  git: GitInfo | null
  measure: MeasureState | null
  perf: PerfState
  main: Totals
  agents: Totals
  receipt: Receipt | null
  calls: CallEntry[]
  counts: Record<string, number>
  files: FileEntry[]
  gate: GateState
  todos: Todo[]
  agentList: AgentInfoRow[]
  track: Record<string, AgentTrack>
  prefs: Prefs
  lines: LinesChanged
  /** When the last response came, in epoch milliseconds; 0 before the first. */
  lastResponse: number
}

/** What the buttons do. They are made inside the `ui.render` hook, where `$` is. */
export type Actions = {
  toggle: (key: OpenKey) => unknown
  toggleAgent: (id: string) => unknown
  viewAgent: (id: string | null) => unknown
  stopAgent: (id: string) => unknown
}

const DETAIL_LINES = 10

type Ctx = { ui: Ui; s: Snap; act: Actions }

// Theme keys for the state of a value, as the cockpit mods use them.
const OK = 'success'
const WARN = 'warning'
const BAD = 'error'

const BLUE = 'suggestion'
// Theme aliases can resolve to the same RGB. These accents keep categories distinct.
const ACCENT = {
  blue: '#5483c9', teal: '#258c8d', purple: '#936cc4', orange: '#bd7139',
  pink: '#bb668e', slate: '#667c9e', olive: '#88823c', indigo: '#7569c2',
  copper: '#b7655a', cyan: '#397fa3',
} as const
const TOOL_HUES = Object.values(ACCENT)

const toolColors = (names: readonly string[]): Map<string, Color> => {
  const colors = new Map<string, Color>()
  const used = new Set<Color>()
  for (const name of names) {
    if (colors.has(name)) continue
    let hash = 0
    for (const ch of name) hash = Math.imul(hash, 31) + ch.charCodeAt(0) | 0
    const start = (hash >>> 0) % TOOL_HUES.length
    const choices = [...TOOL_HUES.slice(start), ...TOOL_HUES.slice(0, start)]
    const color = choices.find(choice => !used.has(choice)) ?? choices[0]!
    colors.set(name, color)
    used.add(color)
  }
  return colors
}

/** A glyph and a colour for how a call, a check or an agent went. */
const glyphOf = (status: string): { glyph: string; color: string } =>
  status === 'running' || status === 'pending'
    ? { glyph: '◐', color: WARN }
    : status === 'error' || status === 'failed' || status === 'deny'
      ? { glyph: '✗', color: BAD }
      : status === 'denied' || status === 'killed'
        ? { glyph: '⊘', color: BAD }
        : status === 'ask'
          ? { glyph: '?', color: WARN }
          : { glyph: '✓', color: OK }

/** A counted figure: dim when the count is zero, so a quiet row stays quiet. */
const counted = (c: Ctx, glyph: string, n: number, word: string, color: Color | undefined, key: string) =>
  n === 0 ? dim(c.ui, glyph + ' ' + n + ' ' + word, key) : kv(c.ui, glyph, n + ' ' + word, color, key)

const cmdOf = (name: string, target: string): string => foldTool(name) + (target !== '' ? ': ' + target : '')

// ---- one function per row --------------------------------------------------------------------

/** `project/dir`: the project's name dim, the directory in the text colour; just the directory when they are one. */
const dirItem = (ui: Ui, id: Identity) => {
  const { Text } = ui
  const dir = baseName(id.cwd)
  const root = id.root !== '' && id.root !== id.cwd ? baseName(id.root) : ''

  return (
    <Text key="cwd">
      {root !== '' ? <Text dimColor>{root + '/'}</Text> : null}
      <Text>{dir}</Text>
    </Text>
  )
}

const stateRow = (c: Ctx) => {
  const { ui, s } = c
  const st = s.status
  const tone = STATE_HUE[st.state]
  const items: unknown[] = [plain(ui, STATE_WORD[st.state], 'status', tone, true)]

  if (st.state === 'waiting') {
    items.push(plain(ui, 'needs you' + (st.waitingFor !== null ? ': ' + st.waitingFor : ''), 'wait', tone, true))
  }
  if (st.state === 'busy' && st.since > 0) {
    const tools = s.calls.filter(x => x.agentId === null && x.at >= st.since).length

    items.push(kv(ui, 'turn', fmtAgo(s.now - st.since) + (tools > 0 ? ' · ' + tools + ' tools' : ''), undefined, 'turn', false, BLUE))
  }
  if (s.identity.model !== '') {
    const { Text } = ui

    items.push(
      <Text key="model">
        <Text color={BLUE} bold>{modelLabel(s.identity.model)}</Text>
        <Text color={WARN}>{' ' + effortLabel(s.identity.effort ?? undefined)}</Text>
        {s.identity.thinking ? <Text dimColor>{' 💭'}</Text> : null}
      </Text>,
    )
  }
  if (s.identity.cwd !== '') items.push(dirItem(ui, s.identity))
  if (st.state === 'idle') {
    if (s.receipt !== null) {
      const r = s.receipt

      items.push(
        dim(ui, 'last turn ' + fmtDur(r.durationMs) + ' · ' + r.tools + ' tools' + (r.errors > 0 ? ' · ' + r.errors + ' err' : ''), 'receipt'),
      )
    }
    if (st.since > 0) items.push(dim(ui, 'idle ' + fmtAgo(s.now - st.since), 'idle'))
  }
  items.push(dim(ui, s.identity.version === '' ? 'version —' : 'v' + s.identity.version, 'version'))

  return row(ui, ROW_HUE.state, 'info', line(ui, items), 'r-state')
}

const gitRow = (c: Ctx) => {
  const { ui, s } = c
  const g = s.git

  if (g === null) return null

  const { Text } = ui
  const tone = ROW_HUE.git
  const items: unknown[] = [
    <Text key="branch" bold>
      {g.branch}
    </Text>,
    g.changed === 0 ? (
      <Text key="changes" color={OK}>
        {'✓ clean'}
      </Text>
    ) : (
      <Text key="changes">
        <Text>{'±' + g.changed + ' '}</Text>
        <Text color={OK}>{'+' + g.added}</Text>
        <Text>{' '}</Text>
        <Text color={BAD}>{'−' + g.removed}</Text>
      </Text>
    ),
  ]

  if (g.ahead > 0) items.push(plain(ui, '↑' + g.ahead, 'ahead', WARN))
  if (g.behind > 0) items.push(plain(ui, '↓' + g.behind, 'behind', WARN))
  if (g.subject !== '') items.push(dim(ui, g.subject + (g.age !== '' ? ' · ' + g.age : ''), 'subject'))

  // Gaps, not dots: the branch, the changes and the arrows read as one cluster.
  return row(ui, tone, 'git', line(ui, items, '  '), 'r-git')
}

const contextRow = (c: Ctx) => {
  const { ui, s } = c
  const m = s.measure ?? { window: 0, percent: null, tokens: null, limits: [], costUsd: null, startedAt: 0 }

  const { Text } = ui
  const items: unknown[] = []
  const hasWindow = Number.isFinite(m.window) && m.window > 0
  const inputOf = (step: NonNullable<PerfState['last']>) =>
    step.usage.input + step.usage.cacheRead + step.usage.cacheWrite
  const sample = m.percent === null && m.tokens === null && hasWindow && s.identity.model !== ''
    ? s.perf.recent.findLast(step => {
      const input = inputOf(step)
      return step.model === s.identity.model && Number.isFinite(input) && input > 0
    }) : undefined
  const estimated = sample !== undefined
  const older = estimated && !Object.is(sample, s.perf.recent.at(-1))
  const tokens = sample === undefined ? m.tokens : inputOf(sample)
  const pct = m.percent ?? (tokens !== null && hasWindow ? Math.min(100, Math.round(tokens / m.window * 100)) : null)

  // The gauge, the percentage and the tokens; then each rate-limit window on a small gauge; then the cost.
  if (pct !== null) {
    const tone = toneOf(pct)
    const used = tokens !== null && hasWindow ? (older ? '  last ' : '  ') + fmtTok(tokens) + '/' + fmtTok(m.window) : ''

    items.push(
      <Text key="ctx">
        {meter(ui, pct, 14, tone)}
        <Text color={tone}>{' ' + (estimated ? '~' : '') + pct + '%'}</Text>
        <Text dimColor>{used}</Text>
        {pct >= 80 && !older ? <Text color={BAD}>{'  ⚠ /compact'}</Text> : null}
        {tokens !== null && tokens > 200_000 ? <Text color={BAD} bold>{'  >200k'}</Text> : null}
      </Text>,
    )
  } else {
    items.push(dim(ui, '─'.repeat(14) + '  ctx unavailable', 'ctx'))
  }
  for (const l of m.limits.slice(0, 2)) {
    const tone = toneOf(l.percentUsed)

    items.push(
      <Text key={'lim-' + l.kind}>
        <Text dimColor>{limitLabel(l.kind).toUpperCase() + ' '}</Text>
        {meter(ui, l.percentUsed, 6, tone)}
        <Text color={tone}>{' ' + Math.round(l.percentUsed) + '%'}</Text>
      </Text>,
    )
  }
  items.push(kv(ui, 'cost~', m.costUsd === null ? '—' : fmtUsd(m.costUsd), m.costUsd === null ? 'inactive' : undefined, 'cost', false, ACCENT.purple))
  if (s.lines.added > 0 || s.lines.removed > 0) {
    items.push(
      <Text key="lines">
        <Text color={OK}>{'+' + s.lines.added}</Text>
        <Text color={BAD}>{' −' + s.lines.removed}</Text>
      </Text>,
    )
  }
  const apiMs = s.main.apiMs + s.agents.apiMs
  items.push(kv(ui, 'up', m.startedAt > 0 ? fmtDur(Math.max(0, s.now - m.startedAt)) : '—', m.startedAt > 0 ? undefined : 'inactive', 'up', false, ACCENT.teal))
  items.push(kv(ui, 'api', apiMs > 0 ? fmtDur(apiMs) : '—', apiMs > 0 ? undefined : 'inactive', 'api', false, ACCENT.blue))

  return items.length > 0 ? row(ui, ROW_HUE.context, 'context', line(ui, items, '   '), 'r-context') : null
}

const tokensRow = (c: Ctx, wide: boolean) => {
  const { ui, s } = c
  const m = s.measure
  const tone = ROW_HUE.tokens
  const items: unknown[] = []

  // The cache countdown. Claude Code reports the cache only when the API says what it cached; through a gateway
  // that never does, so the countdown is then worked out from the last response and the cache's lifetime.
  const ttl = m?.cache?.ttl ?? (s.identity.cacheTtl !== '' ? s.identity.cacheTtl : '5m')

  if (m !== null && m.cache !== null && m.cache.isWarm) {
    const left = cacheLeftMs(m.cache, s.now)

    items.push(kv(ui, 'cache', left > 0 ? fmtDur(left) : 'warm', left <= ttlMs(ttl) * 0.2 ? WARN : OK, 'cache', false, ACCENT.teal))
  } else if (s.lastResponse > 0) {
    const left = ttlMs(ttl) - (s.now - s.lastResponse)

    items.push(left > 0 ? kv(ui, 'cache', fmtDur(left), left <= ttlMs(ttl) * 0.2 ? WARN : OK, 'cache', false, ACCENT.teal) : kv(ui, 'cache', 'expired', 'inactive', 'cache', false, ACCENT.teal))
  } else if (m !== null && m.cache !== null) {
    items.push(kv(ui, 'cache', 'cold', undefined, 'cache', false, ACCENT.teal))
  } else {
    items.push(kv(ui, 'cache', '—', 'inactive', 'cache', false, ACCENT.teal))
  }

  const last = s.perf.last

  // An all-zero usage object cannot tell us whether the provider measured any tokens.
  const tokenPairs = (u?: Pick<Snap['main'], 'input' | 'output' | 'cacheRead' | 'cacheWrite'>) => {
    const hasUsage = u !== undefined && u.input + u.output + u.cacheRead + u.cacheWrite > 0
    return [['in', hasUsage ? fmtTok(u.input) : '—', ACCENT.cyan], ['out', hasUsage ? fmtTok(u.output) : '—', ACCENT.pink]] as const
  }
  const u = last?.usage
  const all = u === undefined ? 0 : u.input + u.cacheRead + u.cacheWrite
  const lastCache = u !== undefined && (u.cacheRead > 0 || u.cacheWrite > 0)
    ? ' · cache r' + fmtTok(u.cacheRead) + ' w' + fmtTok(u.cacheWrite) + (all > 0 ? ' ' + Math.round((u.cacheRead * 100) / all) + '% hit' : '') : ''
  items.push(nums(ui, 'last', tokenPairs(u), 'last', lastCache, ACCENT.purple))

  const t = s.main
  const cache = t.cacheRead > 0 || t.cacheWrite > 0 ? ' · cache r' + fmtTok(t.cacheRead) + ' w' + fmtTok(t.cacheWrite) : ''
  items.push(nums(ui, 'session', tokenPairs(t), 'session', cache + (t.reqs > 0 ? ' · ' + t.reqs + ' req' : ''), ACCENT.orange))
  if (wide && s.agents.reqs > 0) {
    items.push(nums(ui, 'agents', [['in', fmtTok(s.agents.input), ACCENT.cyan], ['out', fmtTok(s.agents.output), ACCENT.pink]], 'agents', ' · ' + s.agents.reqs + ' req', ACCENT.slate))
  }

  return items.length > 0 ? row(ui, tone, 'tokens', line(ui, items), 'r-tokens') : null
}

const speedRow = (c: Ctx, wide: boolean) => {
  const { ui, s } = c
  const last = s.perf.last

  if (last === null) return null

  const tone = ROW_HUE.speed
  const items: unknown[] = []

  const metric = (label: string, value: number | null, format: (n: number) => string, accent: Color, key = label) =>
    kv(ui, label, value === null ? '—' : format(value), value === null ? 'inactive' : undefined, key, false, accent)
  items.push(
    metric('ttft', last.ttft, fmtSecs, ACCENT.blue),
    metric('tpot', last.tpot, fmtMs, ACCENT.teal),
    metric(last.tps === null && last.tpsE2e !== null ? 'tps~' : 'tps', last.tps ?? last.tpsE2e, fmtTps, ACCENT.purple, 'tps'),
    metric('e2e', last.e2e, fmtSecs, ACCENT.orange),
  )

  const rec = s.perf.recent

  if (wide && rec.length >= 3) {
    const parts: string[] = []
    const mt = median(rec.map(r => r.ttft).filter((v): v is number => v !== null))
    const mp = median(rec.map(r => r.tpsE2e).filter((v): v is number => v !== null))
    const me = median(rec.map(r => r.e2e))

    parts.push('ttft ' + (mt === null ? '—' : fmtSecs(mt)), 'tps~ ' + (mp === null ? '—' : fmtTps(mp)), 'e2e ' + (me === null ? '—' : fmtSecs(me)))
    items.push(dim(ui, 'p50×' + rec.length + '  ' + parts.join('  '), 'p50'))
  }

  return row(ui, tone, 'speed', line(ui, items), 'r-speed')
}

const callLine = (c: Ctx, call: CallEntry, color: Color | undefined) => {
  const { Text } = c.ui
  const g = call.status === 'unknown' ? { glyph: '?', color: 'inactive' } : glyphOf(call.status)
  const took = call.ms !== null ? fmtSecs(call.ms / 1000) : call.status === 'running' ? fmtAgo(c.s.now - call.at) : ''
  const time = call.at === 0 ? '--:--:--' : fmtClock(call.at)

  return (
    <Text wrap="truncate-end">
      <Text dimColor>{time + '  '}</Text>
      <Text color={g.color}>{g.glyph + ' '}</Text>
      <Text color={color}>{foldTool(call.name)}</Text>
      <Text dimColor>{(call.target !== '' ? '  ' + call.target : '') + (took !== '' ? '  · ' + took : '') + (call.agentId !== null ? '  ↳ ' + call.agentId.slice(0, 8) : '')}</Text>
    </Text>
  )
}

const toolsRows = (c: Ctx): unknown[] => {
  const { ui, s, act } = c

  if (s.calls.length === 0 && Object.keys(s.counts).length === 0) return []

  const tone = ROW_HUE.tools
  const ranked = Object.entries(s.counts).sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  const total = ranked.reduce((sum, [, n]) => sum + n, 0)
  const { Text } = ui
  const items = [plain(ui, total + (total === 1 ? ' call' : ' calls'), 'total')]
  const top = ranked.slice(0, 5)
  const recent = s.calls.slice(-DETAIL_LINES).reverse()
  const colors = toolColors([...top.map(([name]) => name), ...recent.map(call => call.name)])
  for (const [name, n] of top) {
    items.push(<Text key={name}><Text color={colors.get(name)}>{foldTool(name)}</Text><Text>{'×' + n}</Text></Text>)
  }
  if (ranked.length > 5) items.push(dim(ui, '+' + (ranked.length - 5) + ' tool types', 'other-types'))
  const toggle = s.calls.length === 0 ? undefined : { isOpen: s.prefs.open.tools, onPress: () => act.toggle('tools') }
  const out: unknown[] = [row(ui, tone, 'tools', line(ui, items), 'r-tools', toggle)]

  if (toggle?.isOpen) {
    out.push(detail(ui, tone, recent.map(call => callLine(c, call, colors.get(call.name))), 'd-tools'))
  }

  return out
}

const filesRows = (c: Ctx): unknown[] => {
  const { ui, s, act } = c

  if (s.files.length === 0) return []

  const tone = ROW_HUE.files
  const edited = s.files.filter(f => f.w > 0).length
  const read = s.files.filter(f => f.w === 0 && f.r > 0).length
  const recent = [...s.files].reverse().slice(0, 3).map(f => baseName(f.path))
  const items: unknown[] = [
    counted(c, '✎', edited, 'edited', WARN, 'edited'),
    counted(c, '◉', read, 'read', undefined, 'read'),
    dim(ui, recent.join('  '), 'recent'),
  ]
  const out: unknown[] = [row(ui, tone, 'files', line(ui, items), 'r-files', { isOpen: s.prefs.open.files, onPress: () => act.toggle('files') })]

  if (s.prefs.open.files) {
    const { Text } = ui
    const lines = [...s.files]
      .reverse()
      .slice(0, DETAIL_LINES)
      .map((f, i) => (
        <Text key={'f' + i} wrap="truncate-end">
          <Text color={f.w > 0 ? WARN : undefined} dimColor={f.w === 0}>{f.w > 0 ? '✎ ' : '◉ '}</Text>
          <Text>{shortPath(f.path)}</Text>
          <Text dimColor>{'  ' + (f.w > 0 ? 'edited ×' + f.w : '') + (f.w > 0 && f.r > 0 ? ' · ' : '') + (f.r > 0 ? 'read ×' + f.r : '') + '  · ' + fmtClock(f.at)}</Text>
        </Text>
      ))

    out.push(detail(ui, tone, lines, 'd-files'))
  }

  return out
}

const gateRows = (c: Ctx): unknown[] => {
  const { ui, s, act } = c
  const g = s.gate

  if (g.allow + g.ask + g.deny === 0) return []

  const tone = ROW_HUE.gate
  const items: unknown[] = [
    counted(c, '✓', g.allow, 'allowed', OK, 'allow'),
    counted(c, '?', g.ask, 'asked', WARN, 'ask'),
    counted(c, '✗', g.deny, 'denied', BAD, 'deny'),
  ]
  const out: unknown[] = [row(ui, tone, 'gate', line(ui, items), 'r-gate', { isOpen: s.prefs.open.gate, onPress: () => act.toggle('gate') })]

  if (s.prefs.open.gate) {
    const { Text } = ui
    const lines = [...g.recent]
      .reverse()
      .slice(0, DETAIL_LINES)
      .map((entry, i) => {
        const gl = glyphOf(entry.decision)

        return (
          <Text key={'g' + i} wrap="truncate-end">
            <Text dimColor>{fmtClock(entry.at) + '  '}</Text>
            <Text color={gl.color}>{gl.glyph + ' '}</Text>
            <Text>{foldTool(entry.tool)}</Text>
            <Text dimColor>{(entry.target !== '' ? '  ' + entry.target : '') + (entry.agentId !== null ? '  ↳ ' + entry.agentId.slice(0, 8) : '')}</Text>
          </Text>
        )
      })

    out.push(detail(ui, tone, lines, 'd-gate'))
  }

  return out
}

const agentLines = (c: Ctx): unknown[] => {
  const { ui, s, act } = c
  const { Box, Text, Button } = ui
  const tone = ROW_HUE.agents
  const lines: unknown[] = []

  for (const a of s.agentList.slice(-8)) {
    const live = isLive(a.status)
    const t = s.track[a.id]
    const glyph = AGENT_GLYPH[a.status] ?? '·'
    const color: Color = live ? WARN : a.status === 'failed' || a.status === 'killed' ? BAD : OK
    const last = t !== undefined && t.recent.length > 0 ? (t.recent[t.recent.length - 1] as { name: string; target: string }) : null
    const cmd = t?.current != null ? cmdOf(t.current.name, t.current.target) : last !== null ? 'last: ' + cmdOf(last.name, last.target) : ''
    const stats = [
      live && a.startTime > 0 ? fmtAgo(s.now - a.startTime) : '',
      t !== undefined && t.ctx > 0 ? fmtTok(t.ctx) + ' ctx' : '',
      t !== undefined && t.steps > 0 ? t.steps + ' steps' : '',
    ].filter(x => x !== '')
    const isOpen = s.prefs.agentOpen.includes(a.id)

    lines.push(
      <Box key={'a-' + a.id}>
        <Button key={'a-name-' + a.id} plain onPress={() => act.toggleAgent(a.id)}>
          <Text color={color}>{glyph + ' '}</Text>
          <Text color={tone} bold>{a.type}</Text>
          <Text dimColor>{(a.model !== null ? ' [' + a.model + ']' : '') + (isOpen ? ' ▾' : ' ▸')}</Text>
        </Button>
        <Text wrap="truncate-end">
          <Text dimColor>{a.label !== '' ? '  ' + a.label.slice(0, 32) : ''}</Text>
          <Text>{cmd !== '' ? '  · ' + cmd : ''}</Text>
          <Text dimColor>{stats.length > 0 ? '  · ' + stats.join(' · ') : ''}</Text>
        </Text>
        {s.viewAgent === a.id ? action(ui, 'main', () => act.viewAgent(null), 'a-main-' + a.id) : action(ui, 'view', () => act.viewAgent(a.id), 'a-view-' + a.id)}
        {live && t?.turnId != null ? action(ui, 'stop', () => act.stopAgent(a.id), 'a-stop-' + a.id, BAD) : null}
      </Box>,
    )
    if (isOpen && t !== undefined) {
      for (const [i, r] of [...t.recent].reverse().entries()) {
        const rg = glyphOf(r.status)

        lines.push(
          <Text key={'a-' + a.id + '-r' + i} wrap="truncate-end">
            <Text dimColor>{'    '}</Text>
            <Text color={rg.color}>{rg.glyph + ' '}</Text>
            <Text dimColor>{cmdOf(r.name, r.target)}</Text>
          </Text>,
        )
      }
    }
  }

  return lines
}

const agentsRows = (c: Ctx): unknown[] => {
  const { ui, s, act } = c

  if (s.agentList.length === 0) return []

  const { Text } = ui
  const tone = ROW_HUE.agents
  const sum = agentSummary(s.agentList)
  const items: unknown[] = []

  if (sum.live > 0) items.push(kv(ui, '◐', sum.live + ' running', WARN, 'live'))
  if (sum.done > 0) items.push(kv(ui, '✓', sum.done + ' done', OK, 'done'))
  if (sum.failed > 0) items.push(kv(ui, '✗', sum.failed + ' failed', BAD, 'failed'))
  if (s.viewAgent !== null) items.push(action(ui, 'back to main', () => act.viewAgent(null), 'back'))

  for (const a of s.agentList.filter(x => isLive(x.status)).slice(0, 2)) {
    const t = s.track[a.id]

    if (t?.current != null) {
      items.push(
        <Text key={'cur-' + a.id} dimColor>
          {a.type + ': ' + cmdOf(t.current.name, t.current.target)}
        </Text>,
      )
    }
  }

  const out: unknown[] = [row(ui, tone, 'agents', line(ui, items), 'r-agents', { isOpen: s.prefs.open.agents, onPress: () => act.toggle('agents') })]

  if (s.prefs.open.agents) out.push(detail(ui, tone, agentLines(c), 'd-agents'))

  return out
}

const todoRow = (c: Ctx) => {
  const { ui, s } = c

  if (s.todos.length === 0) return null

  const done = s.todos.filter(t => t.status === 'completed').length
  const active = s.todos.find(t => t.status === 'in_progress')
  const { Text } = ui
  const body =
    active !== undefined ? (
      <Text wrap="truncate-end">
        <Text color={WARN}>{'▸ '}</Text>
        <Text>{active.content.slice(0, 60)}</Text>
        <Text dimColor>{' (' + done + '/' + s.todos.length + ')'}</Text>
      </Text>
    ) : done === s.todos.length ? (
      <Text color={OK}>{'✓ all done (' + done + '/' + s.todos.length + ')'}</Text>
    ) : (
      <Text dimColor>{done + '/' + s.todos.length + ' done, none in progress'}</Text>
    )

  return row(ui, ROW_HUE.todo, 'todo', body, 'r-todo')
}

const sessionRow = (ui: Ui, identity: Identity) => {
  const title = titleOf(identity)

  const items = [plain(ui, title || 'Untitled', 'title', undefined, true)]
  if (identity.recap !== '') items.push(kv(ui, 'Recap', identity.recap))

  return row(ui, ROW_HUE.git, 'session', line(ui, items), 'r-session')
}

/** A pinned session row followed by the rows in the person's chosen order. */
export const buildRows = (ui: Ui, s: Snap, act: Actions): unknown[] => {
  const c: Ctx = { ui, s, act }
  const wide = s.columns >= 100
  const one = (x: unknown): unknown[] => (x === null ? [] : [x])
  const rows: Record<RowId, () => unknown[]> = {
    state: () => one(stateRow(c)),
    context: () => one(contextRow(c)),
    tokens: () => one(tokensRow(c, wide)),
    speed: () => one(speedRow(c, wide)),
    agents: () => agentsRows(c),
    tools: () => toolsRows(c),
    files: () => filesRows(c),
    gate: () => gateRows(c),
    todo: () => one(todoRow(c)),
    git: () => one(gitRow(c)),
  }

  return [sessionRow(ui, s.identity), ...visibleOrder(s.prefs).flatMap(id => rows[id]())]
}
