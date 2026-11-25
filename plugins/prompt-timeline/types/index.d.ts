export type View = { prompts: { id: string; text: string }[]; current: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-timeline': { view: View }
  }
}
