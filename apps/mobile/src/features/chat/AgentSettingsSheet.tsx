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

/** The first few lines of the agent's `AGENTS.md`, as a summary. */
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

function ExtensionToggles() {
  const hub = useChatHub();
  const { colors } = useTheme();
  const plugins = useStore(hub.plugins);
  if (plugins.kind !== 'loaded') return <Row label={plugins.kind === 'loading' ? 'Loading…' : plugins.message} />;
  const tools = plugins.value.filter(({ manifest }) => manifest.kind === 'tool');
  if (tools.length === 0) return <Row label="No extensions installed" />;
  return tools.map((entry) => (
    <Row key={entry.manifest.id} label={entry.manifest.name}>
      <View style={styles.grow} />
      <Switch
        accessibilityLabel={`${entry.manifest.name} on`}
        value={entry.enabled}
        trackColor={{ true: colors.accent }}
        onValueChange={(enabled) => void hub.setPluginEnabled(entry.manifest.id, enabled)}
      />
    </Row>
  ));
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
            <Section title="Extensions" footer="Turning an extension off turns it off for every agent.">
              <ExtensionToggles />
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
});
