import type { AgentAvatar as Avatar } from '@morrowbot/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { AVATAR_SIZE } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';

/** Up to two letters from the agent's name: "Errand Bot" → "EB". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

/** The 44pt circle in the agent's colour, with a status dot at its corner when one is given. */
export function AgentAvatar(props: { readonly name: string; readonly avatar: Avatar; readonly dot: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={styles.frame}>
      <View style={[styles.circle, { backgroundColor: props.avatar.color }]}>
        <Text style={styles.letters}>{initials(props.name)}</Text>
      </View>
      {props.dot === null ? null : (
        <View style={[styles.dot, { backgroundColor: props.dot, borderColor: colors.surface1 }]} />
      )}
    </View>
  );
}

const DOT = 14;

const styles = StyleSheet.create({
  frame: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  circle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letters: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
  },
});
