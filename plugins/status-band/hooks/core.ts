// Pure logic of status-band: no `$`, no engine calls, so tests can import it directly.

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Totals = Usage & { reqs: number; apiMs: number }

export const EMPTY_TOTALS: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reqs: 0, apiMs: 0 }

/** What the `turn.step` hook saw of one request, in `performance.now()` milliseconds. */
export type StepSample = {
  sentAt: number
  endAt: number
  /** First text, thinking, tool or input chunk; 0 when none arrived. */
  firstAt: number
  firstKind: string
  lastContentAt: number
  contentChunks: number
  hasThinking: boolean
}

export type StepStats = {
  at: number
  model: string
  /** Seconds from sending the request to its first content chunk. */
  ttft: number | null
  /** Milliseconds per output token while streaming; null when decode speed is not measurable. */
  tpot: number | null
  /** Output tokens per second while streaming; null when decode speed is not measurable. */
  tps: number | null
  /** Output tokens over the whole request, so it includes ttft and any server-side thinking. */
  tpsE2e: number | null
  e2e: number
  usage: Usage
  /** Why `tps` is null, for `/status-band debug`. */
  note: string
  /** The response had a thinking block. */
  thinking: boolean
  contentChunks: number
  firstKind: string
}

// A response that arrives in one burst is not streamed: the server held it back (thinking) or a layer
// beneath buffered it. Decode speed needs real streaming, so these limits mark what counts as streamed.
export const MIN_CHUNKS = 8
export const MIN_WINDOW_S = 0.5
export const MAX_PLAUSIBLE_TPS = 600

export const summarizeStep = (s: StepSample, usage: Usage, model: string, at: number): StepStats => {
  const e2e = Math.max(0, (s.endAt - s.sentAt) / 1000)
  const ttft = s.firstAt > 0 ? Math.max(0, (s.firstAt - s.sentAt) / 1000) : null
  const window = s.firstAt > 0 ? (s.lastContentAt - s.firstAt) / 1000 : 0
  const tpsE2e = usage.output > 0 && e2e > 0 ? usage.output / e2e : null

  let tps: number | null = null
  let tpot: number | null = null
  let note = ''

  if (usage.output <= 1) note = 'too few output tokens'
  else if (s.firstAt === 0) note = 'no content chunk'
  else if (s.hasThinking) note = 'thinking: output tokens include thinking that is not streamed'
  else if (s.contentChunks < MIN_CHUNKS) note = 'fewer than ' + MIN_CHUNKS + ' content chunks'
  else if (window < MIN_WINDOW_S) note = 'streaming window under ' + MIN_WINDOW_S + 's'
  else if (usage.output / window > MAX_PLAUSIBLE_TPS) note = 'burst: over ' + MAX_PLAUSIBLE_TPS + ' tok/s'
  else {
    tps = usage.output / window
    tpot = (window * 1000) / (usage.output - 1)
  }

  return { at, model, ttft, tpot, tps, tpsE2e, e2e, usage, note, thinking: s.hasThinking, contentChunks: s.contentChunks, firstKind: s.firstKind }
}

export const addUsage = (t: Totals, u: Usage, apiMs: number): Totals => ({
  input: t.input + u.input,
  output: t.output + u.output,
  cacheRead: t.cacheRead + u.cacheRead,
  cacheWrite: t.cacheWrite + u.cacheWrite,
  reqs: t.reqs + 1,
  apiMs: t.apiMs + apiMs,
})

export const pushRecent = <T>(list: readonly T[], item: T, limit = 10): T[] => [...list, item].slice(-limit)

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)

  return v.length % 2 === 1 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2
}

// ---- formatting ------------------------------------------------------------------------------

export const fmtTok = (n: number): string => {
  if (n >= 1_000_000) return trimZero((n / 1_000_000).toFixed(1)) + 'M'
  if (n >= 10_000) return Math.round(n / 1000) + 'k'
  if (n >= 1000) return trimZero((n / 1000).toFixed(1)) + 'k'

  return String(Math.round(n))
}

const trimZero = (s: string): string => (s.endsWith('.0') ? s.slice(0, -2) : s)

