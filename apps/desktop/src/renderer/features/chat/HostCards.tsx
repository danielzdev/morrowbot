import type { PluginCardState, SafeSettingId, ThreadCard } from '@morrowbot/contracts';
import { PERMISSION_LABELS } from '../../shared/permission-labels.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import type { CardContext } from './ThreadCards.tsx';

type PluginBody = Extract<ThreadCard['body'], { kind: 'plugin' }>;
type SettingBody = Extract<ThreadCard['body'], { kind: 'setting' }>;

interface SettingCopy {
  readonly label: string;
  readonly detail: (agent: string) => string;
  readonly where: string;
}

/** What each allowlisted setting is called, and what turning it on does for the card's agent. */
const SETTING_COPY: Readonly<Record<SafeSettingId, SettingCopy>> = {
  'agent-emoji-replies': {
    label: 'Emoji-only / silent replies',
    detail: (agent) => `Lets ${agent} answer with only an emoji reaction, or no message, when a text reply would be filler.`,
    where: 'You can change it again here or in Agent Settings › Replies.',
  },
};

const PLUGIN_ENDING: Readonly<Record<Exclude<PluginCardState, 'offered'>, string>> = { installed: 'Installed', cancelled: 'Cancelled' };

/** Ori Kami's own frame: its name, and which agent suggested the card. Agent cards get a different one. */
function HostFrame(props: { readonly agent: string; readonly icon: 'plugins' | 'settings' }) {
  return (
    <header class="host-card-frame">
      <Icon name={props.icon} size={14} />
      <span class="host-card-from">Ori Kami</span>
      <span class="host-card-by">Suggested by {props.agent}</span>
    </header>
  );
}

/** A Marketplace plugin, drawn from its manifest: only the owner's click on Install turns it on. */
export function PluginCard(props: { readonly card: ThreadCard; readonly body: PluginBody; readonly held: string | null; readonly ctx: CardContext }) {
  const { card, body, ctx } = props;
  const { plugin } = body;
  const agent = ctx.peers.name(card.agentId);
  const act = (kind: 'install' | 'cancel'): void => { ctx.onAct(card.id, { kind }); };
  const open = ctx.onOpenPlugin;
  return (
    <section class="card host-card plugin-card" aria-label={`Plugin: ${plugin.name}`} data-card-id={card.id}>
      <HostFrame agent={agent} icon="plugins" />
      <div class="plugin-card-head">
        <ItemMark name={plugin.name} />
        <span class="plugin-card-title">
          <span class="plugin-card-name">{plugin.name}</span>
          <span class="plugin-card-meta">
            {plugin.kind === 'provider' ? 'Provider' : 'Tool'} plugin · {plugin.version}
          </span>
        </span>
      </div>
      {plugin.description !== '' && <p class="plugin-card-description">{plugin.description}</p>}
      <div class="plugin-card-facts">
        <span class="plugin-card-label">It asks to</span>
        {plugin.permissions.length === 0 ? (
          <span class="plugin-card-none">Nothing beyond running as a plugin</span>
        ) : (
          <ul class="plugin-card-permissions">
            {plugin.permissions.map((permission) => <li key={permission}>{PERMISSION_LABELS[permission]}</li>)}
          </ul>
        )}
        <span class="plugin-card-label">Available to</span>
        <span>All agents</span>
      </div>
      <div class="card-actions">
        {body.state === 'offered' && ctx.owner && (
          <button type="button" class="primary" disabled={props.held !== null} onClick={() => { act('install'); }}>
            Install
          </button>
        )}
        {open !== null && (
          <button type="button" class="secondary" onClick={() => { open(body.pluginId); }}>
            Open
          </button>
        )}
        {body.state === 'offered' && ctx.owner && (
          <button type="button" class="ghost" disabled={props.held !== null} onClick={() => { act('cancel'); }}>
            Cancel
          </button>
        )}
        {body.state !== 'offered' && (
          <span class={`card-ending ${body.state}`}>
            {body.state === 'installed' && <Icon name="check" size={14} />}
            {PLUGIN_ENDING[body.state]}
          </span>
        )}
        {props.held !== null && body.state === 'offered' && <span class="card-status">{props.held}</span>}
      </div>
      {!ctx.owner && body.state === 'offered' && <p class="card-foot">Only the server's owner can install plugins.</p>}
    </section>
  );
}

/** A one-click switch for one allowlisted, reversible setting of the card's agent. */
export function SettingCard(props: { readonly card: ThreadCard; readonly body: SettingBody; readonly held: string | null; readonly ctx: CardContext }) {
  const { card, body, ctx } = props;
  const agent = ctx.peers.name(card.agentId);
  const copy = SETTING_COPY[body.settingId];
  return (
    <section class="card host-card setting-card" aria-label={`Setting: ${copy.label}`} data-card-id={card.id}>
      <HostFrame agent={agent} icon="settings" />
      <div class="setting-card-row">
        <span class="setting-card-text">
          <span class="setting-card-label">{copy.label}</span>
          <span class="setting-card-detail">{copy.detail(agent)}</span>
        </span>
        <span class="setting-card-switch">
          <span class="setting-card-state" aria-hidden="true">{body.on ? 'On' : 'Off'}</span>
          <Toggle
            label={copy.label}
            checked={body.on}
            disabled={!ctx.owner || props.held !== null}
            onChange={(on) => { ctx.onAct(card.id, { kind: 'set', on }); }}
          />
        </span>
      </div>
      <p class="card-foot">{ctx.owner ? copy.where : "Only the server's owner can change this."}</p>
      {props.held !== null && <span class="card-status">{props.held}</span>}
    </section>
  );
}
