import type { Agent, AgentInstructionsView } from '@morrowbot/contracts';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { useChatHub } from './chat-context.tsx';
import { AgentAvatar } from './ChatTitle.tsx';
import { useAgentModel } from './ModelEffortPill.tsx';
import { Row, Section } from './sheet-parts.tsx';
import { useStore, type Loadable } from './store.ts';

const ACCESS_WORDS: Readonly<Record<'read-only' | 'workspace-write' | 'full', string>> = {
  'read-only': 'Read only',
  'workspace-write': 'Can edit its folder',
  full: 'Full access',
};

type ExtensionProblem =
  | { readonly kind: 'conflict'; readonly current: Agent }
  | { readonly kind: 'refused'; readonly message: string };

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
}

/** The first few lines of the agent's `SOUL.md`, as a summary. */
function summary(view: Loadable<AgentInstructionsView>): string {
  switch (view.kind) {
    case 'loading':
      return 'Loading…';
    case 'failed':
      return view.message;
    case 'loaded': {
      const lines = (view.value.content ?? '').split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).filter(Boolean);
      return lines.length === 0 ? 'No instructions yet.' : lines.slice(0, 3).join(' · ');
    }
  }
}

function ExtensionToggles(props: { readonly agent: Agent }) {
  const { agent } = props;
  const hub = useChatHub();
  const { colors } = useTheme();
  const plugins = useStore(hub.plugins);
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingAll, setSavingAll] = useState<readonly string[]>([]);
  const [problems, setProblems] = useState<Readonly<Record<string, ExtensionProblem>>>({});
  useEffect(() => {
    setProblems({});
  }, [agent.id]);
  if (plugins.kind !== 'loaded') return <Row label={plugins.kind === 'loading' ? 'Loading…' : plugins.message} />;
  const tools = plugins.value.filter(({ manifest }) => manifest.kind === 'tool');
  if (tools.length === 0) return <Row label="No extensions installed" />;

  const toggleForAgent = (pluginId: string, enabled: boolean): void => {
    setSavingAgent(true);
    setProblems((now) => withoutKey(now, pluginId));
    void hub.setAgentExtension(agent, pluginId, enabled).then((result) => {
      setSavingAgent(false);
      if (result.kind === 'ok') return;
      setProblems((now) => ({
        ...now,
        [pluginId]:
          result.error.kind === 'agent-conflict'
            ? { kind: 'conflict', current: result.error.current }
            : { kind: 'refused', message: result.error.message },
      }));
    });
  };

  const toggleForAll = (pluginId: string, enabled: boolean): void => {
    setSavingAll((now) => [...now, pluginId]);
    setProblems((now) => withoutKey(now, pluginId));
    void hub.setPluginEnabled(pluginId, enabled).then((result) => {
      setSavingAll((now) => now.filter((id) => id !== pluginId));
      if (result.kind === 'failed') {
        setProblems((now) => ({ ...now, [pluginId]: { kind: 'refused', message: result.error.message } }));
      }
    });
  };

  const reloadRow = (pluginId: string): void => {
    const problem = problems[pluginId];
    if (problem?.kind === 'conflict') {
      const adopted = problem.current;
      hub.adoptAgent(adopted);
      setProblems((now) =>
        Object.fromEntries(
          Object.entries(now).filter(([key, each]) => key !== pluginId && !(each.kind === 'conflict' && each.current.revision <= adopted.revision)),
        ),
      );
      return;
    }
    setProblems((now) => withoutKey(now, pluginId));
  };

  return tools.map((entry) => {
    const id = entry.manifest.id;
    const problem = problems[id];
    const conflicted = problem?.kind === 'conflict';
    const agentEnabled = entry.enabled && !agent.disabledExtensions.includes(id);
    return (
      <View key={id} style={[styles.extRow, { borderColor: colors.hairline }]}>
        <View style={styles.extTop}>
          <View style={styles.extLabel}>
            <Text numberOfLines={1} style={[typography.body, { color: entry.enabled ? colors.text1 : colors.text3 }]}>
              {entry.manifest.name}
            </Text>
            {entry.enabled ? null : <Text style={[typography.small, { color: colors.text3 }]}>Off for all agents</Text>}
          </View>
          <View style={styles.extSwitches}>
            <View style={styles.switchCol}>
              <Text style={[typography.meta, { color: colors.text3 }]}>This agent</Text>
              <Switch
                accessibilityLabel={`${entry.manifest.name} for ${agent.name}`}
                value={agentEnabled}
                disabled={!entry.enabled || savingAgent || conflicted}
                trackColor={{ true: colors.accent }}
                onValueChange={(enabled) => {
                  toggleForAgent(id, enabled);
                }}
              />
            </View>
            <View style={styles.switchCol}>
              <Text style={[typography.meta, { color: colors.text3 }]}>All agents</Text>
              <Switch
                accessibilityLabel={`${entry.manifest.name} for all agents`}
                value={entry.enabled}
                disabled={savingAll.includes(id)}
                trackColor={{ true: colors.accent }}
                onValueChange={(enabled) => {
                  toggleForAll(id, enabled);
                }}
              />
            </View>
          </View>
        </View>
        {problem?.kind === 'conflict' ? (
          <View style={styles.conflictBar}>
            <Text style={[typography.small, styles.grow, { color: colors.warn }]}>Changed elsewhere.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                reloadRow(id);
              }}
              style={[styles.reloadBtn, { backgroundColor: colors.accentSoft }]}
            >
              <Text style={[typography.small, styles.reloadText, { color: colors.accent }]}>Reload row</Text>
            </Pressable>
          </View>
        ) : null}
        {problem?.kind === 'refused' ? <Text style={[typography.small, { color: colors.danger }]}>{problem.message}</Text> : null}
      </View>
    );
  });
}

