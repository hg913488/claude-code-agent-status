import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Task, Thread } from '../types'

const PANE = 'agent-status'
const TITLE = 'Agent Status'
const MAIN = 'main'
// Change the tag when Thread's fields change: it declines what an earlier
// version stored, which outlives a reload.
const threads = atom({ plugin: 'agent-status', key: 'threads' } as const, [], {
  shape: 'threads-1',
})

const loopOf = (agentId?: string) => agentId ?? MAIN

const blank = (id: string, label: string, now: number): Thread => ({
  id,
  label,
  status: 'running',
  activity: 'starting',
  startedAt: now,
  steps: 0,
  tasks: [],
})

// Updates one thread, creating it first if no event has named it yet.
const patch = (
  $: EngineInterface,
  id: string,
  now: number,
  fn: (t: Thread) => Thread,
) =>
  update($, threads, list => {
    const found = list.find(t => t.id === id)
    const next = fn(found ?? blank(id, id === MAIN ? 'main' : 'agent', now))
    const rest = list.filter(t => t.id !== id)
    // Keep main plus the 12 most recent subagents.
    return [...rest, next].slice(-13)
  })

const base = (path: string) => path.split('/').pop() || path

const describe = (e: Record<string, unknown>): string => {
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  switch (e.tool) {
    case 'Read':
      return `reading ${base(s('file_path'))}`
    case 'Edit':
      return `editing ${base(s('file_path'))}`
    case 'Write':
      return `writing ${base(s('file_path'))}`
    case 'Bash':
      return s('description') || `running ${s('command')}`
    case 'Grep':
    case 'Glob':
      return `searching ${s('pattern')}`
    case 'WebSearch':
      return `searching web: ${s('query')}`
    case 'WebFetch':
      return `fetching ${s('url').replace(/^https?:\/\//, '')}`
    case 'Agent':
      return `delegating to ${s('subagent_type') || 'agent'}`
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'updating tasks'
    default:
      return String(e.tool)
  }
}

// claude-opus-5-5 → opus 5.5; aliases pass through.
const shortModel = (model?: string) => {
  if (!model) return '…'
  const m = model.match(/claude-([a-z]+)-(\d+)-(\d+)/)
  return m ? `${m[1]} ${m[2]}.${m[3]}` : model
}

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const clip = (text: string, width: number) =>
  text.length > width ? text.slice(0, Math.max(1, width - 1)) + '…' : text

// Progress from the task list when there is one, else a ~ guess from steps.
const progress = (t: Thread) => {
  if (t.tasks.length > 0) {
    const done = t.tasks.filter(k => k.status === 'completed').length
    return {
      fraction: done / t.tasks.length,
      value: `${done}/${t.tasks.length}`,
      unit: ' tasks',
    }
  }
  if (t.status === 'done') return { fraction: 1, value: '100%', unit: '' }
  const fraction = Math.min(0.9, 1 - Math.exp(-t.steps / 15))
  return { fraction, value: `~${Math.round(fraction * 100)}%`, unit: '' }
}

const bar = (fraction: number, width: number) => {
  const full = Math.round(fraction * width)
  return '▰'.repeat(full) + '▱'.repeat(width - full)
}

const applyTasks = (
  tasks: Task[],
  e: Record<string, unknown>,
  result: unknown,
): Task[] => {
  if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) {
    return (e.todos as { content: string; status: Task['status'] }[]).map(
      (todo, i) => ({ id: String(i), subject: todo.content, status: todo.status }),
    )
  }
  if (e.tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } })?.task?.id
    if (!id) return tasks
    return [...tasks, { id, subject: String(e.subject), status: 'pending' }]
  }
  if (e.tool === 'TaskUpdate') {
    const status = e.status as Task['status'] | 'deleted' | undefined
    if (status === 'deleted') return tasks.filter(k => k.id !== e.taskId)
    return tasks.map(k =>
      k.id === e.taskId
        ? {
            ...k,
            status: status ?? k.status,
            subject: typeof e.subject === 'string' ? e.subject : k.subject,
          }
        : k,
    )
  }
  return tasks
}

// The /mods switchboard turns this mod off in every chat with switches.json.
let off = false
async function readSwitch($: EngineInterface) {
  let nowOff = off
  try {
    const path = `${$.plugin.root.split('/.claude/')[0] ?? ''}/.claude/mods/switches.json`
    nowOff = (await $.fs.exists(path)) && (JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>)['agent-status'] === false
  } catch {
    // A broken file changes nothing.
  }
  if (nowOff === off) return
  off = nowOff
  $.ui.invalidate('ui.render')
}