export const fmtSecs = (s: number): string => {
  if (s < 1) return Math.round(s * 1000) + 'ms'

  return s < 100 ? s.toFixed(1) + 's' : Math.round(s) + 's'
}

export const fmtMs = (ms: number): string => (ms < 10 ? ms.toFixed(1) : String(Math.round(ms))) + 'ms'

export const fmtTps = (n: number): string => (n < 10 ? n.toFixed(1) : String(Math.round(n))) + ' tok/s'

export const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number): string => String(n).padStart(2, '0')

  if (s >= 3600) return Math.floor(s / 3600) + 'h' + pad(Math.floor((s % 3600) / 60)) + 'm'
  if (s >= 60) return Math.floor(s / 60) + 'm' + pad(s % 60) + 's'

  return s + 's'
}

export const fmtUsd = (usd: number): string => '$' + (usd >= 100 ? usd.toFixed(0) : usd >= 1 ? usd.toFixed(2) : usd.toFixed(4))

const ACRONYMS = new Set(['gpt', 'glm', 'llm', 'api'])

const capital = (w: string): string => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))

/**
 * `example-provider/claude-sonnet-5-5` becomes `Sonnet 5.5`, `gpt-6.2-sol[1m]` becomes `GPT-6.2 Sol`; the provider
 * and a `[1m]` window suffix are dropped, and a name of another shape is shown as it came.
 */
export const modelLabel = (model: string): string => {
  const bare = (model.includes('/') ? (model.split('/').pop() as string) : model).replace(/\[[^\]]*\]$/, '')
  const c = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(bare)

  if (c) return capital(c[1] as string) + ' ' + c[2] + '.' + c[3]

  const g = /^([a-z]+)-(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(bare)

  if (g) return capital(g[1] as string) + '-' + g[2] + (g[3] ? ' ' + g[3].split('-').map(capital).join(' ') : '')

  return bare.replace(/^claude-/, '')
}

export const EFFORT_GLYPH: Record<string, string> = { low: '○', medium: '◔', high: '◑', xhigh: '◕', max: '●' }

export const effortLabel = (effort: string | number | undefined): string => {
  if (effort === undefined) return ''
  if (typeof effort === 'number') return String(effort)

  return (EFFORT_GLYPH[effort] ?? '') + ' ' + effort
}

export const baseName = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? path

/** The theme key of a value's state, the way the cockpit mods name it: green, amber or red. */
export type Tone = 'success' | 'warning' | 'error'

export const toneOf = (percent: number, warnAt = 60, errorAt = 85): Tone =>
  percent >= errorAt ? 'error' : percent >= warnAt ? 'warning' : 'success'

/** A heavy stroke up to a knob, a light stroke after it. */
export const gauge = (percent: number, width: number): { fill: string; rest: string } => {
  const at = Math.round((Math.min(100, Math.max(0, percent)) / 100) * (width - 1))

  return { fill: '━'.repeat(at) + '●', rest: '─'.repeat(width - 1 - at) }
}

export type GitInfo = {
  branch: string
  changed: number
  added: number
  removed: number
  ahead: number
  behind: number
  subject: string
  age: string
}

/**
 * `git status --porcelain=v1 --branch`, `git diff --shortstat HEAD` and `git log -1 --format=%s%x09%cr`,
 * read the way the git-band mod reads them. Null when the status is not a repository's.
 */
export const parseGitInfo = (status: string, stat: string, log: string): GitInfo | null => {
  const [head = '', ...changes] = status.split('\n').filter(l => l !== '')
  const m = /^## (?:No commits yet on |Initial commit on )?([^.\s]+)/.exec(head)

  if (!m) return null

  const [subject = '', age = ''] = log.trim().split('\t')

  return {
    branch: m[1] as string,
    changed: changes.length,
    added: Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0),
    removed: Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0),
    ahead: Number(/ahead (\d+)/.exec(head)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(head)?.[1] ?? 0),
    subject: subject.slice(0, 48),
    age,
  }
}

export const toolTarget = (e: Record<string, unknown>): string => {
  const pick = (k: string): string => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const cmd = pick('command')

  if (cmd) return cmd.length > 28 ? cmd.slice(0, 28) + '…' : cmd

  const path = pick('file_path') || pick('path') || pick('notebook_path')

  if (path) return baseName(path)

  return pick('pattern') || pick('skill') || ''
}

