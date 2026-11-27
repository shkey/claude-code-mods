// The plugin's contract with Claude Code: self-contained, no imports. The same shapes are written out in
// hooks/core.ts; change both together.

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Totals = Usage & { reqs: number; apiMs: number }

export type StepStats = {
  at: number
  model: string
  ttft: number | null
  tpot: number | null
  tps: number | null
  tpsE2e: number | null
  e2e: number
  usage: Usage
  note: string
  thinking: boolean
  contentChunks: number
  firstKind: string
}

export type PerfState = { last: StepStats | null; recent: StepStats[]; contextRecent: StepStats[]; contextEpoch: number }

export type MeasureState = {
  startedAt: number
  tokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  limits: { kind: string; percentUsed: number }[]
  cache: { isWarm: boolean; expiresAt: number | null; ttl: string } | null
}

export type Identity = { model: string; effort: string | number | null; cwd: string; root: string; version: string; customTitle: string; aiTitle: string; recap: string; thinking: boolean; cacheTtl: string }

export type LinesChanged = { added: number; removed: number }

export type GitHistory = { head: string; entries: string[]; more: boolean; loading: boolean; error: string }

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

export type SessionStatus = { state: 'busy' | 'waiting' | 'idle'; waitingFor: string | null; since: number }

export type Receipt = { durationMs: number; tools: number; errors: number }

export type CallEntry = {
  id: number
  toolUseId?: string
  name: string
  target: string
  agentId: string | null
  at: number
  ms: number | null
  status: 'running' | 'ok' | 'error' | 'denied' | 'unknown'
}

export type FileEntry = { path: string; r: number; w: number; at: number }

export type GateEntry = { tool: string; target: string; decision: 'allow' | 'ask' | 'deny'; agentId: string | null; at: number }

export type GateState = { allow: number; ask: number; deny: number; recent: GateEntry[] }

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

export type AgentInfoRow = { id: string; type: string; label: string; status: string; model: string | null; startTime: number }

export type AgentTrack = {
  turnId: string | null
  steps: number
  ctx: number
  current: { name: string; target: string } | null
  recent: { name: string; target: string; status: 'running' | 'ok' | 'error' | 'denied' }[]
}

export type RowId = 'state' | 'context' | 'tokens' | 'speed' | 'agents' | 'tools' | 'files' | 'gate' | 'todo' | 'git'

export type Prefs = {
  hidden: boolean
  notify: boolean
  open: { tools: boolean; files: boolean; gate: boolean; agents: boolean }
  agentOpen: string[]
  order: RowId[]
  hiddenRows: RowId[]
}

declare module 'claude-code' {
  interface PluginState {
    'status-band': {
      perf: PerfState
      main: Totals
      agents: Totals
      measure: MeasureState | null
      identity: Identity
      git: GitInfo | null
      gitHistory: GitHistory
      status: SessionStatus
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
      lastResponse: number
      now: number
    }
  }
}
