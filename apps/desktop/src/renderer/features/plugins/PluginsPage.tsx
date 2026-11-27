import type { PluginConfig, ProviderInfo, SettingField, SettingValue, UsageResponse } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../../bridge.ts';
import { BlockedBanner } from '../../shared/BlockedBanner.tsx';
import { formatTime } from '../../shared/format.ts';
import { ACCESS_LABEL } from '../../shared/labels.ts';
import { useStore } from '../../shared/use-store.ts';
import { summarize } from './plugin-summary.ts';
import type { PluginCard, PluginsModel } from './plugins-model.ts';

function SettingInput(props: { readonly name: string; readonly field: SettingField; readonly value: SettingValue | undefined; readonly onChange: (value: SettingValue | undefined) => void }) {
  const { field } = props;
  switch (field.kind) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={props.value === undefined ? field.default === true : props.value === true}
          onChange={(event) => { props.onChange(event.currentTarget.checked); }}
        />
      );
    case 'select':
      return (
        <select value={String(props.value ?? field.default ?? '')} onChange={(event) => { props.onChange(event.currentTarget.value); }}>
          {field.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    case 'number':
      return (
        <input
          type="number"
          value={props.value === undefined ? '' : String(props.value)}
          placeholder={field.default === undefined ? '' : String(field.default)}
          onInput={(event) => {
            const text = event.currentTarget.value;
            props.onChange(text === '' ? undefined : Number(text));
          }}
        />
      );
    case 'string':
      return (
        <input
          type="text"
          spellcheck={false}
          value={props.value === undefined ? '' : String(props.value)}
          placeholder={field.default ?? (props.name === 'cliPath' ? 'Found on PATH' : '')}
          onInput={(event) => {
            const text = event.currentTarget.value;
            props.onChange(text === '' ? undefined : text);
          }}
        />
      );
  }
}

function Settings(props: { readonly card: PluginCard; readonly onSave: (config: PluginConfig) => void }) {
  const { manifest, config } = props.card.entry;
  const [draft, setDraft] = useState<PluginConfig>(config);
  const fields = Object.entries(manifest.settingsSchema);
  if (fields.length === 0) return null;
  const changed = JSON.stringify(draft) !== JSON.stringify(config);
  return (
    <form
      class="settings"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(draft);
      }}
    >
      {fields.map(([name, field]) => (
        <label key={name} class="field">
          <span>{field.label}</span>
          <SettingInput
            name={name}
            field={field}
            value={draft[name]}
            onChange={(value) => {
              const others = Object.fromEntries(Object.entries(draft).filter(([key]) => key !== name));
              setDraft(value === undefined ? others : { ...others, [name]: value });
            }}
          />
        </label>
      ))}
      <div class="row">
        <button class="secondary" type="submit" disabled={!changed || props.card.busy !== null}>
          {props.card.busy === 'saving' ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function Capabilities({ info }: { readonly info: ProviderInfo }) {
  if (info.kind !== 'ready' && info.kind !== 'ready-models-later') return null;
  const { profiles, withheld } = info.capabilities;
  return (
    <div class="capabilities">
      {profiles.map((profile) => (
        <div key={`${profile.access}/${profile.vendorSettings}`} class="capability ok">
          ✓ {ACCESS_LABEL[profile.access]} ({profile.modes.join(', ')}){profile.readsOutsideCwd ? ' · can read your files outside the workspace' : ''}
          {profile.vendorSettings === 'personal' ? ' · also loads your personal CLI instructions' : ''}
        </div>
      ))}
      {withheld.map((profile) => (
        <div key={`withheld-${profile.access}/${profile.vendorSettings}`} class="capability withheld">
          ✕ {ACCESS_LABEL[profile.access]}: {profile.reason}
        </div>
      ))}
      {info.kind === 'ready-models-later' && <div class="capability">Models appear after the first message.</div>}
    </div>
  );
}

function Usage({ usage }: { readonly usage: UsageResponse }) {
  if (usage.usage.kind !== 'available' || usage.usage.windows.length === 0) return null;
  return (
    <div class="usage">
      {usage.usage.windows.map((window) => (
        <div key={window.id} class="usage-row">
          <span>{window.label}</span>
          <div class="meter" aria-label={`${window.label}: ${String(Math.round(window.usedPercent))}% used`}>
            <div style={{ width: `${String(window.usedPercent)}%` }} />
          </div>
          <span class="muted">
            {Math.round(window.usedPercent)}%{window.resetsAt === null ? '' : ` · resets ${formatTime(window.resetsAt)}`}
            {usage.stale ? ' · may be out of date' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function Card(props: { readonly card: PluginCard; readonly model: PluginsModel; readonly bridge: Pick<MorrowbotBridge, 'copyText'> }) {
  const { card, model } = props;
  const { manifest } = card.entry;
  const id = manifest.id;
  const summary = summarize(card.entry, card.info);
  const [copied, setCopied] = useState(false);
  const provider = card.info !== null;
  return (
    <section class="plugin-card" aria-label={manifest.name}>
      <header>
        <div>
          <h3>{manifest.name}</h3>
          <span class="muted">
            {manifest.kind} · v{manifest.version}
          </span>
        </div>
        <label class="toggle">
          <input type="checkbox" checked={card.entry.enabled} disabled={card.busy !== null} onChange={(event) => void model.setEnabled(id, event.currentTarget.checked)} />
          Enabled
        </label>
      </header>
      <BlockedBanner groups={card.entry.blockedGroups} busy={card.busy !== null} onRelease={(regId) => void model.release(id, regId)} />
      <div class={`summary ${summary.tone}`} data-state={summary.state}>
        <strong>{summary.title}</strong>
        {summary.detail !== null && <div>{summary.detail}</div>}
      </div>
      {summary.command !== null && (
        <div class="command">
          <code>{summary.command}</code>
          <button
            class="secondary"
            onClick={() => {
              void props.bridge.copyText(summary.command ?? '').then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {card.info?.kind === 'loaded' && <Capabilities info={card.info.value} />}
      {card.usage !== null && <Usage usage={card.usage} />}
      {card.problem !== null && <div class="note error">{card.problem}</div>}
      {provider && (
        <div class="row">
          <button class="secondary" disabled={card.busy !== null || !card.entry.enabled} onClick={() => void model.recheck(id)}>
            {card.busy === 'rechecking' ? 'Rechecking…' : 'Recheck'}
          </button>
          <span class="muted">After you sign in, out, or switch accounts in a terminal, press Recheck.</span>
        </div>
      )}
      <Settings key={JSON.stringify(card.entry.config)} card={card} onSave={(config) => void model.setConfig(id, config)} />
    </section>
  );
}

export function PluginsPage(props: { readonly model: PluginsModel; readonly bridge: Pick<MorrowbotBridge, 'copyText'> }) {
  const cards = useStore(props.model.cards);
  useEffect(() => {
    void props.model.load();
  }, [props.model]);
  return (
    <div class="page">
      <h2>Plugins</h2>
      {cards.kind === 'loading' && <p class="muted">Loading…</p>}
      {cards.kind === 'failed' && (
        <div class="banner error">
          <div class="banner-row">
            <span>{cards.message}</span>
            <button class="secondary" onClick={() => void props.model.load()}>
              Try again
            </button>
          </div>
        </div>
      )}
      {cards.kind === 'loaded' && cards.value.length === 0 && <p class="muted">No plugins are installed.</p>}
      {cards.kind === 'loaded' && cards.value.map((card) => <Card key={card.entry.manifest.id} card={card} model={props.model} bridge={props.bridge} />)}
    </div>
  );
}
