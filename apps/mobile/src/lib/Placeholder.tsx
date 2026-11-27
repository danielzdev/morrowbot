import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from './theme.ts';
import { useTheme } from './useTheme.ts';
import type { DetailRoute, WorkspaceNavigation } from './workspace.ts';

/**
 * Stand-in screens for slices that have not landed yet. Each feature slice replaces its own use
 * of these; nothing here is meant to survive Wave 2.
 */

export interface PlaceholderRow {
  readonly label: string;
  readonly detail: string;
  readonly route: DetailRoute;
}

function sameRoute(a: DetailRoute | null, b: DetailRoute): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function PlaceholderList(props: {
  readonly title: string;
  readonly rows: readonly PlaceholderRow[];
  readonly selected: DetailRoute | null;
  readonly navigation: WorkspaceNavigation;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={[typography.largeTitle, { color: colors.text1 }]}>{props.title}</Text>
      {props.rows.map((row) => (
        <Pressable
          key={row.label}
          accessibilityRole="button"
          onPress={() => {
            props.navigation.open(row.route);
          }}
          style={[styles.row, sameRoute(props.selected, row.route) && { backgroundColor: colors.selected }]}
        >
          <Text style={[typography.body, { color: colors.text1 }]}>{row.label}</Text>
          <Text style={[typography.small, { color: colors.text3 }]}>{row.detail}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function PlaceholderTitle(props: { readonly title: string; readonly subtitle: string }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[typography.title, { color: colors.text1 }]} numberOfLines={1}>
        {props.title}
      </Text>
      <Text style={[typography.small, { color: colors.text3 }]} numberOfLines={1}>
        {props.subtitle}
      </Text>
    </View>
  );
}

export function PlaceholderBody(props: { readonly text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.body}>
      <Text style={[typography.ui, { color: colors.text3, textAlign: 'center' }]}>{props.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing[4], gap: spacing[1], paddingBottom: 96 },
  row: { paddingVertical: spacing[3], paddingHorizontal: spacing[3], borderRadius: radii.md },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
});
