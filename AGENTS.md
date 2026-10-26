# AGENTS.md

Notes for coding agents working in this repo.

## What this is

Agent Status (`agent-status`) is a Claude Code plugin, called a mod. It adds
the `/agent-status` command, which opens a side panel showing the main thread
and each subagent: what it is doing, its progress, its model and how long it
has run. It is one TSX hooks module. There is no server and no build step.

## Layout

- `hooks/register.tsx`: the whole mod. Event handlers, state and the panel UI.
- `hooks/hooks.json`: lists the module (`./register.tsx`) the engine loads.
- `types/index.d.ts`: the `Task` and `Thread` types and the plugin state typing.
- `tests/panel.test.tsx`: the one test. Drives events, mounts the panel, checks the text.
- `.claude-plugin/plugin.json`: plugin name, version, metadata, `types` path.
- `.claude-plugin/marketplace.json`: makes the repo installable as a marketplace.
- `.claude-plugin/types/`: vendored `claude-code` type declarations and the tsconfig `tsconfig.json` extends. Do not hand-edit.
- `assets/`: images for the README and social preview.

## How it works

The pane gets its data from events Claude Code already sends. `register.tsx`
listens to `session.start`, `turn.start`, `turn.step`, `agent.spawn`,
`tool.call` and `turn.complete`. Each handler updates one `Thread` in an atom
(`plugin: 'agent-status', key: 'threads'`). Events with an `agentId` belong to
a subagent. Events without one belong to the main thread (`main`).

The `ui.render` handler for the `Pane` component reads that atom and draws it.
A 1-second clock invalidates the render while any thread is running, so elapsed
times tick. Only the main thread plus the 12 most recent subagents are kept.

Progress comes from the task list when there is one (`TodoWrite`,
`TaskCreate`, `TaskUpdate`). Otherwise it is an estimate from the step count,
capped at 90% until the thread is done.

The mod reads `.claude/mods/switches.json` (every 3 seconds). If it has
`"agent-status": false`, the mod turns itself off.

## Checks

Run from the repo root. All three must pass.

```
claude plugin test .
npx -y -p typescript@5.6.3 tsc --noEmit -p .
claude plugin validate .
```

## Conventions

- TypeScript and TSX, no semicolons, single quotes, 2-space indent.
- Handlers start with `if (off) return next(e)` so the switch turns the mod off.
- Thread changes go through `patch()`. Do not write to the atom elsewhere.
- If the `Thread` fields change, change the atom's `shape` tag (`threads-1`) too. It rejects state an older version stored.
- No semver bump without a reason: the version lives in `.claude-plugin/plugin.json`.
- Tests use `claude-code/testing`. Add new behaviour to `tests/panel.test.tsx`.
- README voice: plain, short sentences, no hype.

## Do not

- Do not add anything to Claude's prompt or change what Claude does. The mod only observes events and draws the panel.
- Do not edit `.claude-plugin/types/` by hand.
- Do not add dependencies or a build step.
- Do not state features in docs that the code does not have.
- Do not commit secrets or `node_modules/`.
