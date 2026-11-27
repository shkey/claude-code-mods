import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  CALL_LIMIT,
  DEFAULT_ORDER,
  DEFAULT_PREFS,
  EMPTY_GATE,
  EMPTY_TOTALS,
  READ_CHUNK_BYTES,
  SEED_MAX_BYTES,
  TAIL_BYTES,
  addUsage,
  applyTodoCall,
  callStatusOf,
  countOf,
  fileOf,
  finishCall,
  fmtDur,
  isLive,
  newScan,
  orderFrom,
  parseGitInfo,
  parseRowId,
  patchLines,
  patchTrack,
  pushRecent,
  readPrefs,
  recordGate,
  requestStats,
  scanChunk,
  setAllOpen,
  startCall,
  summarizeStep,
  toMeasure,
  toggleAgent,
  toggleOpen,
  toolTarget,
  touchFile,
} from './core'
import { stack } from './kit'
import { buildRows } from './view'

import type {
  AgentInfoRow,
  AgentTrack,
  CallEntry,
  CallStatus,
  FileEntry,
  GitInfo,
  GitHistory,
  Identity,
  LinesChanged,
  MeasureState,
  PerfState,
  Receipt,
  RowId,
  SessionStatus,
  StateName,
  StepSample,
  Todo,
} from './core'
import type { Actions, Snap } from './view'

// State lives in atoms: a `ui.render` hook that reads one is drawn again whenever it changes, so the band
// follows each event as it happens instead of polling. They are written here, in the hooks module itself,
// because the static scan only follows atoms it can see in this file.
const perf = atom({ plugin: 'status-band', key: 'perf' } as const, { last: null, recent: [], contextRecent: [], contextEpoch: 0 } as PerfState)
const main = atom({ plugin: 'status-band', key: 'main' } as const, EMPTY_TOTALS)
const agents = atom({ plugin: 'status-band', key: 'agents' } as const, EMPTY_TOTALS)
const measure = atom({ plugin: 'status-band', key: 'measure' } as const, null as MeasureState | null)
const identity = atom({ plugin: 'status-band', key: 'identity' } as const, { model: '', effort: null, cwd: '', root: '', version: '', customTitle: '', aiTitle: '', recap: '', thinking: false, cacheTtl: '' } as Identity)
const GIT_PANE = 'status-band-git'
const GIT_PAGE = 30
const gitHistory = atom({ plugin: 'status-band', key: 'gitHistoryStyledView' } as const,
  { head: '', entries: [], more: false, loading: false, error: '', selected: null } as GitHistory)
const git = atom({ plugin: 'status-band', key: 'git' } as const, null as GitInfo | null)
const status = atom(
  { plugin: 'status-band', key: 'status' } as const,
  { state: 'idle', waitingFor: null, since: 0 } as SessionStatus,
)
const receipt = atom({ plugin: 'status-band', key: 'receipt' } as const, null as Receipt | null)
const calls = atom({ plugin: 'status-band', key: 'calls' } as const, [] as CallEntry[])
const counts = atom({ plugin: 'status-band', key: 'counts' } as const, {} as Record<string, number>)
const files = atom({ plugin: 'status-band', key: 'files' } as const, [] as FileEntry[])
const gate = atom({ plugin: 'status-band', key: 'gate' } as const, EMPTY_GATE)
const todos = atom({ plugin: 'status-band', key: 'todos' } as const, [] as Todo[])
const agentList = atom({ plugin: 'status-band', key: 'agentList' } as const, [] as AgentInfoRow[])
const track = atom({ plugin: 'status-band', key: 'track' } as const, {} as Record<string, AgentTrack>)
const prefs = atom({ plugin: 'status-band', key: 'prefs' } as const, DEFAULT_PREFS)
const lines = atom({ plugin: 'status-band', key: 'lines' } as const, { added: 0, removed: 0 } as LinesChanged)
const lastResponse = atom({ plugin: 'status-band', key: 'lastResponse' } as const, 0)
const now = atom({ plugin: 'status-band', key: 'now' } as const, 0)

const MUTATING = new Set(['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// A turn's tool count and failures, for the receipt `turn.complete` writes.
let callSeq = 0
let turnTools = 0
let turnErrors = 0
let ticks = 0

// ---- refreshers: each takes `$`, none throws -------------------------------------------------

const run = async ($: EngineInterface, args: readonly string[]): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(['git', '--no-pager', ...args], { timeoutMs: 5000 })

    return ran.exitCode === 0 && !ran.isStdoutTruncated ? ran.stdout : undefined
  } catch {
    return undefined
  }
}

