import type { Attachment } from '@morrowbot/contracts';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { sizeLabel } from './AttachmentStrip.tsx';

/** The files a sent message carried, as chips above its bubble. */
export function SentAttachments(props: { readonly attachments: readonly Attachment[] }) {
  const { colors } = useTheme();
  if (props.attachments.length === 0) return null;
  return (
    <View style={styles.row}>
      {props.attachments.map((attachment) => (
        <View
          key={attachment.id}
          accessible
          accessibilityLabel={`${attachment.kind === 'image' ? 'Photo' : 'File'} ${attachment.name}, ${sizeLabel(attachment.size)}`}
          style={[styles.chip, { backgroundColor: colors.surfaceUser, borderColor: colors.hairlineStrong }]}
        >
          <SymbolView name={attachment.kind === 'image' ? 'photo' : 'doc.text'} size={14} tintColor={colors.text2} />
          <Text numberOfLines={1} style={[typography.small, styles.name, { color: colors.text1 }]}>{attachment.name}</Text>
          <Text style={[typography.meta, { color: colors.text3 }]}>{sizeLabel(attachment.size)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'flex-end', maxWidth: '85%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing[3], paddingVertical: spacing[2], maxWidth: '100%' },
  name: { flexShrink: 1 },
});
