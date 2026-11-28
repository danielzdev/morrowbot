import { useCallback, useEffect, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../../bridge.ts';
import { openExternalLink, parseLaunch } from '../../shared/engine-setup.ts';
import { PLATFORM } from '../../shared/keys.ts';
import { redact, type AppInfo } from '../../shared/privacy.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { ListDetail } from '../../shared/ui/ListDetail.tsx';
import { useRecheckOnReturn } from '../../shared/use-recheck-on-return.ts';
import { useStore } from '../../shared/use-store.ts';
import { AddProvider } from './AddProvider.tsx';
import { ProviderDetail } from './ProviderDetail.tsx';
import { ProviderRow } from './ProviderRow.tsx';
import type { ProvidersModel } from './providers-model.ts';

export interface ProvidersSectionProps {
  readonly model: ProvidersModel;
  readonly info: AppInfo | null;
  readonly bridge: Pick<MorrowbotBridge, 'copyText' | 'openExternal' | 'signInTerminal'>;
  /** The provider a deep link opens (`providers/<id>`); the first one otherwise. */
  readonly initial: string | null;
  /** The names of agents bound to a provider, for the turn-off confirm. */
  readonly agentsUsing: (providerId: string) => readonly string[];
  /** The selected provider's name, for the Settings breadcrumb. */
  readonly onTrail: (name: string | null) => void;
  readonly onOpenExtensions: () => void;
}

type Pending = { readonly kind: 'select'; readonly id: string } | { readonly kind: 'turn-off'; readonly id: string; readonly name: string; readonly agents: readonly string[] };

/** Settings › Providers (spec §6.2): every built-in engine and community provider, as a list and a detail. */
export function ProvidersSection(props: ProvidersSectionProps) {
  const { model, info, onTrail } = props;
  const cards = useStore(model.cards);
  const installCapabilities = useStore(model.installCapabilities);
  const safeMode = useStore(model.safeMode).on;
  const [selected, setSelected] = useState<string | null>(props.initial);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    void model.load();
  }, [model]);
  const list = cards.kind === 'loaded' ? cards.value : [];
  const current = list.find(({ entry }) => entry.manifest.id === selected) ?? list[0];
  const currentName = current?.entry.manifest.name ?? null;
  useEffect(() => {
    onTrail(currentName);
  }, [currentName, onTrail]);
  const onDirty = useCallback((next: boolean) => {
    setDirty(next);
  }, []);
  const recheckLater = useRecheckOnReturn((id) => void model.recheck(id));

  if (info === null || cards.kind === 'loading') return <p class="muted">Loading providers…</p>;
  if (cards.kind === 'failed') {
    return (
      <div class="banner error" role="alert">
        <span>{redact(cards.message, info)}</span>
        <button type="button" class="btn secondary" onClick={() => void model.load()}>
          Try again
        </button>
      </div>
    );
  }
  const safe = (text: string): string => redact(text, info);
  const select = (id: string): void => {
    if (id === current?.entry.manifest.id) return;
    if (dirty) setPending({ kind: 'select', id });
    else setSelected(id);
  };
  const setEnabled = (id: string, enabled: boolean): void => {
    const name = list.find(({ entry }) => entry.manifest.id === id)?.entry.manifest.name ?? id;
    const agents = props.agentsUsing(id);
    if (!enabled && agents.length > 0) setPending({ kind: 'turn-off', id, name, agents });
    else void model.setEnabled(id, enabled);
  };

  return (
    <div class="providers">
      {safeMode && <p class="note">Safe mode is on: built-in providers keep working, and community providers stay off until Ori Kami restarts normally.</p>}
      <ListDetail
        label="Providers"
        list={list.map((card, index) => (
          <ProviderRow
            key={card.entry.manifest.id}
            card={card}
            selected={card === current}
            tabStop={card === current || (current === undefined && index === 0)}
            redact={safe}
            onSelect={() => { select(card.entry.manifest.id); }}
            onEnabled={(enabled) => { setEnabled(card.entry.manifest.id, enabled); }}
          />
        ))}
        footer={<AddProvider cards={list} onPick={select} onOpenExtensions={props.onOpenExtensions} />}
        detail={
          current === undefined ? (
            <p class="muted">No providers are available.</p>
          ) : (
            <ProviderDetail
              key={current.entry.manifest.id}
              card={current}
              info={info}
              redact={safe}
              actions={{
                onEnabled: (enabled) => { setEnabled(current.entry.manifest.id, enabled); },
                onRecheck: () => void model.recheck(current.entry.manifest.id),
                onSaveConfig: (config) => void model.setConfig(current.entry.manifest.id, config),
                onRelease: (regId) => void model.release(current.entry.manifest.id, regId),
                onCopy: (text) => {
                  recheckLater(current.entry.manifest.id);
                  return props.bridge.copyText(safe(text));
                },
                onOpenLink: async (url) => {
                  const reason = await openExternalLink(props.bridge, url);
                  if (reason === null) recheckLater(current.entry.manifest.id);
                  return reason === null ? null : safe(reason);
                },
                onSignInTerminal:
                  PLATFORM === 'mac' && current.entry.source === 'built-in'
                    ? async () => {
                        recheckLater(current.entry.manifest.id);
                        const launch = parseLaunch(await props.bridge.signInTerminal(current.entry.manifest.id));
                        return launch.kind === 'opened' ? null : launch.reason;
                      }
                    : null,
                installCapability: current.entry.source === 'built-in' ? (installCapabilities[current.entry.manifest.id] ?? null) : null,
                onInstall:
                  current.entry.source === 'built-in'
                    ? (mode) => model.install(current.entry.manifest.id, mode)
                    : null,
                onCancelInstall:
                  current.entry.source === 'built-in'
                    ? () => model.cancelInstall(current.entry.manifest.id)
                    : null,
                onDirty,
              }}
            />
          )
        }
      />
      {pending?.kind === 'select' && (
        <ConfirmDialog
          title="Discard changes?"
          body="Your unsaved settings for this provider will be lost."
          confirmLabel="Discard"
          tone="danger"
          onCancel={() => { setPending(null); }}
          onConfirm={() => {
            setSelected(pending.id);
            setDirty(false);
            setPending(null);
          }}
        />
      )}
      {pending?.kind === 'turn-off' && (
        <ConfirmDialog
          title={`Turn off ${pending.name}?`}
          body={
            <>
              <p>
                {pending.agents.length === 1 ? 'This agent uses it' : `These ${String(pending.agents.length)} agents use it`}: {pending.agents.join(', ')}.
              </p>
              <p>Their chats stay readable, but they can't send new messages until you turn it back on.</p>
            </>
          }
          confirmLabel="Turn off"
          tone="danger"
          onCancel={() => { setPending(null); }}
          onConfirm={() => {
            void model.setEnabled(pending.id, false);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