// Pin the history to a single HEAD so new commits do not shift page offsets.
const gitHash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const gitText = (text: string) => text.replace(/[\p{Cc}\p{Bidi_Control}]/gu, ' ')
// Fit mixed-width subjects before the host lays out a clickable row.
const gitPreview = (text: string, columns: number): string => {
  let out = '', beforeLast = '', used = 0
  for (const ch of text) {
    const width = ch <= '\x7e' ? 1 : 2
    if (used + width > columns) return columns <= 0 ? '' : `${used < columns ? out : beforeLast}…`
    beforeLast = out
    out += ch
    used += width
  }
  return out
}
let gitHistoryBusy = false
const loadGitHistory = async ($: EngineInterface, restart: boolean): Promise<void> => {
  if (gitHistoryBusy) return
  gitHistoryBusy = true
  try {
    const previous = await read($, gitHistory)
    if (!restart && !previous.more) return
    const base = restart ? { head: '', entries: [], more: false, loading: true, error: '', selected: null } : { ...previous, loading: true, error: '' }
    await update($, gitHistory, () => base)
    const head = restart ? (await run($, ['rev-parse', '--verify', 'HEAD']))?.trim() : base.head
    if (!head || !gitHash.test(head)) {
      await update($, gitHistory, () => ({ ...base, loading: false, error: 'No readable HEAD. Reopen history after the first commit.' }))
      return
    }
    const output = await run($, ['log', '--no-show-signature', '--no-notes', `--max-count=${GIT_PAGE + 1}`,
      `--skip=${base.entries.length}`, '--format=%H%x09%h%x09%as%x09%s', head, '--'])
    if (output === undefined) {
      await update($, gitHistory, () => ({ ...base, head, loading: false, error: 'Git log failed. Retry or reopen history.' }))
      return
    }
    const page = output.split('\n').filter(Boolean).flatMap(line => {
      const [hash, short, date, ...title] = line.split('\t')
      return hash && gitHash.test(hash) && short && date ? [{ hash, short: gitText(short), date: gitText(date), title: gitText(title.join(' ').trim()) }] : []
    })
    await update($, gitHistory, state => ({ ...state, head, entries: [...base.entries, ...page.slice(0, GIT_PAGE)],
      more: page.length > GIT_PAGE, loading: false, error: '' }))
  } finally {
    gitHistoryBusy = false
  }
}

let openingGitHistory = false
const openGitHistory = async ($: EngineInterface): Promise<void> => {
  if (openingGitHistory) return
  openingGitHistory = true
  try {
    const pane = (await $.ui.panes()).find(p => p.id === GIT_PANE)
    if (pane?.isShown) return
    const args = { id: GIT_PANE, title: 'Git history', columns: 54, rows: 14 } as const
    let opened = await $.ui.open(pane?.isPlaced ? { ...args, focus: true } : args)
    if (pane?.isPlaced && opened.isPlaced && !(await $.ui.panes()).some(p => p.id === GIT_PANE && p.isShown)) {
      // An existing background tab may be retitled without being raised.
      await $.ui.close({ id: GIT_PANE })
      opened = await $.ui.open(args)
    }
    if (!opened.isPlaced) {
      $.ui.toast(`Git history pane unavailable: ${opened.reason}`)
      return
    }
    if (!(await $.ui.panes()).some(p => p.id === GIT_PANE && p.isShown)) {
      $.ui.toast('Select the Git history tab to view commits.')
    }
    const history = await read($, gitHistory)
    if (!pane || (!history.head && !history.loading)) await loadGitHistory($, true)
  } finally {
    openingGitHistory = false
  }
}

