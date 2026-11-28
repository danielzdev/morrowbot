import type { Agent, WorkspaceConfinement } from '@morrowbot/contracts';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { draftProblem, toggled, type InviteDraft } from './members.ts';

/**
 * Who to invite and what they may use: everything (co-owner), or only the agents ticked here, with whether they may
 * edit them, how far their turns may write, and which other agents the shared ones may message (none by default).
 */
export function InviteForm(props: {
  readonly draft: InviteDraft;
  readonly agents: readonly Agent[];
  /** Asked for when the host listens on no one address members can reach. */
  readonly url: { readonly value: string; readonly onChange: (url: string) => void } | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onDraft: (draft: InviteDraft) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const { draft, agents } = props;
  const set = (patch: Partial<InviteDraft>): void => {
    props.onDraft({ ...draft, ...patch });
  };
  const problem = draftProblem(draft);
  const others = agents.filter(({ id }) => !draft.agentIds.has(id));
  const sharedFolder = agents.some(({ id, workspace }) => draft.agentIds.has(id) && workspace.kind === 'shared');
  return (
    <form
      class="pair-panel invite-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !props.busy) props.onSubmit();
      }}
    >
      <div class="pair-info">
        <label class="field">
          <span>Name</span>
          <input
            type="text"
            autocomplete="off"
            placeholder="Who is this for?"
            value={draft.name}
            onInput={(event) => {
              set({ name: event.currentTarget.value });
            }}
          />
        </label>
        <Segmented<InviteDraft['role']>
          label="Access"
          value={draft.role}
          onChange={(role) => {
            set({ role });
          }}
          options={[
            { value: 'scoped', label: 'Chosen agents only' },
            { value: 'co-owner', label: 'Full co-owner' },
          ]}
        />
        {draft.role === 'co-owner' ? (
          <p class="setting-description">A co-owner can use every agent and change every setting except devices and members.</p>
        ) : (
          <>
            <fieldset class="invite-agents">
              <legend>Agents they can see and chat with</legend>
              {agents.map((agent) => (
                <label key={agent.id} class="invite-check">
                  <input
                    type="checkbox"
                    checked={draft.agentIds.has(agent.id)}
                    onChange={() => {
                      set({ agentIds: toggled(draft.agentIds, agent.id), allowlist: new Set([...draft.allowlist].filter((id) => id !== agent.id)) });
                    }}
                  />
                  <span>{agent.name}</span>
                  {agent.workspace.kind === 'shared' && <span class="muted"> · shared folder</span>}
                </label>
              ))}
            </fieldset>
            <div class="invite-row">
              <span>Can edit these agents' instructions and memories</span>
              <Toggle
                label="Can edit these agents"
                checked={draft.canEdit}
                onChange={(canEdit) => {
                  set({ canEdit });
                }}
              />
            </div>
            <div class="invite-row">
              <span>Their chats may</span>
              <Segmented<WorkspaceConfinement>
                label="Their chats may"
                value={draft.workspace}
                onChange={(workspace) => {
                  set({ workspace });
                }}
                options={[
                  { value: 'read-only', label: 'Only read' },
                  { value: 'workspace-write', label: "Write in the agent's folder", disabled: sharedFolder },
                ]}
              />
            </div>
            {others.length > 0 && (
              <fieldset class="invite-agents">
                <legend>Other agents the shared ones may message (none by default)</legend>
                {others.map((agent) => (
                  <label key={agent.id} class="invite-check">
                    <input
                      type="checkbox"
                      checked={draft.allowlist.has(agent.id)}
                      onChange={() => {
                        set({ allowlist: toggled(draft.allowlist, agent.id) });
                      }}
                    />
                    <span>{agent.name}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        {props.url !== null && (
          <label class="field">
            <span>Address members should use</span>
            <input
              type="text"
              inputMode="url"
              spellcheck={false}
              autocomplete="off"
              placeholder="https://studio.example.ts.net"
              value={props.url.value}
              onInput={(event) => {
                props.url?.onChange(event.currentTarget.value);
              }}
            />
          </label>
        )}
        {props.error !== null && (
          <p class="pair-error" role="alert">
            {props.error}
          </p>
        )}
        <div class="pair-actions">
          <button type="submit" class="btn primary" disabled={problem !== null || props.busy} title={problem ?? undefined}>
            {props.busy ? 'Making a link…' : 'Create invite link'}
          </button>
          <button type="button" class="btn secondary" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
