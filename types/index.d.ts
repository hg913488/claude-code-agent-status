export type Task = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type Thread = {
  /** 'main', or the subagent's agentId */
  id: string
  label: string
  model?: string
  status: 'running' | 'idle' | 'done' | 'failed'
  activity: string
  startedAt: number
  endedAt?: number
  /** model requests this run, for the ~ estimate */
  steps: number
  tasks: Task[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-status': { threads: Shaped<Thread[]> }
  }
}
