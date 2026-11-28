import type { Agent, AgentGrant, Member } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { failure, notFound, type Reply } from './reply.ts';
import type { Params } from './route.ts';

/** Who sent a request: the desktop app (this launch's token), a paired device, a server member, or nobody known. */
export type Caller =
  | { readonly kind: 'host' }
  | { readonly kind: 'device'; readonly deviceId: string }
  | { readonly kind: 'member'; readonly member: Member }
  | { readonly kind: 'anonymous' };

/** What a route needs of a scoped member's grant: to see the agent, to start its turns, or to change it. */
export type Need = 'view' | 'chat' | 'edit';

/**
 * Who may call a route. Left out, only the owner may: this desktop, a paired device or a co-owner.
 * `agent`, `thread` and `attachment` routes name that thing in `:id` and also let a scoped member in
 * whose grant covers it; `signed-in` routes let every member in and show each only what `sees` allows.
 */
export type Access =
  | { readonly kind: 'public' }
  | { readonly kind: 'host' }
  | { readonly kind: 'owner' }
  | { readonly kind: 'signed-in' }
  | { readonly kind: 'agent'; readonly need: Need }
  | { readonly kind: 'thread'; readonly need: Need }
  | { readonly kind: 'attachment' };

/** Whose view a handler answers for: the owner sees everything, a scoped member only its granted agents. */
export type Viewer =
  | { readonly kind: 'owner' }
  | { readonly kind: 'scoped'; readonly memberId: string; readonly grants: ReadonlyMap<string, AgentGrant> };

export function sees(viewer: Viewer, agentId: string): boolean {
  return viewer.kind === 'owner' || viewer.grants.has(agentId);
}

export type Admission = { readonly kind: 'admitted'; readonly viewer: Viewer } | { readonly kind: 'denied'; readonly reply: Reply };

const OWNER: Admission = { kind: 'admitted', viewer: { kind: 'owner' } };

function denied(reply: Reply): Admission {
  return { kind: 'denied', reply };
}

export function viewerOf(caller: Exclude<Caller, { kind: 'anonymous' }>): Viewer {
  switch (caller.kind) {
    case 'host':
    case 'device':
      return { kind: 'owner' };
    case 'member': {
      const { access, memberId } = caller.member;
      switch (access.kind) {
        case 'co-owner':
          return { kind: 'owner' };
        case 'scoped':
          return { kind: 'scoped', memberId, grants: new Map(access.agents.map((grant) => [grant.agentId, grant])) };
      }
    }
  }
}

/** Decides whether `caller` may use a route with this access, looking up what `:id` names when a scoped member asks. */
export async function authorize(access: Access, caller: Caller, params: Params, services: ApiServices): Promise<Admission> {
  if (access.kind === 'public') return OWNER;
  if (caller.kind === 'anonymous') return denied(failure('unauthorized', 'Missing or wrong token'));
  if (access.kind === 'host') return caller.kind === 'host' ? OWNER : denied(failure('forbidden', 'Only the desktop app running this server may manage devices and members'));
  const viewer = viewerOf(caller);
  if (viewer.kind === 'owner') return OWNER;
  const admitted: Admission = { kind: 'admitted', viewer };
  switch (access.kind) {
    case 'owner':
      return denied(failure('forbidden', 'Only the server owner may use this'));
    case 'signed-in':
      return admitted;
    case 'agent':
      return grantAdmits(viewer, params.get('id'), access.need, services, 'Agent');
    case 'thread': {
      const agentId = services.chat.getThread(params.get('id'))?.agentId;
      return agentId === undefined ? denied(notFound('Thread')) : grantAdmits(viewer, agentId, access.need, services, 'Thread');
    }
    case 'attachment': {
      const threadId = services.attachments.threadOf(params.get('id'));
      const agentId = threadId === undefined ? undefined : services.chat.getThread(threadId)?.agentId;
      return agentId === undefined ? denied(notFound('Attachment')) : grantAdmits(viewer, agentId, 'view', services, 'Attachment');
    }
  }
}

/** An agent outside the grant is not found, so a scoped member cannot learn which other agents exist. */
async function grantAdmits(
  viewer: Extract<Viewer, { kind: 'scoped' }>,
  agentId: string,
  need: Need,
  services: ApiServices,
  what: string,
): Promise<Admission> {
  const grant = viewer.grants.get(agentId);
  const agent = services.agents.get(agentId);
  if (grant === undefined || agent === undefined) return denied(notFound(what));
  switch (need) {
    case 'view':
      return { kind: 'admitted', viewer };
    case 'edit':
      return grant.canEdit ? { kind: 'admitted', viewer } : denied(failure('forbidden', 'Your invite does not let you change this agent'));
    case 'chat': {
      const problem = await containmentProblem(agent, grant, services);
      return problem === undefined ? { kind: 'admitted', viewer } : denied(failure('forbidden', problem));
    }
  }
}

/**
 * Why a scoped member's turn may not start on this agent now: its engine setting must stay inside the grant's
 * confinement, use Ori Kami's own isolated CLI settings (never the owner's personal setup and its connectors),
 * and be proven not to read files outside the agent's folder. Checked on every turn, so an owner changing the
 * agent later cannot widen what a member reaches.
 */
async function containmentProblem(agent: Agent, grant: AgentGrant, services: ApiServices): Promise<string | undefined> {
  const binding = agent.provider;
  if (binding.kind === 'unbound') return undefined;
  const allowed = binding.access === 'read-only' || (binding.access === 'workspace-write' && grant.workspace === 'workspace-write' && agent.workspace.kind === 'dedicated');
  if (!allowed) return `This agent may ${binding.access === 'full' ? 'use the whole computer' : 'write files'}, more than your invite allows. Ask the owner to share it read-only.`;
  if (binding.vendorSettings !== 'isolated') return "This agent uses the owner's personal engine setup, which is never shared. Ask the owner to switch it to isolated settings.";
  const info = await services.plugins.info(binding.pluginId, false);
  if (info.kind !== 'ok' || (info.info.kind !== 'ready' && info.info.kind !== 'ready-models-later')) return "This agent's engine is not ready. Ask the owner to check it.";
  const profile = info.info.capabilities.profiles.find((each) => each.access === binding.access && each.vendorSettings === binding.vendorSettings);
  if (profile?.readsOutsideCwd !== false) return "This agent's engine can read files outside the agent's folder, so it cannot run for shared members.";
  return undefined;
}