/** `mcp__server__tool` becomes `server:tool`. */
export const foldTool = (name: string): string => {
  if (!name.startsWith('mcp__')) return name
  const rest = name.slice(5).split('__')

  return rest.length >= 2 ? rest[0] + ':' + rest.slice(1).join('__') : (rest[0] as string)
}

// ---- session usage ---------------------------------------------------------------------------

export type MeasureInput = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number }[]
  cost?: { usd: number }
  promptCache?: { isWarm: boolean; expiresAt?: number; ttl: string }
}

export type MeasureState = {
  startedAt: number
  tokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  limits: { kind: string; percentUsed: number }[]
  cache: { isWarm: boolean; expiresAt: number | null; ttl: string } | null
}

export const toMeasure = (m: MeasureInput, startedAt: number): MeasureState => ({
  startedAt,
  tokens: m.context.tokens ?? null,
  window: m.context.window,
  percent: m.context.percent ?? null,
  costUsd: m.cost?.usd ?? null,
  limits: m.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed })),
  cache: m.promptCache
    ? { isWarm: m.promptCache.isWarm, expiresAt: m.promptCache.expiresAt ?? null, ttl: m.promptCache.ttl }
    : null,
})

const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export const limitLabel = (kind: string): string => LIMIT_LABEL[kind] ?? kind

/** Seconds a warm prompt cache has left; 0 when cold or unknown. */
export const cacheLeftMs = (c: MeasureState['cache'], now: number): number =>
  c !== null && c.isWarm && c.expiresAt !== null ? Math.max(0, c.expiresAt - now) : 0

export const ttlMs = (ttl: string): number => (ttl === '1h' ? 3_600_000 : 300_000)

// ---- tool calls ------------------------------------------------------------------------------

export type CallStatus = 'running' | 'ok' | 'error' | 'denied'

export type CallEntry = {
  id: number
  toolUseId?: string
  name: string
  target: string
  agentId: string | null
  at: number
  /** Milliseconds the call took; null when not measured. */
  ms: number | null
  status: CallStatus | 'unknown'
}

export const CALL_LIMIT = 80

export const startCall = (log: readonly CallEntry[], entry: CallEntry): CallEntry[] => [...log, entry].slice(-CALL_LIMIT)

export const finishCall = (log: readonly CallEntry[], id: number, status: CallStatus, ms: number): CallEntry[] =>
  log.map(c => (c.id === id ? { ...c, status, ms } : c))

export const countOf = (counts: Record<string, number>, name: string): Record<string, number> => ({
  ...counts,
  [name]: (counts[name] ?? 0) + 1,
})

/** Where the result of a tool call tells it failed or was refused. */
export const callStatusOf = (result: unknown): CallStatus => {
  if (result === null || typeof result !== 'object') return 'ok'

  const r = result as { deny?: unknown; isError?: unknown }

  if (typeof r.deny === 'string') return 'denied'

  return r.isError === true ? 'error' : 'ok'
}

// ---- files -----------------------------------------------------------------------------------

export type FileEntry = { path: string; r: number; w: number; at: number }

export const FILE_LIMIT = 60

