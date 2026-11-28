import type { Agent, InviteResponse, Member } from '@morrowbot/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { InviteForm } from './InviteForm.tsx';
import { accessSummary, currentMembers, EMPTY_DRAFT, inviteRequest, statusLine, type InviteDraft, type MembersPort } from './members.ts';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

type Loaded = { readonly kind: 'loading' } | { readonly kind: 'loaded'; readonly members: readonly Member[]; readonly agents: readonly Agent[] } | { readonly kind: 'failed'; readonly message: string };

type Inviting =
  | { readonly kind: 'idle' }
  | { readonly kind: 'editing'; readonly needsUrl: boolean; readonly error: string | null; readonly busy: boolean }
  | { readonly kind: 'made'; readonly invite: InviteResponse };

const CONFLICT = 409;

/** Settings › Members: invite people with a one-time link, see who can reach this server, and revoke them. */
export function MembersSection(props: { readonly port: MembersPort; readonly now?: () => number }) {
  const now = props.now ?? Date.now;
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [inviting, setInviting] = useState<Inviting>({ kind: 'idle' });
  const [draft, setDraft] = useState<InviteDraft>(EMPTY_DRAFT);
  const [url, setUrl] = useState('');
  const [revoking, setRevoking] = useState<Member | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(true);

  const load = async (): Promise<void> => {
    const [members, agents] = await Promise.all([props.port.listMembers(), props.port.listAgents()]);
    if (!live.current) return;
    if (members.kind === 'failed') setLoaded({ kind: 'failed', message: members.error.message });
    else if (agents.kind === 'failed') setLoaded({ kind: 'failed', message: agents.error.message });
    else setLoaded({ kind: 'loaded', members: currentMembers(members.value), agents: agents.value.agents });
  };
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, []);

  const submit = async (needsUrl: boolean): Promise<void> => {
    setInviting({ kind: 'editing', needsUrl, error: null, busy: true });
    const result = await props.port.createInvite(inviteRequest(draft, needsUrl ? url.trim() : null));
    if (!live.current) return;
    if (result.kind === 'ok') {
      setInviting({ kind: 'made', invite: result.value });
      setDraft(EMPTY_DRAFT);
      void load();
      return;
    }
    const wantsUrl = result.status === CONFLICT;
    setInviting({ kind: 'editing', needsUrl: needsUrl || wantsUrl, error: wantsUrl && !needsUrl ? null : result.error.message, busy: false });
  };

  const revoke = async (member: Member): Promise<void> => {
    setRevoking(null);
    const result = await props.port.revokeMember(member.memberId);
    if (!live.current) return;
    setNotice(result.kind === 'ok' ? `Revoked ${member.name}. They were signed out at once.` : `Couldn't revoke ${member.name}: ${result.error.message}`);
    await load();
  };

  const agents = loaded.kind === 'loaded' ? loaded.agents : [];
  return (
    <>
      <SettingRow entry={ROWS.invite}>
        <button
          type="button"
          class="btn primary"
          disabled={inviting.kind === 'editing' || loaded.kind !== 'loaded'}
          onClick={() => {
            setNotice(null);
            setInviting({ kind: 'editing', needsUrl: false, error: null, busy: false });
          }}
        >
          Invite someone
        </button>
      </SettingRow>
      {inviting.kind === 'editing' && (
        <InviteForm
          draft={draft}
          agents={agents}
          url={inviting.needsUrl ? { value: url, onChange: setUrl } : null}
          busy={inviting.busy}
          error={inviting.error}
          onDraft={setDraft}
          onSubmit={() => void submit(inviting.needsUrl)}
          onCancel={() => {
            setInviting({ kind: 'idle' });
          }}
        />
      )}
      {inviting.kind === 'made' && (
        <div class="pair-panel invite-made" role="status">
          <div class="pair-info">
            <div class="setting-label">Invite for {inviting.invite.member.name}</div>
            <code class="invite-link">{inviting.invite.inviteUri}</code>
            <p class="setting-description">
              Send this link privately. It works once, until {new Date(inviting.invite.member.status.kind === 'invited' ? inviting.invite.member.status.expiresAt : now()).toLocaleDateString()}. In MorrowBot they choose Join a server and paste it.
            </p>
            <div class="pair-actions">
              <button type="button" class="btn primary" onClick={() => void props.port.copy(inviting.invite.inviteUri)}>
                Copy link
              </button>
              <button
                type="button"
                class="btn secondary"
                onClick={() => {
                  setInviting({ kind: 'idle' });
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      <SettingRow entry={ROWS.members}>
        {loaded.kind === 'loaded' && <span class="setting-note">{loaded.members.length === 1 ? '1 member' : `${String(loaded.members.length)} members`}</span>}
      </SettingRow>
      {notice !== null && (
        <p class="setting-note devices-notice" role="status">
          {notice}
        </p>
      )}
      {loaded.kind === 'loading' && <p class="muted devices-empty">Loading members…</p>}
      {loaded.kind === 'failed' && (
        <div class="banner error devices-banner" role="alert">
          <span>{loaded.message}</span>
          <button type="button" class="btn secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {loaded.kind === 'loaded' && loaded.members.length === 0 && <p class="muted devices-empty">No one else can reach this server yet.</p>}
      {loaded.kind === 'loaded' && loaded.members.length > 0 && (
        <ul class="device-list" aria-label="Members">
          {loaded.members.map((member) => (
            <li key={member.memberId} class="device-row">
              <span class="device-icon">
                <Icon name="people" />
              </span>
              <div class="device-text">
                <div class="device-name">{member.name}</div>
                <div class="device-detail">{accessSummary(member, agents)}</div>
                <div class="device-detail">{statusLine(member, now())}</div>
              </div>
              <button
                type="button"
                class="btn secondary"
                aria-label={`Revoke ${member.name}`}
                onClick={() => {
                  setRevoking(member);
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {revoking !== null && (
        <ConfirmDialog
          title={`Revoke ${revoking.name}?`}
          body={<p>They are signed out at once, on every open window, and need a new invite to come back.</p>}
          confirmLabel="Revoke"
          tone="danger"
          onConfirm={() => void revoke(revoking)}
          onCancel={() => {
            setRevoking(null);
          }}
        />
      )}
    </>
  );
}
