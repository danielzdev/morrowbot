import { PluginList, ProviderInfoResponse, type PluginEntry, type ProviderInfo } from '@morrowbot/contracts';
import { Check, Group, GroupedScroll, LoadedNote, Row, StatusDot } from './grouped.tsx';
import type { StatusLabel } from './link-status.ts';
import { useHostGet } from './use-host-request.ts';

/** The host's provider plugins, whether each runs, and the models a ready one offers. */
export function ProvidersScreen() {
  const plugins = useHostGet('/api/plugins', PluginList);
  const providers = plugins.kind === 'ready' ? plugins.value.plugins.filter((entry) => entry.manifest.kind === 'provider') : [];
  return (
    <GroupedScroll>
      <LoadedNote loaded={plugins} empty={providers.length === 0 ? 'This host has no providers.' : null} />
      {providers.map((entry) => (
        <ProviderGroup key={entry.manifest.id} entry={entry} />
      ))}
    </GroupedScroll>
  );
}

function ProviderGroup(props: { readonly entry: PluginEntry }) {
  const { entry } = props;
  const status = pluginStatus(entry);
  return (
    <Group header={entry.manifest.name} footer={null}>
      <Row label="Status" detail={status.label} leading={<StatusDot tone={status.tone} />} trailing={null} tone="default" selected={false} onPress={null} />
      {entry.status.kind === 'running' ? <ProviderModels pluginId={entry.manifest.id} /> : null}
    </Group>
  );
}

function ProviderModels(props: { readonly pluginId: string }) {
  const info = useHostGet(`/api/plugins/${encodeURIComponent(props.pluginId)}/info`, ProviderInfoResponse);
  if (info.kind !== 'ready') return <Row label={info.kind === 'error' ? info.message : 'Loading models…'} detail={null} leading={null} trailing={null} tone="default" selected={false} onPress={null} />;
  const summary = infoSummary(info.value.info);
  if (info.value.info.kind !== 'ready') {
    return <Row label={summary} detail={null} leading={null} trailing={null} tone="default" selected={false} onPress={null} />;
  }
  return (
    <>
      <Row label="Account" detail={summary} leading={null} trailing={null} tone="default" selected={false} onPress={null} />
      {info.value.info.models.map((model) => (
        <Row key={model.id} label={model.label} detail={model.isDefault ? 'Default' : null} leading={null} trailing={model.isDefault ? <Check /> : null} tone="default" selected={false} onPress={null} />
      ))}
    </>
  );
}

function pluginStatus(entry: PluginEntry): StatusLabel {
  if (!entry.enabled) return { tone: 'muted', label: 'Turned off on the desktop' };
  switch (entry.status.kind) {
    case 'running':
      return { tone: 'ok', label: 'Running' };
    case 'starting':
      return { tone: 'warn', label: 'Starting…' };
    case 'safe-mode':
      return { tone: 'muted', label: 'Paused in safe mode' };
    case 'disabled':
    case 'stopped':
      return { tone: 'muted', label: 'Stopped' };
    case 'invalid-config':
      return { tone: 'danger', label: 'Needs settings on the desktop' };
    case 'unhealthy':
      return { tone: 'warn', label: entry.status.detail };
    case 'crashed':
      return { tone: 'danger', label: 'Crashed · restart it on the desktop' };
    case 'quarantined':
      return { tone: 'danger', label: entry.status.detail };
    case 'unsupported':
      return { tone: 'muted', label: entry.status.reason };
  }
}

function infoSummary(info: ProviderInfo): string {
  switch (info.kind) {
    case 'ready':
    case 'ready-models-later':
      return info.accountLabel ?? `Signed in · version ${info.version}`;
    case 'signed-out':
      return 'Signed out · sign in on the desktop';
    case 'missing-runtime':
      return 'Not installed on the host';
    case 'outdated':
      return `Version ${info.found} is too old (needs ${info.supported})`;
    case 'error':
      return info.message;
  }
}