const READ_TOOLS = new Set(['Read', 'NotebookRead'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** The file a call touches and how, or null for tools that name no file. */
export const fileOf = (name: string, e: Record<string, unknown>): { path: string; kind: 'r' | 'w' } | null => {
  const pick = (k: string): string => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const path = pick('file_path') || pick('notebook_path') || pick('path')

  if (path === '') return null
  if (READ_TOOLS.has(name)) return { path, kind: 'r' }
  if (WRITE_TOOLS.has(name)) return { path, kind: 'w' }

  return null
}

/** The touched file moves to the end, so the list stays in the order of last touch. */
export const touchFile = (files: readonly FileEntry[], path: string, kind: 'r' | 'w', at: number): FileEntry[] => {
  const prev = files.find(f => f.path === path)
  const next: FileEntry = {
    path,
    r: (prev?.r ?? 0) + (kind === 'r' ? 1 : 0),
    w: (prev?.w ?? 0) + (kind === 'w' ? 1 : 0),
    at,
  }

  return [...files.filter(f => f.path !== path), next].slice(-FILE_LIMIT)
}

/** The last two directories and the name: `hooks/core.ts` becomes `status-band/hooks/core.ts`. */
export const shortPath = (path: string, keep = 3): string => path.split('/').filter(Boolean).slice(-keep).join('/')

// ---- permission gate -------------------------------------------------------------------------

export type Decision = 'allow' | 'ask' | 'deny'

export type GateEntry = { tool: string; target: string; decision: Decision; agentId: string | null; at: number }

export type GateState = { allow: number; ask: number; deny: number; recent: GateEntry[] }

export const EMPTY_GATE: GateState = { allow: 0, ask: 0, deny: 0, recent: [] }

export const GATE_LIMIT = 24

export const recordGate = (g: GateState, entry: GateEntry): GateState => ({
  allow: g.allow + (entry.decision === 'allow' ? 1 : 0),
  ask: g.ask + (entry.decision === 'ask' ? 1 : 0),
  deny: g.deny + (entry.decision === 'deny' ? 1 : 0),
  recent: [...g.recent, entry].slice(-GATE_LIMIT),
})

// ---- todos -----------------------------------------------------------------------------------

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

const asStatus = (v: unknown): Todo['status'] =>
  v === 'completed' || v === 'complete' || v === 'done' ? 'completed' : v === 'in_progress' || v === 'running' ? 'in_progress' : 'pending'

/** TodoWrite replaces the list; TaskCreate appends; TaskUpdate sets the status of one entry (ids count from 1). */
export const applyTodoCall = (todos: readonly Todo[], name: string, input: Record<string, unknown>): Todo[] => {
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    return (input.todos as unknown[])
      .filter((t): t is Record<string, unknown> => t !== null && typeof t === 'object')
      .map(t => ({ content: String(t.content ?? ''), status: asStatus(t.status) }))
  }
  if (name === 'TaskCreate') {
    const content = String(input.subject ?? input.description ?? 'task')

    return [...todos, { content, status: asStatus(input.status) }]
  }
  if (name === 'TaskUpdate') {
    const idx = Number(input.taskId) - 1

    if (Number.isInteger(idx) && idx >= 0 && idx < todos.length && typeof input.status === 'string') {
      return todos.map((t, i) => (i === idx ? { ...t, status: asStatus(input.status) } : t))
    }
  }

  return [...todos]
}

// ---- session state ---------------------------------------------------------------------------

export type StateName = 'busy' | 'waiting' | 'idle'

export type SessionStatus = { state: StateName; waitingFor: string | null; since: number }

export const STATE_WORD: Record<StateName, string> = { busy: 'RUNNING', waiting: 'WAITING', idle: 'IDLE' }

export const fmtAgo = (ms: number): string => fmtDur(Math.max(0, ms))

export type Receipt = { durationMs: number; tools: number; errors: number }

// ---- agents ----------------------------------------------------------------------------------

export type AgentTrack = {
  turnId: string | null
  steps: number
  /** Input side of the latest request: uncached, cache read and cache write together. */
  ctx: number
  current: { name: string; target: string } | null
  recent: { name: string; target: string; status: CallStatus }[]
}

export const EMPTY_TRACK: AgentTrack = { turnId: null, steps: 0, ctx: 0, current: null, recent: [] }

export const RECENT_PER_AGENT = 3

export type AgentInfoRow = {
  id: string
  type: string
  label: string
  status: string
  model: string | null
  startTime: number
}

export const AGENT_GLYPH: Record<string, string> = {
  running: '◐',
  pending: '◌',
  waiting: '◔',
  idle: '○',
  completed: '✓',
  failed: '✗',
  killed: '⊘',
}

export const isLive = (status: string): boolean => status === 'running' || status === 'pending' || status === 'waiting'

export const agentSummary = (list: readonly AgentInfoRow[]): { live: number; done: number; failed: number } => ({
  live: list.filter(a => isLive(a.status)).length,
  done: list.filter(a => a.status === 'completed' || a.status === 'idle').length,
  failed: list.filter(a => a.status === 'failed' || a.status === 'killed').length,
})

/** 12:03:41 from epoch milliseconds, in the machine's time zone. */
export const fmtClock = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')

  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

// ---- rows, order and look --------------------------------------------------------------------

export type RowId = 'state' | 'context' | 'tokens' | 'speed' | 'agents' | 'tools' | 'files' | 'gate' | 'todo' | 'git'

/** Top to bottom as shipped. git sits last. */
export const DEFAULT_ORDER: readonly RowId[] = ['state', 'context', 'tokens', 'speed', 'agents', 'tools', 'files', 'gate', 'todo', 'git']

export const isRowId = (v: unknown): v is RowId => typeof v === 'string' && (DEFAULT_ORDER as readonly string[]).includes(v)

/** Names the person types may differ a little from the row ids. */
const ALIASES: Record<string, RowId> = { session: 'state', status: 'state', info: 'state', ctx: 'context', cache: 'tokens', agent: 'agents', tool: 'tools', file: 'files', permission: 'gate', todos: 'todo' }

export const parseRowId = (v: string): RowId | null => {
  const k = v.trim().toLowerCase()

  return isRowId(k) ? k : (ALIASES[k] ?? null)
}

/** The listed rows first, in the order given; the rest after them in the shipped order. */
export const orderFrom = (first: readonly RowId[]): RowId[] => {
  const head = first.filter((id, i) => first.indexOf(id) === i)

  return [...head, ...DEFAULT_ORDER.filter(id => !head.includes(id))]
}

// Colours are Claude Code's own theme keys, as the cockpit mods use them, so the band follows the theme
// (dark, light, colour-blind) and sits beside the other bands without a colour of its own. Cockpit gives
// one hue to each subject: purple for git, orange for the session, blue for the project, teal for the
// day. The rows here are spread over those four hues so that two neighbours in the shipped order never
// share one. Green, amber and red are kept for the state of a value.
export const ROW_HUE: Record<RowId, string> = {
  state: 'suggestion',
  context: 'claude',
  tokens: 'suggestion',
  speed: 'remember',
  agents: 'merged',
  tools: 'claude',
  files: 'suggestion',
  gate: 'remember',
  todo: 'claude',
  git: 'merged',
}

/** Only the status value takes the colour of the state itself. */
export const STATE_HUE: Record<StateName, string> = { busy: 'success', waiting: 'warning', idle: 'inactive' }

// ---- preferences -----------------------------------------------------------------------------

export type OpenKey = 'tools' | 'files' | 'gate' | 'agents'

export type Prefs = {
  hidden: boolean
  /** Desktop notification when Claude waits for the person, and when a long turn ends. */
  notify: boolean
  open: Record<OpenKey, boolean>
  /** Agents whose last calls are shown under their line. */
  agentOpen: string[]
  order: RowId[]
  hiddenRows: RowId[]
}

export const DEFAULT_PREFS: Prefs = {
  hidden: false,
  notify: false,
  open: { tools: false, files: false, gate: false, agents: false },
  agentOpen: [],
  order: [...DEFAULT_ORDER],
  hiddenRows: [],
}

export const OPEN_KEYS: readonly OpenKey[] = ['tools', 'files', 'gate', 'agents']

/** A stored value may be older or hand-edited: keep only what has the right shape. */
export const readPrefs = (raw: unknown): Prefs => {
  if (raw === null || typeof raw !== 'object') return DEFAULT_PREFS

  const r = raw as Partial<Record<keyof Prefs, unknown>> & { open?: Partial<Record<OpenKey, unknown>> }
  const open = { ...DEFAULT_PREFS.open }

  for (const k of OPEN_KEYS) if (typeof r.open?.[k] === 'boolean') open[k] = r.open[k] as boolean

  const ids = (v: unknown): RowId[] => (Array.isArray(v) ? v.filter(isRowId) : [])

  return {
    hidden: r.hidden === true,
    notify: r.notify === true,
    open,
    agentOpen: Array.isArray(r.agentOpen) ? r.agentOpen.filter((x): x is string => typeof x === 'string').slice(-20) : [],
    order: orderFrom(ids(r.order)),
    hiddenRows: ids(r.hiddenRows),
  }
}

export const toggleOpen = (p: Prefs, k: OpenKey): Prefs => ({ ...p, open: { ...p.open, [k]: !p.open[k] } })

export const toggleAgent = (p: Prefs, id: string): Prefs => ({
  ...p,
  agentOpen: p.agentOpen.includes(id) ? p.agentOpen.filter(x => x !== id) : [...p.agentOpen, id].slice(-20),
})

export const setAllOpen = (p: Prefs, isOpen: boolean): Prefs => ({
  ...p,
  open: { tools: isOpen, files: isOpen, gate: isOpen, agents: isOpen },
})

/** Rows in the order they draw: the saved order, minus the rows the person hid. */
export const visibleOrder = (p: Prefs): RowId[] => p.order.filter(id => !p.hiddenRows.includes(id))

export type Identity = {
  model: string
  effort: string | number | null
  cwd: string
  /** The project root, when it is not the working directory. */
  root: string
  version: string
  customTitle: string
  aiTitle: string
  recap: string
  /** Whether requests carry a thinking setting other than off. */
  thinking: boolean
  /** How long the API keeps the prompt cache after a request, as the requests ask for it; empty when unknown. */
  cacheTtl: string
}

export type PerfState = { last: StepStats | null; recent: StepStats[] }

export const patchTrack = (
  t: Record<string, AgentTrack>,
  id: string,
  f: (a: AgentTrack) => AgentTrack,
): Record<string, AgentTrack> => ({ ...t, [id]: f(t[id] ?? EMPTY_TRACK) })

// ---- lines changed by edits ------------------------------------------------------------------

export type LinesChanged = { added: number; removed: number }

/**
 * The lines an Edit or a Write changed, read from the diff the tool returned: `+` and `-` lines of each hunk,
 * or the whole content of a file that was created. Null when the result holds neither.
 */
export const patchLines = (result: unknown): LinesChanged | null => {
  if (result === null || typeof result !== 'object') return null

  const r = result as { structuredPatch?: unknown; type?: unknown; content?: unknown }

  if (Array.isArray(r.structuredPatch) && r.structuredPatch.length > 0) {
    let added = 0
    let removed = 0

    for (const h of r.structuredPatch as { lines?: unknown }[]) {
      if (!Array.isArray(h?.lines)) continue
      for (const l of h.lines) {
        if (typeof l !== 'string') continue
        if (l.startsWith('+')) added += 1
        else if (l.startsWith('-')) removed += 1
      }
    }

    return { added, removed }
  }
  if (r.type === 'create' && typeof r.content === 'string') {
    return { added: r.content === '' ? 0 : r.content.replace(/\n$/, '').split('\n').length, removed: 0 }
  }

  return null
}

// ---- reading what a session already did ------------------------------------------------------

/** One request as the transcript tells it: when it went out, and what its first and last content blocks were. */
export type ScanRequest = {
  t0: number
  model: string
  firstIdx: number
  firstAt: number
  firstKind: string
  firstLead: number | null
  lastIdx: number
  lastAt: number
  stop: boolean
  usage: Usage
}

/** The settings of the newest request: what the status line used to be handed by Claude Code. */
export type ScanMeta = { at: number; effort: string; thinking: boolean | null; cacheTtl: string }

/** What a pass over the session's transcript has found so far. */
export type ScanAcc = {
  carry: string
  msgs: Set<string>
  tools: Set<string>
  usage: Usage
  reqs: number
  counts: Record<string, number>
  calls: CallEntry[]
  /** When the last assistant record was written, in epoch milliseconds. */
  lastAt: number
  customTitle: string
  aiTitle: string
  recap: string
  requests: Map<string, ScanRequest>
  meta: ScanMeta
}

export const newScan = (): ScanAcc => ({
  carry: '',
  msgs: new Set(),
  tools: new Set(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reqs: 0,
  counts: {},
  calls: [],
  lastAt: 0,
  customTitle: '',
  aiTitle: '',
  recap: '',
  requests: new Map(),
  meta: { at: 0, effort: '', thinking: null, cacheTtl: '' },
})

const num0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Takes the next piece of the transcript, a JSON line at a time. A line cut by the end of the piece is kept
 * for the next one. A message is counted once however many of its content blocks the file holds, a tool
 * call once by its id, and a line that does not parse is skipped. `api-request` lines give each request's
 * start and the settings it went out with; the assistant lines that name it by `requestRef` give its blocks.
 */
export const scanChunk = (acc: ScanAcc, text: string, isLast: boolean, history = true): void => {
  const lines = (acc.carry + text).split('\n')

  acc.carry = isLast ? '' : (lines.pop() ?? '')

  for (const raw of lines) {
    const isUsage = raw.includes('"usage"')
    const isTitle = raw.includes('-title"')
    const isRequest = raw.includes('"api-request"')

    const isRecap = raw.includes('"away_summary"')
    const isCall = history && raw.includes('"tool_use"')
    const isResult = history && raw.includes('"tool_result"')

    if (!isUsage && !isTitle && !isRequest && !isRecap && !isCall && !isResult) continue

    let o: Record<string, unknown>

    try {
      o = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }

    if (o.isSidechain === true) continue
    if (o.type === 'ai-title' && typeof o.aiTitle === 'string') acc.aiTitle = oneLine(o.aiTitle)
    if (o.type === 'custom-title' && typeof o.customTitle === 'string') acc.customTitle = oneLine(o.customTitle)
    if (o.type === 'system' && o.subtype === 'away_summary' && typeof o.content === 'string') {
      const recap = oneLine(o.content).replace(/\s*\(turn off recaps in \/config\)$/, '').trim()
      if (recap !== '') acc.recap = recap
    }
    if (o.type === 'api-request') {
      scanRequest(acc, o)
      continue
    }
    if (o.type === 'user' && isResult) {
      const content = (o.message as { content?: unknown } | undefined)?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
          const call = acc.calls.find(c => c.toolUseId === block.tool_use_id)
          if (call !== undefined) call.status = block.is_error === true ? 'error' : 'ok'
        }
      }
      continue
    }
    if (o.type !== 'assistant') continue

    const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN

    if (Number.isFinite(at) && at > acc.lastAt) acc.lastAt = at

    const msg = o.message as { id?: unknown; usage?: Record<string, unknown>; content?: unknown; stop_reason?: unknown } | undefined

    if (msg === undefined || msg === null) continue
    if (typeof msg.id === 'string' && !acc.msgs.has(msg.id) && msg.usage !== undefined) {
      acc.msgs.add(msg.id)
      acc.usage.input += Number(msg.usage.input_tokens) || 0
      acc.usage.output += Number(msg.usage.output_tokens) || 0
      acc.usage.cacheRead += Number(msg.usage.cache_read_input_tokens) || 0
      acc.usage.cacheWrite += Number(msg.usage.cache_creation_input_tokens) || 0
      acc.reqs += 1
    }
    if (Array.isArray(msg.content)) {
      for (const c of msg.content as { type?: unknown; id?: unknown; name?: unknown; input?: unknown }[]) {
        if (c?.type === 'tool_use' && typeof c.id === 'string' && typeof c.name === 'string' && !acc.tools.has(c.id)) {
          acc.tools.add(c.id)
          acc.counts[c.name] = (acc.counts[c.name] ?? 0) + 1
          if (history) {
            const input = c.input !== null && typeof c.input === 'object' ? c.input as Record<string, unknown> : {}
            acc.calls = startCall(acc.calls, {
              id: -acc.tools.size,
              toolUseId: c.id,
              name: c.name,
              target: oneLine(toolTarget(input)),
              agentId: null,
              at: Number.isFinite(at) ? at : 0,
              ms: null,
              status: 'unknown',
            })
          }
        }
      }
    }
    if (typeof o.promptCacheRequested === 'string' && at >= acc.meta.at && o.promptCacheRequested !== '') acc.meta.cacheTtl = o.promptCacheRequested
    if (typeof o.requestRef === 'string' && Number.isFinite(at)) scanBlock(acc, o, msg, at)
  }
}

