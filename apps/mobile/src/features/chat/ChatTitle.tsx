import type { Agent } from '@morrowbot/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { BotAvatar } from '../../lib/bot-avatar/index.ts';
import { AVATAR_SIZE, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { DetailRoute } from '../../lib/workspace.ts';
import { useChatHub } from './chat-context.tsx';
import { useAgentModel } from './ModelEffortPill.tsx';
import { useStore } from './store.ts';

/** "Studio Host · Claude / Opus · Medium". */
function Subtitle(props: { readonly agent: Agent }) {
  const { colors } = useTheme();
  const hub = useChatHub();
  const plugins = useStore(hub.plugins);
  const { pick, label } = useAgentModel(props.agent);
  const binding = props.agent.provider;
  const provider =
    binding.kind === 'bound' && plugins.kind === 'loaded'
      ? (plugins.value.find(({ manifest }) => manifest.id === binding.pluginId)?.manifest.name ?? binding.pluginId)
      : null;
  const parts = [hub.host.hostName, provider === null ? label : `${provider} / ${pick === null ? label : pick.model.label}`];
  return (
    <Text numberOfLines={1} style={[typography.small, { color: colors.text3 }]}>
      {parts.join(' · ')}
    </Text>
  );
}

/** The chat header: agent avatar, name, and where it runs. */
export function ChatTitle(props: { readonly route: DetailRoute<'chat'> }) {
  const { colors } = useTheme();
  const agents = useStore(useChatHub().agents);
  const agent = agents.kind === 'loaded' ? agents.value.find(({ id }) => id === props.route.agentId) : undefined;
  if (agent === undefined) {
    return <Text style={[typography.title, { color: colors.text3 }]}>{agents.kind === 'loading' ? 'Loading…' : 'Agent not found'}</Text>;
  }
  return (
    <View style={styles.row}>
      <BotAvatar avatar={agent.avatar} size={AVATAR_SIZE} />
      <View style={styles.text}>
        <Text numberOfLines={1} style={[typography.title, { color: colors.text1 }]}>{agent.name}</Text>
        <Subtitle agent={agent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  text: { flex: 1 },
});