let gitSelection = 0
const selectGitCommit = async ($: EngineInterface, hash: string): Promise<void> => {
  const selection = ++gitSelection
  const history = await read($, gitHistory)
  if (!history.entries.some(entry => entry.hash === hash)) return
  const closing = history.selected?.hash === hash && !history.selected.error
  await update($, gitHistory, state => ({ ...state, selected: closing ? null : { hash, fields: [], message: [], error: false } }))
  if (closing) return
  const output = await run($, ['show', '-s', '--no-show-signature', '--no-notes', '--no-patch',
    '--format=%H%x00%an%x00%aI%x00%cn%x00%cI%x00%P%x00%B', hash, '--'])
  const [id, author, authored, committer, committed, parents, body] = output?.split('\0') ?? []
  const ok = id === hash && body !== undefined
  const fields = ok ? [
    { label: 'Commit', value: hash, color: '#4b9ead' },
    { label: 'Author', value: author ?? '', color: '#4a9b62' },
    { label: 'Authored', value: authored ?? '', color: '#ba922c' },
    { label: 'Committer', value: committer ?? '', color: '#be6566' },
    { label: 'Committed', value: committed ?? '', color: '#c67a3d' },
    ...(parents ? parents.split(' ') : ['root commit']).map(value => ({ label: 'Parent', value, color: '#9e77c6' })),
  ].map(field => ({ ...field, value: gitText(field.value) })) : []
  const message = ok ? body.trimEnd().split('\n').map(gitText) : []
  await update($, gitHistory, state => gitSelection === selection && state.selected?.hash === hash
    ? { ...state, selected: { hash, fields, message, error: !ok } } : state)
}

const refreshGit = async ($: EngineInterface): Promise<void> => {
  try {
    const st = await run($, ['status', '--porcelain=v1', '--branch'])
    const info =
      st === undefined
        ? null
        : parseGitInfo(st, (await run($, ['diff', '--shortstat', 'HEAD'])) ?? '', (await run($, ['log', '-1', '--format=%s%x09%cr'])) ?? '')

    if (JSON.stringify(info) !== JSON.stringify(await read($, git))) await update($, git, () => info)
  } catch {}
}

const refreshAgents = async ($: EngineInterface): Promise<void> => {
  try {
    const list = (await $.agent.list()).slice(-12).map(a => ({
      id: a.id,
      type: a.type,
      label: a.label,
      status: a.status,
      model: a.model ?? null,
      startTime: a.startTime,
    }))

    if (JSON.stringify(list) !== JSON.stringify(await read($, agentList))) await update($, agentList, () => list)
  } catch {}
}

const loadPrefs = async ($: EngineInterface): Promise<void> => {
  try {
    const stored = await $.store.get('prefs')

    if (stored !== undefined) await update($, prefs, () => readPrefs(stored))
  } catch {}
}

const savePrefs = async ($: EngineInterface): Promise<void> => {
  try {
    await $.store.set('prefs', await read($, prefs))
  } catch {}
}

// Each answer is asked for on its own: one that is missing leaves the others as they are.
const attempt = async <T,>(ask: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await ask()
  } catch {
    return undefined
  }
}

const seed = async ($: EngineInterface): Promise<void> => {
  try {
    const usage = await $.session.usage()

    await update($, measure, () => toMeasure(usage, usage.startedAt))
  } catch {}

  const model = await attempt(() => $.session.model())
  const cwd = await attempt(() => $.session.cwd())
  const root = await attempt(() => $.session.root())
  const version = (await attempt(() => $.session.version()))?.version
  const t = await attempt(() => $.clock.now())

  try {
    await update($, identity, i => ({
      ...i,
      model: model ?? i.model,
      cwd: cwd ?? i.cwd,
      root: root ?? i.root,
      version: version ?? i.version,
    }))
    if (t !== undefined) await update($, now, () => t)
  } catch {}
}

