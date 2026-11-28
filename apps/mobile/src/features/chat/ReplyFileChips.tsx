import type { ReplyAttachment } from '@morrowbot/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { chipMeta } from './reply-file-chips.ts';

/** The files an agent attached to its reply, as name chips. Opening them on the phone is a later step; the desktop app shows them inline. */
export function ReplyFileChips(props: { readonly attachments: readonly ReplyAttachment[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {props.attachments.map((attachment) => (
        <View
          key={attachment.id}
          accessible
          accessibilityLabel={`${attachment.name}, ${chipMeta(attachment)}`}
          style={[styles.chip, { backgroundColor: colors.surface2, borderColor: colors.hairlineStrong }]}
        >
          <Text numberOfLines={1} style={[typography.ui, styles.name, { color: colors.text1 }]}>{attachment.name}</Text>
          <Text style={[typography.meta, { color: colors.text3 }]}>{chipMeta(attachment)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: { maxWidth: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, paddingHorizontal: spacing[3], paddingVertical: spacing[2], gap: 2 },
  name: { fontWeight: '600' },
});
