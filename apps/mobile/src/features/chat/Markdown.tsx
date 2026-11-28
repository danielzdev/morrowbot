import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { parseMarkdown, type Block, type Inline } from './markdown.ts';

const MONO = 'Menlo';

function Runs(props: { readonly inline: readonly Inline[] }) {
  const { colors } = useTheme();
  return props.inline.map((run, index) => {
    const key = `${String(index)}-${run.kind}`;
    switch (run.kind) {
      case 'text':
        return run.text;
      case 'strong':
        return <Text key={key} style={styles.strong}>{run.text}</Text>;
      case 'em':
        return <Text key={key} style={styles.em}>{run.text}</Text>;
      case 'code':
        return <Text key={key} style={[styles.inlineCode, { backgroundColor: colors.surface3, color: colors.text1 }]}>{run.text}</Text>;
    }
  });
}

function BlockView(props: { readonly block: Block }) {
  const { colors } = useTheme();
  const { block } = props;
  const body = [typography.body, { color: colors.text1 }];
  switch (block.kind) {
    case 'paragraph':
      return <Text style={body}><Runs inline={block.inline} /></Text>;
    case 'heading':
      return (
        <Text accessibilityRole="header" style={[block.level === 1 ? typography.title : styles.subheading, { color: colors.text1 }]}>
          <Runs inline={block.inline} />
        </Text>
      );
    case 'quote':
      return (
        <View style={[styles.quote, { borderColor: colors.accent }]}>
          <Text style={[typography.body, { color: colors.text2 }]}><Runs inline={block.inline} /></Text>
        </View>
      );
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={String(index)} style={styles.item}>
              <Text style={[body, styles.marker, { color: colors.text3 }]}>{block.ordered ? `${String(index + 1)}.` : '•'}</Text>
              <Text style={[body, styles.itemText]}><Runs inline={item} /></Text>
            </View>
          ))}
        </View>
      );
    case 'code':
      return (
        <View style={[styles.code, { backgroundColor: colors.surface2, borderColor: colors.hairline }]}>
          {block.language === '' ? null : (
            <Text style={[typography.meta, { color: colors.text3 }]}>{block.language}</Text>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={[styles.codeText, { color: colors.text1 }]}>{block.text}</Text>
          </ScrollView>
        </View>
      );
  }
}

/** A reply's markdown. Re-parsed on each delta, which stays cheap at chat lengths. */
export function Markdown(props: { readonly text: string }) {
  return (
    <View style={styles.stack}>
      {parseMarkdown(props.text).map((block, index) => (
        <BlockView key={`${String(index)}-${block.kind}`} block={block} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing[2] },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  inlineCode: { fontFamily: MONO, fontSize: 15 },
  subheading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  quote: { borderLeftWidth: 3, paddingLeft: spacing[3] },
  list: { gap: spacing[1] },
  item: { flexDirection: 'row', gap: spacing[2] },
  marker: { minWidth: 18 },
  itemText: { flex: 1 },
  code: { borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing[3], gap: spacing[1] },
  codeText: { fontFamily: MONO, fontSize: 14, lineHeight: 20 },
});
