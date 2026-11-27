import { StyleSheet, Text, View } from 'react-native';
import { typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';

/** The detail column before anything is selected. */
export function EmptyDetail() {
  const theme = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.surface0 }]}>
      <Text style={[typography.ui, { color: theme.colors.text3 }]}>Nothing selected</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
