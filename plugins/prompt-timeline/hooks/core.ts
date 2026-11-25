type Row = { id: string; parent?: string; side: boolean; text: string; answer: boolean; tools: string[] }
export type Prompt = { id: string; text: string; replyId?: string }
type Position = { order: number; prompt: string }
export const rowKey = (id: string) => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ? id.slice(0, 24) : id

export function promptText(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return /^(?:\/\S|<(?:command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook|cross-session-message|agent-message|teammate-message)|\[Request interrupted by user)/.test(clean)
    ? '' : clean.slice(0, 160)
}

// Budget two cells for non-ASCII glyphs so mixed CJK labels never wrap.
export function preview(text: string, columns: number): string {
  const clean = text.replace(/[\p{Cc}\p{Bidi_Control}]/gu, '')
  let prefix = ''
  let beforeLast = ''
  let used = 0
  for (const char of clean) {
    const width = char <= '\x7e' ? 1 : 2
    if (used + width > columns) return columns <= 0 ? '' : `${used < columns ? prefix : beforeLast}…`
    beforeLast = prefix
    prefix += char
    used += width
  }
  return prefix
}

export function parseRow(line: string): Row | undefined {
  let row
  try { row = JSON.parse(line) } catch { return undefined }
  if (typeof row?.uuid !== 'string') return undefined
  const content = row.message?.content
  const blocks = Array.isArray(content) ? content : []
  const human = !row.isMeta && !row.isCompactSummary && !['peer', 'plugin', 'task-notification', 'auto-continuation'].includes(row.origin?.kind)
  const text = human && row.type === 'user' && !blocks.some(b => b?.type === 'tool_result')
    ? promptText(typeof content === 'string' ? content : blocks.flatMap(b => b?.type === 'text' && typeof b.text === 'string' ? [b.text] : []).join(' '))
    : ''
  const answer = row.type === 'assistant' && !row.isMeta && !row.isApiErrorMessage &&
    (typeof content === 'string' ? Boolean(content.trim()) : blocks.some(b => b?.type === 'text' && typeof b.text === 'string' && b.text.trim()))
  const tools = blocks.flatMap(b => b?.type === 'tool_use' && typeof b.id === 'string' ? [b.id] : [])
  return { id: row.uuid, parent: row.parentUuid ?? row.logicalParentUuid, side: row.isSidechain === true, text, answer, tools }
}

export function indexRows(history: Row[]) {
  const byId = new Map(history.map(row => [row.id, row]))
  const chain: Row[] = []
  const visited = new Set<string>()
  let node = history.findLast(row => !row.side)
  while (node && !visited.has(node.id)) {
    visited.add(node.id)
    if (!node.side) chain.push(node)
    node = node.parent ? byId.get(node.parent) : undefined
  }
  const prompts: Prompt[] = []
  const rows = new Map<string, Position>()
  let owner: Prompt | undefined
  chain.reverse().forEach((row, order) => {
    if (row.text) {
      owner = { id: row.id, text: row.text }
      prompts.push(owner)
    }
    if (owner) {
      if (row.answer) owner.replyId ??= row.id
      for (const id of [row.id, ...row.tools]) rows.set(rowKey(id), { order, prompt: owner.id })
    }
  })
  return { prompts, rows }
}

export function activePrompt(rows: Map<string, Position>, visible: Map<string, number>): string | undefined {
  let top: Position | undefined
  let clipped = false
  for (const [id, first] of visible) {
    const row = rows.get(id)
    if (!row) continue
    const cut = first > 0
    if (!top || (cut && !clipped) || (cut === clipped && row.order < top.order)) {
      top = row
      clipped = cut
    }
  }
  return top?.prompt
}
