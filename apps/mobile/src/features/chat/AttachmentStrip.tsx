import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { ComposerAttachment } from './composer-attachments.ts';

const THUMB = 40;

/** "24 KB", "1.2 MB": a file's size as the strip and chat show it. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nameOf(item: ComposerAttachment): string {
  switch (item.kind) {
    case 'uploading':
    case 'refused':
      return item.name;
    case 'ready':
      return item.attachment.name;
    case 'failed':
      return item.request.name;
  }
}

function previewOf(item: ComposerAttachment): string | null {
  return item.kind === 'refused' ? null : item.preview;
}

function Tile(props: { readonly item: ComposerAttachment; readonly onRetry: () => void; readonly onRemove: () => void }) {
  const { colors } = useTheme();
  const { item } = props;
  const name = nameOf(item);
  const preview = previewOf(item);
  const problem = item.kind === 'failed' || item.kind === 'refused';
  const status =
    item.kind === 'uploading'
      ? 'Uploading…'
      : item.kind === 'ready'
        ? sizeLabel(item.attachment.size)
        : item.kind === 'failed'
          ? 'Not uploaded · Tap to retry'
          : item.reason;
  return (
    <View style={[styles.tile, { backgroundColor: colors.surface3, borderColor: problem ? colors.danger : colors.hairlineStrong }]}>
      <Pressable
        accessibilityRole={item.kind === 'failed' ? 'button' : undefined}
        accessibilityLabel={`${name}, ${status}`}
        accessibilityHint={item.kind === 'failed' ? `${item.reason} Tap to upload it again.` : undefined}
        disabled={item.kind !== 'failed'}
        onPress={props.onRetry}
        style={styles.body}
      >
        <View style={[styles.thumb, { backgroundColor: colors.selected }]}>
          {preview === null ? (
            <SymbolView name={problem ? 'exclamationmark.triangle' : 'doc.text'} size={18} tintColor={problem ? colors.danger : colors.text2} />
          ) : (
            <Image source={{ uri: preview }} style={styles.image} />
          )}
          {item.kind === 'uploading' ? (
            <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.scrim }]}>
              <ActivityIndicator size="small" color={colors.text1} />
            </View>
          ) : null}
        </View>
        <View style={styles.text}>
          <Text numberOfLines={1} style={[typography.small, { color: colors.text1 }]}>{name}</Text>
          <Text numberOfLines={1} style={[typography.meta, { color: problem ? colors.danger : colors.text3 }]}>{status}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
        hitSlop={8}
        onPress={props.onRemove}
        style={({ pressed }) => [styles.remove, { backgroundColor: pressed ? colors.hairlineStrong : colors.selected }]}
      >
        <SymbolView name="xmark" size={10} weight="bold" tintColor={colors.text2} />
      </Pressable>
    </View>
  );
}

/** The removable tiles above the message box: each file uploading, uploaded, or why it is not. */
export function AttachmentStrip(props: {
  readonly items: readonly ComposerAttachment[];
  readonly onRetry: (key: number) => void;
  readonly onRemove: (key: number) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {props.items.map((item) => (
        <Tile
          key={item.key}
          item={item}
          onRetry={() => {
            props.onRetry(item.key);
          }}
          onRemove={() => {
            props.onRemove(item.key);
          }}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing[2], paddingTop: spacing[1] },
  tile: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.lg, padding: spacing[1], paddingRight: spacing[2], gap: spacing[2], maxWidth: 230 },
  body: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 1 },
  thumb: { width: THUMB, height: THUMB, borderRadius: radii.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: THUMB, height: THUMB },
  center: { alignItems: 'center', justifyContent: 'center' },
  text: { flexShrink: 1, maxWidth: 140 },
  remove: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