type SheetTab = 'settings' | 'panels';
const SHEET_TABS: readonly SheetTab[] = ['settings', 'panels'];

/** The Agent Settings sheet: name, model and effort, instructions, extensions, and reset or delete. */
export function AgentSettingsSheet(props: {
  readonly agent: Agent;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const hub = useChatHub();
  const { colors } = useTheme();
  const { agent } = props;
  const model = useAgentModel(agent);
  const [name, setName] = useState(agent.name);
  const [tab, setTab] = useState<SheetTab>('settings');
  const [instructions, setInstructions] = useState<Loadable<AgentInstructionsView>>({ kind: 'loading' });
  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);
  useEffect(() => {
    if (!props.visible) return;
    void hub.host.instructions(agent.id).then((result) => {
      setInstructions(result.kind === 'ok' ? { kind: 'loaded', value: result.value } : { kind: 'failed', message: result.error.message });
    });
  }, [hub, agent.id, props.visible]);
  const saveName = (): void => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === agent.name) {
      setName(agent.name);
      return;
    }
    void hub.updateAgent(agent.id, { name: trimmed });
  };
  const binding = agent.provider;
  const confirmDelete = (): void => {
    Alert.alert(`Delete ${agent.name}?`, 'Its chats are deleted from the host too. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void hub.host.deleteAgent(agent.id).then(async (result) => {
            if (result.kind === 'failed') {
              Alert.alert('Could not delete', result.error.message);
              return;
            }
            await hub.refreshAgents();
            props.onDeleted();
          }),
      },
    ]);
  };
  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={[styles.sheet, { backgroundColor: colors.surface1 }]}>
        <View style={styles.header}>
          <AgentAvatar agent={agent} />
          <Text numberOfLines={1} style={[typography.title, styles.grow, { color: colors.text1 }]}>Agent Settings</Text>
          <Pressable accessibilityRole="button" onPress={props.onClose} hitSlop={8}>
            <Text style={[typography.body, styles.done, { color: colors.accent }]}>Done</Text>
          </Pressable>
        </View>
        <View style={[styles.tabs, { backgroundColor: colors.hover }]}>
          {SHEET_TABS.map((each) => (
            <Pressable
              key={each}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === each }}
              onPress={() => {
                setTab(each);
              }}
              style={[styles.tab, tab === each && { backgroundColor: colors.surface3 }]}
            >
              <Text style={[typography.small, styles.tabText, { color: tab === each ? colors.text1 : colors.text3 }]}>
                {each === 'settings' ? 'Settings' : 'Panels'}
              </Text>
            </Pressable>
          ))}
        </View>
        {tab === 'panels' ? (
          <Text style={[typography.ui, styles.panels, { color: colors.text3 }]}>Panels are on desktop.</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Section title="Agent">
              <Row label="Name">
                <TextInput
                  accessibilityLabel="Agent name"
                  value={name}
                  onChangeText={setName}
                  onEndEditing={saveName}
                  returnKeyType="done"
                  style={[typography.body, styles.nameInput, { color: colors.text1 }]}
                />
              </Row>
            </Section>
            <Section title="Model">
              <Row label="Model & effort" value={model.label} {...(model.choose === null ? {} : { onPress: model.choose })} />
              <Row label="Access" value={binding.kind === 'bound' ? ACCESS_WORDS[binding.access] : 'No provider'} />
            </Section>
            <Section title="Instructions" footer="Edit instructions on your computer.">
              <Row label={summary(instructions)} />
            </Section>
            <Section title="Extensions" footer="Toggle an extension for this agent only, or turn it off for all agents.">
              <ExtensionToggles agent={agent} />
            </Section>
            <Section title="Reset">
              {binding.kind === 'bound' ? (
                <Row
                  label="Use the provider’s default model"
                  tone="accent"
                  onPress={() => void hub.updateAgent(agent.id, { provider: { ...binding, selection: { kind: 'default' } } })}
                />
              ) : null}
              <Row label="Delete agent" tone="danger" onPress={confirmDelete} />
            </Section>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4] },
  grow: { flex: 1 },
  done: { fontWeight: '600' },
  tabs: { flexDirection: 'row', marginHorizontal: spacing[4], borderRadius: radii.md, padding: 2 },
  tab: { flex: 1, minHeight: 32, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontWeight: '600' },
  panels: { textAlign: 'center', marginTop: spacing[8] },
  body: { padding: spacing[4], gap: spacing[6], paddingBottom: spacing[8] },
  nameInput: { flex: 1, textAlign: 'right' },
  extRow: { paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth },
  extTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  extLabel: { flex: 1, gap: 2 },
  extSwitches: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  switchCol: { alignItems: 'center', gap: spacing[1] },
  conflictBar: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  reloadBtn: { minHeight: 32, paddingHorizontal: spacing[3], borderRadius: radii.pill, justifyContent: 'center' },
  reloadText: { fontWeight: '600' },
});