// A session that was running before the mod loaded (installed, reloaded, resumed) has history the band did
// not see: the transcript has it. Read it once, in pieces, and start the totals, the tool counts, the last
// response time (for the cache countdown) and the session's name from it. Skipped when the band has already
// counted a request itself, so nothing is counted twice.
const seedFromTranscript = async ($: EngineInterface): Promise<void> => {
  try {
    if ((await read($, main)).reqs > 0) return

    const path = (await $.session.info()).transcriptPath
    if (path === '') return
    const { size } = await $.fs.stat(path)

    if (size > SEED_MAX_BYTES) return

    const acc = newScan()

    for (let offset = 0; offset < size; offset += READ_CHUNK_BYTES) {
      const length = Math.min(READ_CHUNK_BYTES, size - offset)

      scanChunk(acc, await $.fs.read(path, { offset, length }), offset + length >= size)
    }
    if ((await $.session.info()).transcriptPath !== path) return
    await update($, calls, live => {
      const ids = new Set(live.map(c => c.toolUseId))
      return [...acc.calls.filter(c => !ids.has(c.toolUseId)), ...live].slice(-CALL_LIMIT)
    })
    if ((await read($, main)).reqs > 0) return

    const { stats, contextRecent, apiMs } = requestStats(acc)

    await update($, main, t => ({ ...t, ...acc.usage, reqs: acc.reqs, apiMs }))
    await update($, counts, c => (Object.keys(c).length === 0 ? acc.counts : c))
    if (acc.lastAt > 0) await update($, lastResponse, v => Math.max(v, acc.lastAt))

    const newest = stats[stats.length - 1]

    await update($, perf, p => p.last !== null || p.contextEpoch !== 0 ? p : {
      ...p, last: newest ?? null, recent: stats.slice(-10), contextRecent, contextEpoch: acc.contextEpoch,
    })

    await update($, identity, i => ({
      ...i,
      effort: i.effort ?? (acc.meta.effort !== '' ? acc.meta.effort : null),
      thinking: acc.meta.thinking ?? i.thinking,
      cacheTtl: acc.meta.cacheTtl !== '' ? acc.meta.cacheTtl : i.cacheTtl,
    }))
  } catch {}
}

// Recaps and titles can be written while idle, with no turn event. Check for a changed transcript
// on the existing clock; never read an unchanged tail or overlap two tail refreshes.
let transcriptStamp: { path: string; size: number; mtimeMs: number } | undefined
let refreshingTranscript = false
const refreshFromTranscript = async ($: EngineInterface): Promise<void> => {
  if (refreshingTranscript) return
  refreshingTranscript = true
  try {
    const path = (await $.session.info()).transcriptPath
    const { size, mtimeMs } = path === '' ? { size: 0, mtimeMs: 0 } : await $.fs.stat(path)
    if (transcriptStamp?.path === path && transcriptStamp.size === size && transcriptStamp.mtimeMs === mtimeMs) return

    const replaced = transcriptStamp !== undefined && (transcriptStamp.path !== path || size < transcriptStamp.size)
    const initial = transcriptStamp === undefined || replaced
    const acc = newScan()
    // On resume, find titles older than the tail even when counters are already live.
    // Read newest chunks first; retaining a custom title takes precedence over an AI title.
    const floor = Math.max(0, size - (initial ? SEED_MAX_BYTES : TAIL_BYTES))
    let boundary = ''
    for (let end = size; end > floor;) {
      const offset = Math.max(floor, end - TAIL_BYTES)
      const text = await $.fs.read(path, { offset, length: end - offset })
      const split = offset > 0 ? text.indexOf('\n') : -1
      if (offset > 0 && split < 0) {
        boundary = (text + boundary).slice(0, TAIL_BYTES)
      } else {
        const part = newScan()
        scanChunk(part, text.slice(split + 1) + boundary, end !== size, false)
        acc.customTitle ||= part.customTitle
        acc.aiTitle ||= part.aiTitle
        acc.recap ||= part.recap
        if (acc.meta.at === 0) acc.meta = part.meta
        boundary = split < 0 ? '' : text.slice(0, split + 1)
      }
      if (acc.customTitle && acc.aiTitle && acc.recap) break
      end = offset
    }
    if ((await $.session.info()).transcriptPath !== path) return
    await update($, identity, i => {
      const customTitle = acc.customTitle || (replaced ? '' : i.customTitle)
      const aiTitle = acc.aiTitle || (replaced ? '' : i.aiTitle)
      const recap = acc.recap || (replaced ? '' : i.recap)
      const thinking = acc.meta.thinking ?? i.thinking
      const cacheTtl = acc.meta.cacheTtl || i.cacheTtl
      return customTitle === i.customTitle && aiTitle === i.aiTitle && recap === i.recap && thinking === i.thinking && cacheTtl === i.cacheTtl
        ? i
        : { ...i, customTitle, aiTitle, recap, thinking, cacheTtl }
    })
    transcriptStamp = { path, size, mtimeMs }
  } catch {} finally {
    refreshingTranscript = false
  }
}

// The few figures that change without an event: a turn's clock, an agent's clock, the cache countdown.
// A one-second timer moves `now` while something is running, and every fifth second for a warm cache.
const tick = async ($: EngineInterface): Promise<void> => {
  try {
    ticks += 1

    const st = await read($, status)
    const list = await read($, agentList)
    const m = await read($, measure)
    const anyLive = list.some(a => isLive(a.status))
    const isCacheTick = m !== null && m.cache !== null && m.cache.isWarm && ticks % 5 === 0

    if (st.state === 'busy' || anyLive || isCacheTick) {
      const t = await $.clock.now()

      await update($, now, () => t)
    }
    if (anyLive && ticks % 3 === 0) await refreshAgents($)
    if (ticks % 5 === 0) void refreshFromTranscript($)
  } catch {}
}

