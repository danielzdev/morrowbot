import { AccessLevel, EntityId, MAX_ACTIVE_SUBAGENTS, MAX_SUBAGENTS_PER_TURN, SubagentRole, type SubagentRun } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ToolPorts } from './ports.ts';
import { done, refused, tool, type Tool } from './tool.ts';

/** How long one `wait_subagents` call blocks by default and at most. Codex gives an MCP call 60 s by default. */
const DEFAULT_WAIT_SECONDS = 45;
const MAX_WAIT_SECONDS = 600;

const SpawnArgs = z.strictObject({
  role: SubagentRole.describe('A short name for the job, shown to the user, such as "Reviewer" or "Test runner".'),
  prompt: z.string().trim().min(1).max(100_000).describe('Everything the sub-agent needs: it sees only this, not your chat.'),
  provider: z.string().min(1).optional().describe('A provider id from list_subagents. Left out: yours.'),
  model: z.string().min(1).optional().describe('A model id of that provider from list_subagents. Left out: yours on your provider, its default on another.'),
  effort: z.string().min(1).optional().describe("A reasoning effort the model lists, such as \"low\" or \"high\". Left out: the model's (or yours)."),
  access: AccessLevel.optional().describe('At most your own access. Left out: yours.'),
});

/** A sub-agent as a tool result shows it; `reply` only when it has finished and `withReply`. */
function shown(run: SubagentRun, withReply: boolean): object {
  const { binding, status } = run;
  const model = binding.selection.kind === 'model' ? binding.selection.id : 'default';
  const base = { runId: run.id, role: run.role, provider: binding.pluginId, model, access: binding.access };
  switch (status.kind) {
    case 'queued':
    case 'running':
      return { ...base, status: status.kind };
    case 'finished':
      return { ...base, status: status.outcome.kind, ...(withReply ? { reply: status.reply } : {}) };
  }
}

export function subagentTools({ subagents }: ToolPorts): Tool[] {
  return [
    tool({
      name: 'spawn_subagent',
      description: [
        'Starts a sub-agent: one background turn, in your workspace, that works on a prompt and replies, on your provider and model or on another one from list_subagents (for example a second opinion from a different model).',
        `It has at most your access and cannot start sub-agents itself. Up to ${String(MAX_ACTIVE_SUBAGENTS)} run at once, ${String(MAX_SUBAGENTS_PER_TURN)} per turn.`,
        'Returns its runId at once; start several to work in parallel, then collect their replies with wait_subagents. Any still running when your turn ends are stopped.',
      ].join(' '),
      input: SpawnArgs,
      run: async (grant, args) => {
        const started = await subagents.spawn(grant, {
          role: args.role,
          prompt: args.prompt,
          provider: args.provider,
          model: args.model,
          effort: args.effort,
          access: args.access,
        });
        return started.kind === 'started' ? done({ subagent: shown(started.run, false) }) : refused(started.reason);
      },
    }),
    tool({
      name: 'wait_subagents',
      description: `Waits until your sub-agents finish and returns their replies. Names runIds, or every sub-agent this turn started. Returns after timeoutSeconds even if some still run (timedOut: true): call it again to keep waiting.`,
      input: z.strictObject({
        runIds: z.array(EntityId).min(1).max(MAX_SUBAGENTS_PER_TURN).optional().describe('Which sub-agents. Left out: all of this turn’s.'),
        timeoutSeconds: z.int().min(1).max(MAX_WAIT_SECONDS).default(DEFAULT_WAIT_SECONDS).describe('The longest this call waits.'),
      }),
      run: async (grant, { runIds, timeoutSeconds }) => {
        const waited = await subagents.wait(grant, runIds, timeoutSeconds * 1000);
        if (waited.kind === 'refused') return refused(waited.reason);
        return done({ timedOut: waited.timedOut, subagents: waited.runs.map((run) => shown(run, true)) });
      },
    }),
    tool({
      name: 'list_subagents',
      description: 'Lists the sub-agents of this chat with their status, your own provider and access, and the providers and models you can start sub-agents on.',
      input: z.strictObject({}),
      run: async (grant) => {
        const listed = await subagents.list(grant);
        if (listed.kind === 'refused') return refused(listed.reason);
        const { you } = listed;
        return done({
          you: { provider: you.pluginId, model: you.selection.kind === 'model' ? you.selection.id : 'default', access: you.access },
          subagents: listed.runs.map((run) => shown(run, false)),
          providers: listed.providers,
        });
      },
    }),
  ];
}