const scanRequest = (acc: ScanAcc, o: Record<string, unknown>): void => {
  const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
  const p = (o.params ?? {}) as { model?: unknown; thinking?: { type?: unknown }; output_config?: { effort?: unknown } }

  if (typeof o.id !== 'string' || !Number.isFinite(at)) return

  acc.requests.set(o.id, {
    t0: at,
    model: typeof p.model === 'string' ? p.model : '',
    firstIdx: Infinity,
    firstAt: 0,
    firstKind: '',
    firstLead: null,
    lastIdx: -1,
    lastAt: 0,
    stop: false,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  })
  if (at >= acc.meta.at) {
    const ttls = Array.isArray(o.cacheControl)
      ? (o.cacheControl as { value?: { ttl?: unknown } }[]).map(c => c?.value?.ttl).filter((t): t is string => typeof t === 'string')
      : []

    acc.meta = {
      at,
      effort: typeof p.output_config?.effort === 'string' ? p.output_config.effort : acc.meta.effort,
      thinking: typeof p.thinking?.type === 'string' ? p.thinking.type !== 'disabled' : acc.meta.thinking,
      cacheTtl: ttls.length > 0 ? (ttls[ttls.length - 1] as string) : acc.meta.cacheTtl,
    }
  }
}

const scanBlock = (acc: ScanAcc, o: Record<string, unknown>, msg: { usage?: Record<string, unknown>; content?: unknown; stop_reason?: unknown }, at: number): void => {
  const r = acc.requests.get(o.requestRef as string)

  if (r === undefined) return

  const idx = num0(o.apiBlockIndex)
  const content = Array.isArray(msg.content) ? (msg.content as { type?: unknown }[]) : []

  if (idx < r.firstIdx) {
    r.firstIdx = idx
    r.firstAt = at
    r.firstKind = typeof content[0]?.type === 'string' ? (content[0]?.type as string) : ''
    r.firstLead = typeof o.thinkingDurationMs === 'number' ? o.thinkingDurationMs : typeof o.toolInputStreamMs === 'number' ? o.toolInputStreamMs : null
  }
  if (idx >= r.lastIdx) {
    r.lastIdx = idx
    r.lastAt = at
    r.stop = typeof msg.stop_reason === 'string' && msg.stop_reason !== ''
    if (msg.usage !== undefined) {
      r.usage = {
        input: num0(msg.usage.input_tokens),
        output: num0(msg.usage.output_tokens),
        cacheRead: num0(msg.usage.cache_read_input_tokens),
        cacheWrite: num0(msg.usage.cache_creation_input_tokens),
      }
    }
  }
}