const isTaskTool = (tool: string) =>
  tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-status',
      description: 'Show what the main thread and its subagents are doing',
    })
    await readSwitch($)
    $.clock.every(3000, () => void readSwitch($))
    // Elapsed times tick while something runs.
    $.clock.every(1000, async () => {
      if (off) return
      const list = await read($, threads)
      if (list.some(t => t.status === 'running')) $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  on('command.run', { command: 'agent-status' }, async $ => {
    if (off) return { text: 'Agent Status is off. Turn it on with /mods.' }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Agent Status panel opened.' }
  })

  on('turn.start', async ($, e, next) => {
    if (off) return next(e)
    const now = await $.clock.now()
    await patch($, loopOf(e.agentId), now, t => ({
      ...t,
      status: 'running',
      activity: 'thinking',
      startedAt: now,
      endedAt: undefined,
      steps: 0,
    }))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (off) return yield* next(e)
    const now = await $.clock.now()
    await patch($, loopOf(e.agentId), now, t => ({
      ...t,
      model: e.model,
      steps: t.steps + 1,
      activity: t.steps > 0 ? t.activity : 'thinking',
    }))

    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    if (off) return next(e)
    const started = await next(e)
    if (started.agentId) {
      const now = await $.clock.now()
      const label = e.name ?? e.subagentType
      await patch($, started.agentId, now, t => ({
        ...t,
        label,
        model: t.model ?? started.model,
        activity: t.activity === 'starting' ? e.description : t.activity,
      }))
    }

    return started
  })

  on('tool.call', async ($, e, next) => {
    if (off) return next(e)
    const id = loopOf(e.agentId)
    const fields = e as unknown as Record<string, unknown>
    const now = await $.clock.now()
    await patch($, id, now, t => ({ ...t, activity: describe(fields) }))
    const ran = await next(e)
    if (isTaskTool(e.tool) && !ran.deny) {
      const result = ran.result
      await patch($, id, now, t => ({
        ...t,
        tasks: applyTasks(t.tasks, fields, result),
      }))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (off) return next(e)
    const now = await $.clock.now()
    const isMain = e.agentId === undefined
    const failed = e.reason === 'error' || e.reason === 'refusal'
    await patch($, loopOf(e.agentId), now, t => ({
      ...t,
      model: e.usage?.model ?? t.model,
      status: failed ? 'failed' : isMain ? 'idle' : 'done',
      activity: e.reason === 'aborted' ? 'interrupted' : failed ? e.reason : 'done',
      endedAt: now,
    }))

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (off)
      return (
        <Box>
          <Text dimColor>Turned off. Open /mods to turn it on.</Text>
        </Box>
      )
    const list = await read($, threads)
    const now = await $.clock.now()
    const width = Math.max(20, e.props.bodyColumns - 2)
    const barWidth = Math.min(14, Math.max(4, width - 18))
    const main = list.find(t => t.id === MAIN)
    // Running subagents first, then the most recent finished ones.
    const agents = list
      .filter(t => t.id !== MAIN)
      .sort(
        (a, b) =>
          Number(b.status === 'running') - Number(a.status === 'running') ||
          (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt),
      )
    const running = agents.filter(t => t.status === 'running').length

    const markOf = (t: Thread) =>
      t.status === 'running' ? '●' : t.status === 'failed' ? '✗' : t.status === 'done' ? '✓' : '○'
    const colorOf = (t: Thread) =>
      t.status === 'running' ? 'warning' : t.status === 'failed' ? 'error' : t.status === 'done' ? 'success' : 'inactive'
    const stateOf = (t: Thread) => (t.status === 'done' ? 'done' : t.status)

    // One thread: an UPPERCASE label with its model, the activity beneath,
    // then the bar with its figure in bold.
    const thread = (t: Thread, accent: string) => {
      const isRunning = t.status === 'running'
      const otherModel =
        t.id !== MAIN && main?.model && t.model && shortModel(t.model) !== shortModel(main.model)
      const p = progress(t)
      const time = elapsed((t.endedAt ?? now) - t.startedAt)

      return (
        <Box flexDirection="column" marginBottom={1}>
          <Box justifyContent="space-between">
            <Text>
              <Text bold color={accent}>{clip(t.label.toUpperCase(), width - 22)}</Text>
              <Text color={otherModel ? 'suggestion' : accent}> · {shortModel(t.model)}</Text>
            </Text>
            <Text>
              <Text color={colorOf(t)}>{markOf(t)}</Text>
              <Text dimColor> {stateOf(t)}</Text>
            </Text>
          </Box>
          <Text dimColor={!isRunning}>{clip(t.activity, width)}</Text>
          {(isRunning || t.tasks.length > 0) ? (
            <Text>
              <Text color={isRunning ? accent : 'inactive'}>{bar(p.fraction, barWidth)}</Text>
              <Text bold>  {p.value}</Text>
              <Text dimColor>{p.unit} · {time}</Text>
            </Text>
          ) : (
            <Text dimColor>{time}</Text>
          )}
        </Box>
      )
    }

    const mainModel = main?.model ? shortModel(main.model).toUpperCase() : '…'
    const mainState = main ? stateOf(main).toUpperCase() : 'IDLE'

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>AGENT STATUS</Text>
          <Text dimColor> · </Text>
          <Text bold color="claude">{mainModel}</Text>
          <Text bold color={main ? colorOf(main) : 'inactive'}> {mainState}</Text>
        </Text>
        <Text dimColor>{'─'.repeat(width)}</Text>
        {main ? thread(main, 'claude') : <Text dimColor>Nothing has run yet.</Text>}
        <Text>
          <Text bold>agents</Text>
          <Text dimColor> · </Text>
          <Text bold>{running}</Text>
          <Text dimColor> running · </Text>
          <Text bold>{agents.length}</Text>
          <Text dimColor> total</Text>
        </Text>
        <Text dimColor>{'─'.repeat(width)}</Text>
        {agents.length === 0 && <Text dimColor>No subagents yet.</Text>}
        {agents.map(t => thread(t, 'suggestion'))}
      </Box>
    )
  })
}