const notify = async ($: EngineInterface, text: string, key: string): Promise<void> => {
  try {
    if ((await read($, prefs)).notify) await $.ui.notify(text, { key })
  } catch {}
}

// Claude Code 2.1.332 has no event for "busy, idle or waiting for you", so the state is derived: a main turn
// that starts is busy, one that completes is idle, a permission check that answers `ask` and a running
// AskUserQuestion call are waiting, and the next request or tool call ends the wait.
const setState = async ($: EngineInterface, state: StateName, waitingFor: string | null): Promise<void> => {
  try {
    const cur = await read($, status)

    if (cur.state === state && cur.waitingFor === waitingFor) return

    const t = await $.clock.now()

    await update($, status, () => ({ state, waitingFor, since: t }))
    await update($, now, () => t)

    if (state === 'waiting') {
      await notify($, 'Claude needs you' + (waitingFor !== null ? ': ' + waitingFor : ''), 'status-band-wait')
    } else if (cur.state === 'waiting') {
      await $.ui.cancelNotify('status-band-wait')
    }
    if (cur.state === 'busy' && state === 'idle' && cur.since > 0 && t - cur.since > 60_000) {
      await notify($, 'Turn finished after ' + fmtDur(t - cur.since), 'status-band-done')
    }
  } catch {}
}

