export type View = {
  prompts: { id: string; text: string; replies: { id: string; text: string }[]; tools: { id: string; name: string; target: string; owner: string }[] }[]
  current: string; expanded: string; kind: 'reply' | 'tool' | ''
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-timeline': { detailView: View }
  }
}
