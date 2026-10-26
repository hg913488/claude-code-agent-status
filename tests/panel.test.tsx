import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-status',
  component: 'Pane',
  requestId: 'agent-status',
  props: {
    title: 'Agent Status',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('main and a subagent show activity, model and progress', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'agent-status' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  let made = 0
  on('tool.call', (_, e) =>
    e.tool === 'TaskCreate' ? { result: { task: { id: String(++made), subject: 'x' } } } : { result: {} },
  )

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write hooks', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Test', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'look',
    description: 'find hooks',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })
  await $.tool.call({ tool: 'Read', file_path: '/x/register.tsx', agentId: 'a1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /1\/2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /EXPLORE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /haiku 5\.5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /reading register\.tsx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~\d+%/ })).toBeDefined()
    await ui.unmount()
  }
})
