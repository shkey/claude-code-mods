export type View = { prompts: { id: string; text: string; replies: { id: string; text: string }[] }[]; current: string; expanded: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-timeline': { replyView: View }
  }
}
