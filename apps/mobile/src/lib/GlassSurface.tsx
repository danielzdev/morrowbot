import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './useTheme.ts';

const liquidGlass = isLiquidGlassAvailable();

/** Native Liquid Glass where the OS has it, a translucent matte fill otherwise. */
export function GlassSurface(props: {
  readonly style?: StyleProp<ViewStyle>;
  readonly interactive?: boolean;
  readonly children?: ReactNode;
}) {
  const theme = useTheme();
  if (liquidGlass) {
    return (
      <GlassView
        style={props.style}
        glassEffectStyle="regular"
        tintColor={theme.glass.tint}
        isInteractive={props.interactive ?? false}
        colorScheme={theme.scheme}
      >
        {props.children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        { backgroundColor: theme.glass.fallbackFill, borderColor: theme.glass.fallbackEdge, borderWidth: 1 },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}