// ---- hooks -----------------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: 'status-band',
      description: 'Status band: hide, show, order, expand, collapse, notify, reset, debug, git',
      argumentHint: '[hide|show [row]|order [rows]|expand|collapse|notify on|off|reset|debug|git]',
      immediate: true,
    })
    await loadPrefs($)
    await seed($)
    void refreshFromTranscript($)
    void seedFromTranscript($)
    await refreshGit($)
    await refreshAgents($)
    $.clock.every(60_000, () => void refreshGit($))
    $.clock.every(1_000, () => void tick($))

    return started
  })

  // Times every model request. The hook only watches: it forwards each chunk and returns the result as
  // it came, and a failure in the bookkeeping is swallowed so it can never hold a request back.
  on('turn.step', async function* ($, e, next) {
    const sample: StepSample = {
      sentAt: performance.now(),
      endAt: 0,
      firstAt: 0,
      firstKind: '',
      lastContentAt: 0,
      contentChunks: 0,
      hasThinking: false,
    }
    const epoch = e.agentId === undefined ? await attempt(async () => (await read($, perf)).contextEpoch) : undefined
    if (e.agentId === undefined) void setState($, 'busy', null)

    const stream = next(e)
    let step = await stream.next()

    while (!step.done) {
      const chunk = step.value
      const kind = chunk.kind

      if (kind === 'text' || kind === 'thinking' || kind === 'tool' || kind === 'input') {
        const t = performance.now()

        if (sample.firstAt === 0) {
          sample.firstAt = t
          sample.firstKind = kind
        }
        sample.lastContentAt = t
        sample.contentChunks += 1
        if (kind === 'thinking') sample.hasThinking = true
      }
      yield chunk
      step = await stream.next()
    }

    // The generator's return value is the finished result.
    const result = step.value

    try {
      sample.endAt = performance.now()

      if (result.usage) {
        const u = result.usage
        const usage = {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens,
          cacheWrite: u.cache_creation_input_tokens,
        }
        const stats = summarizeStep(sample, usage, e.model, await $.clock.now())
        const agentId = e.agentId

        if (agentId === undefined) {
          await update($, perf, p => ({
            ...p, last: stats, recent: pushRecent(p.recent, stats),
            contextRecent: p.contextEpoch === epoch ? pushRecent(p.contextRecent, stats) : p.contextRecent,
          }))
          await update($, main, t => addUsage(t, usage, stats.e2e * 1000))
          await update($, lastResponse, () => stats.at)

          const cur = await read($, identity)
          const effort = e.effort ?? null

          if (cur.model !== e.model || cur.effort !== effort) {
            await update($, identity, i => ({ ...i, model: e.model, effort }))
          }
        } else {
          await update($, agents, t => addUsage(t, usage, stats.e2e * 1000))
          await update($, track, t =>
            patchTrack(t, agentId, a => ({ ...a, steps: a.steps + 1, ctx: usage.input + usage.cacheRead + usage.cacheWrite })),
          )
        }
      }
    } catch {}

    return result
  })

  on('session.compact', async ($, e, next) => {
    // This engine rejects empty messages at next(), before core can return this skip.
    if (e.messages.length === 0) return { skip: 'Not enough messages to compact.' }
    const result = await next(e)
    if (result.skip === undefined && e.agentId === undefined && e.trigger !== 'precompute') {
      try {
        await update($, measure, m => m === null ? m : { ...m, tokens: null, percent: null })
        await update($, perf, p => ({ ...p, contextRecent: [], contextEpoch: p.contextEpoch + 1 }))
      } catch {}
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    try {
      const prev = await read($, measure)

      await update($, measure, () => {
        const nextMeasure = toMeasure(e, prev?.startedAt ?? 0)
        return prev !== null && !e.changed.includes('context')
          ? { ...nextMeasure, tokens: prev.tokens, percent: prev.percent }
          : nextMeasure
      })
    } catch {}

    return next(e)
  })

  // The permission gate: what the checks decided. Only observes; the decision goes on as it came.
  on('tool.check', async ($, e, next) => {
    const decided = await next(e)

    if (decided.decision === 'ask') await setState($, 'waiting', 'permission prompt' + (e.agentId !== undefined ? ' (agent)' : ''))

    try {
      const at = await $.clock.now()
      const input = e.input !== null && typeof e.input === 'object' ? (e.input as Record<string, unknown>) : {}

      await update($, gate, g =>
        recordGate(g, { tool: String(e.tool), target: toolTarget(input), decision: decided.decision, agentId: e.agentId ?? null, at }),
      )
    } catch {}

    return decided
  }).catch(async ($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    callSeq += 1
    const id = callSeq
    const name = String(e.tool)
    const agentId = e.agentId ?? null
    const input = e as unknown as Record<string, unknown>
    const target = toolTarget(input)
    const t0 = performance.now()
    const isQuestion = name === 'AskUserQuestion'

    await setState($, isQuestion ? 'waiting' : 'busy', isQuestion ? 'question' : null)

    try {
      const at = await $.clock.now()

      await update($, calls, l => startCall(l, { id, toolUseId: e.tool_use_id, name, target, agentId, at, ms: null, status: 'running' }))
      if (agentId !== null) {
        await update($, track, t => patchTrack(t, agentId, a => ({ ...a, current: { name, target } })))
      } else {
        await update($, todos, l => applyTodoCall(l, name, input))
      }
    } catch {}

    let outcome: CallStatus = 'ok'
    let changed: LinesChanged | null = null

    try {
      const res = await next(e)

      outcome = callStatusOf(res)
      if (outcome === 'ok' && agentId === null) changed = patchLines((res as { result?: unknown }).result)

      return res
    } catch (err) {
      outcome = 'error'
      throw err
    } finally {
      try {
        const ms = performance.now() - t0
        const at = await $.clock.now()
        const touched = fileOf(name, input)

        await update($, calls, l => finishCall(l, id, outcome, ms))
        if (agentId === null) {
          await update($, counts, c => countOf(c, name))
          turnTools += 1
          if (outcome === 'error' || outcome === 'denied') turnErrors += 1
        } else {
          await update($, track, t =>
            patchTrack(t, agentId, a => ({
              ...a,
              current: null,
              recent: [...a.recent, { name, target, status: outcome }].slice(-3),
            })),
          )
        }
        if (changed !== null) {
          const delta: LinesChanged = changed

          await update($, lines, l => ({ added: l.added + delta.added, removed: l.removed + delta.removed }))
        }
        if (touched !== null && outcome === 'ok') await update($, files, f => touchFile(f, touched.path, touched.kind, at))
        if (MUTATING.has(name)) void refreshGit($)
        // The call ran, so whatever it waited for (a permission prompt, the answer to a question) is over.
        if ((await read($, status)).state === 'waiting') await setState($, 'busy', null)
      } catch {}
    }
    // A bookkeeping failure must never stop a tool: on any failure the call goes on as if the mod were absent.
  }).catch(async ($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    const agentId = e.agentId

    try {
      if (agentId === undefined) {
        turnTools = 0
        turnErrors = 0
        await setState($, 'busy', null)
      } else {
        await update($, track, t => patchTrack(t, agentId, a => ({ ...a, turnId: e.turnId, current: null })))
        void refreshAgents($)
      }
    } catch {}

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const agentId = e.agentId

    try {
      if (agentId === undefined) {
        await update($, receipt, () => ({ durationMs: e.durationMs, tools: turnTools, errors: turnErrors }))
        await setState($, 'idle', null)
        void refreshFromTranscript($)
      } else {
        await update($, track, t => patchTrack(t, agentId, a => ({ ...a, turnId: null, current: null })))
        void refreshAgents($)
      }
    } catch {}

    return done
  })

  on('command.run', { command: 'status-band' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(w => w !== '')
    const arg = words[0] ?? ''
    const value = words[1] ?? ''
    const rest = words.slice(1)

    if (arg === 'git') {
      await openGitHistory($)
      return {}
    }
    if (arg === 'hide' || arg === 'show') {
      // With a row name it hides or shows that row; alone it hides or shows the whole band.
      const id = value !== '' ? parseRowId(value) : null

      if (value !== '' && id === null) return { text: 'no row called ' + value + '. rows: ' + DEFAULT_ORDER.join(', ') }

      await update($, prefs, p =>
        id === null
          ? { ...p, hidden: arg === 'hide' }
          : { ...p, hiddenRows: arg === 'hide' ? [...p.hiddenRows.filter(x => x !== id), id] : p.hiddenRows.filter(x => x !== id) },
      )
      await savePrefs($)

      return { text: (id ?? 'band') + (arg === 'hide' ? ' hidden' : ' shown') }
    }
    if (arg === 'order') {
      if (value === 'reset' || rest.length === 0) {
        const p = await read($, prefs)

        if (value !== 'reset') return { text: 'order: ' + p.order.join(' ') + (p.hiddenRows.length > 0 ? '  (hidden: ' + p.hiddenRows.join(' ') + ')' : '') }

        await update($, prefs, q => ({ ...q, order: [...DEFAULT_ORDER] }))
        await savePrefs($)

        return { text: 'order reset: ' + DEFAULT_ORDER.join(' ') }
      }

      const ids = rest.map(parseRowId)
      const bad = rest.filter((_w, i) => ids[i] === null)

      if (bad.length > 0) return { text: 'no row called ' + bad.join(', ') + '. rows: ' + DEFAULT_ORDER.join(', ') }

      const order = orderFrom(ids.filter((x): x is RowId => x !== null))

      await update($, prefs, q => ({ ...q, order }))
      await savePrefs($)

      return { text: 'order: ' + order.join(' ') }
    }
    if (arg === 'expand' || arg === 'collapse') {
      await update($, prefs, p => setAllOpen(p, arg === 'expand'))
      await savePrefs($)

      return { text: 'sections ' + (arg === 'expand' ? 'expanded' : 'collapsed') }
    }
    if (arg === 'notify') {
      const isOn = value !== 'off'

      await update($, prefs, p => ({ ...p, notify: isOn }))
      await savePrefs($)

      return { text: 'notifications ' + (isOn ? 'on: waiting for you, and turns over a minute' : 'off') }
    }
    if (arg === 'reset') {
      await update($, perf, p => ({ ...p, last: null, recent: [], contextRecent: [] }))
      await update($, main, () => EMPTY_TOTALS)
      await update($, agents, () => EMPTY_TOTALS)
      await update($, calls, () => [])
      await update($, counts, () => ({}))
      await update($, files, () => [])
      await update($, gate, () => EMPTY_GATE)
      await update($, todos, () => [])
      await update($, track, () => ({}))
      await update($, receipt, () => null)
      await update($, lines, () => ({ added: 0, removed: 0 }))

      return { text: 'counters reset' }
    }
    if (arg === 'debug') {
      const p = await read($, perf)
      const l = p.last

      if (l === null) return { text: 'no request seen yet' }

      return {
        text:
          'first chunk ' + l.firstKind + ', ' + l.contentChunks + ' content chunks, ttft ' + (l.ttft ?? 'n/a') +
          's, e2e ' + l.e2e.toFixed(2) + 's, out ' + l.usage.output + ' tok, tps(decode) ' + (l.tps ?? 'n/a') +
          ', tps(e2e) ' + (l.tpsE2e ?? 'n/a') + (l.note !== '' ? ', decode skipped: ' + l.note : '') + ', recent ' + p.recent.length,
      }
    }

    return { text: 'usage: /status-band hide|show [row] · order [rows…|reset] · expand|collapse · notify on|off · reset · debug · git' }
  })

  on('ui.render', { component: 'Pane', requestId: GIT_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const history = await read($, gitHistory)
    return <Box flexDirection="column">
      {history.head ? <Text wrap="truncate-end"><Text color="#4a9b62">{history.entries.length} commits</Text><Text dimColor> · </Text><Text color="#4b9ead">{history.head.slice(0, 7)}</Text></Text> : <Text>Git history</Text>}
      {history.entries.map(entry => {
        const selected = history.selected?.hash === entry.hash ? history.selected : null
        const prefix = `▸ ${entry.short} ${entry.date} `
        const title = gitPreview(entry.title, e.props.bodyColumns - prefix.length)
        return <Box key={entry.hash} flexDirection="column">
          <Button key={`git-commit:${entry.hash}`} plain onPress={() => selectGitCommit($, entry.hash)}>
            <Text wrap="truncate-end"><Text color="suggestion">{selected ? '▾ ' : '▸ '}</Text><Text color="#4b9ead">{entry.short}</Text><Text color="#ba922c"> {entry.date} </Text><Text bold={!!selected}>{title}</Text></Text>
          </Button>
          {selected && <Box flexDirection="column" paddingLeft={2}>
            {selected.error ? <Text color="error">Could not read commit. Click to retry.</Text>
              : selected.fields.length === 0 ? <Text dimColor>Loading commit…</Text>
              : <Box flexDirection="column">
                {selected.fields.map((field, i) => <Text key={`field-${i}`} wrap="wrap"><Text key={`field-label-${i}`} color={field.color}>{`${field.label}: `}</Text>{field.value}</Text>)}
                <Text color="#4e9c87" bold>Message</Text>
                {selected.message.map((line, i) => <Text key={`message-${i}`} wrap="wrap">{line || ' '}</Text>)}
              </Box>}
          </Box>}
        </Box>
      })}
      {history.loading && <Text dimColor>Loading commits…</Text>}
      {history.error && <Text color="error" wrap="truncate-end">{history.error}</Text>}
      {!history.loading && (history.more || history.error) && <Button key="git-history-more" plain
        label={history.error ? 'Retry' : 'Load older commits'} onPress={() => loadGitHistory($, !history.more)} />}
      {!history.loading && !history.more && !history.error && history.head && <Text dimColor>End of local history</Text>}
    </Box>
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)

    try {
      const p = await read($, prefs)

      if (e.props.hasSurvey || p.hidden) return below

      const ui = $.ui.resolve(e)
      const snap: Snap = {
        now: (await read($, now)) >= 0 ? await $.clock.now() : 0,
        columns: e.props.bodyColumns,
        viewAgent: e.props.view.agentId ?? null,
        status: await read($, status),
        identity: await read($, identity),
        git: await read($, git),
        measure: await read($, measure),
        perf: await read($, perf),
        main: await read($, main),
        agents: await read($, agents),
        receipt: await read($, receipt),
        calls: await read($, calls),
        counts: await read($, counts),
        files: await read($, files),
        gate: await read($, gate),
        todos: await read($, todos),
        agentList: await read($, agentList),
        track: await read($, track),
        lines: await read($, lines),
        lastResponse: await read($, lastResponse),
        prefs: p,
      }
      const act: Actions = {
        openGitHistory: () => openGitHistory($),
        toggle: key => update($, prefs, q => toggleOpen(q, key)).then(() => savePrefs($)),
        toggleAgent: id => update($, prefs, q => toggleAgent(q, id)).then(() => savePrefs($)),
        viewAgent: id => $.ui.view(id === null ? {} : { agentId: id }),
        stopAgent: async id => {
          const t = (await read($, track))[id]

          if (t?.turnId == null) return

          try {
            // Dismissing the question rejects; that is a no, not an error.
            const answer = await $.ui.ask('Stop this agent?', ['Stop', 'Keep running'])

            if (answer === 'Stop') await $.turn.abort({ turnId: t.turnId })
          } catch {}
        },
      }
      const rows = buildRows(ui, snap, act)

      return rows.length === 0 ? below : stack(ui, below, rows)
    } catch {
      return below
    }
  })
}
