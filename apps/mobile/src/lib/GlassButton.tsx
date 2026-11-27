import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';
import { GlassSurface } from './GlassSurface.tsx';
import type { MorrowSymbol } from './symbols.ts';
import { useTheme } from './useTheme.ts';

/** A circular Liquid Glass button showing one SF Symbol. */
export function GlassButton(props: {
  readonly symbol: MorrowSymbol;
  readonly label: string;
  readonly size: number;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const { size } = props;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={props.label} onPress={props.onPress} hitSlop={4}>
      <GlassSurface
        interactive
        style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
      >
        <SymbolView name={props.symbol} size={size * 0.42} tintColor={theme.colors.text1} />
      </GlassSurface>
    </Pressable>
  );
}
