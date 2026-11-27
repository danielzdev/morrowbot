import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text } from 'react-native';
import { GlassSurface } from '../../lib/GlassSurface.tsx';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';

/** The floating Search pill at the bottom of the unfolded sidebar. */
export function SearchPill(props: { readonly bottom: number; readonly onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel="Search"
      onPress={props.onPress}
      style={[styles.anchor, { bottom: props.bottom }]}
    >
      <GlassSurface interactive style={styles.pill}>
        <SymbolView name="magnifyingglass" size={18} tintColor={theme.colors.text2} />
        <Text style={[typography.ui, { color: theme.colors.text3 }]}>Search</Text>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: spacing[3], right: spacing[3] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    height: 48,
    paddingHorizontal: spacing[4],
    borderRadius: radii.pill,
  },
});