/**
 * The finished requests of the transcript, oldest first, as the figures the band measures live: how long
 * each took, when its first block began (when the block says how long it ran), its tokens per second over the
 * whole request. Decode speed cannot be told from timestamps, so `tps` and `tpot` stay empty. `apiMs` is the
 * time all of them took.
 */
export const requestStats = (acc: ScanAcc): { stats: StepStats[]; apiMs: number } => {
  const stats: StepStats[] = []
  let apiMs = 0

  for (const r of acc.requests.values()) {
    const e2e = (r.lastAt - r.t0) / 1000

    if (!r.stop || r.lastIdx < 0 || !(e2e > 0)) continue
    apiMs += e2e * 1000

    let ttft: number | null = null

    if (r.firstLead !== null && (r.firstKind === 'thinking' || r.firstKind === 'tool_use')) {
      const v = (r.firstAt - r.firstLead - r.t0) / 1000

      if (v >= 0 && v <= e2e) ttft = v
    }
    stats.push({
      at: r.lastAt,
      model: r.model,
      ttft,
      tpot: null,
      tps: null,
      tpsE2e: r.usage.output > 0 ? r.usage.output / e2e : null,
      e2e,
      usage: r.usage,
      note: 'from the transcript: decode speed is not in it',
      thinking: r.firstKind === 'thinking',
      contentChunks: 0,
      firstKind: r.firstKind,
    })
  }

  return { stats: stats.sort((x, y) => x.at - y.at), apiMs }
}

/** The name the person gave with /rename, or else the one Claude Code made up. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim()

export const titleOf = (s: Pick<Identity, 'customTitle' | 'aiTitle'>): string => s.customTitle || s.aiTitle

/** How much of the end of the transcript to read to refresh the title and the request settings. */
export const TAIL_BYTES = 524_288

/** The most a transcript may weigh for the whole of it to be read at the start. */
export const SEED_MAX_BYTES = 128 * 1024 * 1024

export const READ_CHUNK_BYTES = 4 * 1024 * 1024
