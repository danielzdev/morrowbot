import type { PluginList } from '@morrowbot/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ExtensionsHost } from './extensions-host.ts';
import type { ExtensionsSegment } from './extensions-model.ts';

export type LoadedPlugins =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loaded'; readonly list: PluginList };

export interface ExtensionsState {
  readonly plugins: LoadedPlugins;
  /** The segment the list shows; kept here so it survives folding and unfolding. */
  readonly segment: ExtensionsSegment;
  readonly setSegment: (segment: ExtensionsSegment) => void;
  /** Plugin ids whose on/off change is on its way to the host. */
  readonly saving: readonly string[];
  /** The last on/off change the host refused, by plugin id. */
  readonly refused: Readonly<Record<string, string>>;
  readonly reload: () => void;
  readonly setEnabled: (pluginId: string, enabled: boolean) => void;
}

const Context = createContext<ExtensionsState | null>(null);

/** Loads the host's plugins once for the Extensions tab and its detail screens. */
export function ExtensionsHostProvider(props: { readonly host: ExtensionsHost; readonly children: ReactNode }) {
  const { host } = props;
  const [plugins, setPlugins] = useState<LoadedPlugins>({ kind: 'loading' });
  const [segment, setSegment] = useState<ExtensionsSegment>('plugins');
  const [saving, setSaving] = useState<readonly string[]>([]);
  const [refused, setRefused] = useState<Readonly<Record<string, string>>>({});
  const reload = useCallback(() => {
    void host.plugins().then((result) => {
      setPlugins(result.kind === 'ok' ? { kind: 'loaded', list: result.value } : { kind: 'failed', message: result.error.message });
    });
  }, [host]);
  useEffect(reload, [reload]);
  useEffect(
    () =>
      host.onPluginChanged((entry) => {
        setPlugins((current) =>
          current.kind === 'loaded'
            ? {
                kind: 'loaded',
                list: { ...current.list, plugins: current.list.plugins.map((each) => (each.manifest.id === entry.manifest.id ? entry : each)) },
              }
            : current,
        );
      }),
    [host],
  );
  const setEnabled = useCallback(
    (pluginId: string, enabled: boolean) => {
      setSaving((current) => [...current, pluginId]);
      void host.setPluginEnabled(pluginId, enabled).then((result) => {
        setSaving((current) => current.filter((id) => id !== pluginId));
        if (result.kind === 'failed') {
          setRefused((current) => ({ ...current, [pluginId]: result.error.message }));
          return;
        }
        setRefused((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== pluginId)));
      });
    },
    [host],
  );
  const value = useMemo(
    () => ({ plugins, segment, setSegment, saving, refused, reload, setEnabled }),
    [plugins, segment, saving, refused, reload, setEnabled],
  );
  return <Context value={value}>{props.children}</Context>;
}

export function useExtensions(): ExtensionsState {
  const state = useContext(Context);
  if (state === null) throw new Error('Extensions screens need an ExtensionsHostProvider above them.');
  return state;
}
