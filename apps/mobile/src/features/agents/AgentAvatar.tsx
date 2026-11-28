import type { AgentAvatar as Avatar } from '@morrowbot/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { AVATAR_SIZE } from '../../lib/theme.ts';

/** Up to two letters from the agent's name: "Errand Bot" → "EB". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

/** The 44pt circle in the agent's colour. */
export function AgentAvatar(props: { readonly name: string; readonly avatar: Avatar }) {
  return (
    <View style={[styles.circle, { backgroundColor: props.avatar.color }]}>
      <Text style={styles.letters}>{initials(props.name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letters: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
