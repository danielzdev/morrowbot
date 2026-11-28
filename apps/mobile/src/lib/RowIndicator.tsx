import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useReduceMotion } from './reduce-motion.ts';
import { radii, spacing, typography } from './theme.ts';
import { useTheme } from './useTheme.ts';

/**
 * What a list row flags at its end: a badge when something needs you, a dot for unread, three
 * dots while working, or nothing.
 */
export type RowIndicator =
  | { readonly kind: 'badge'; readonly label: string; readonly tone: 'warn' | 'danger' }
  | { readonly kind: 'unread' }
  | { readonly kind: 'working'; readonly label: 'Working' | 'Queued'; readonly animated: boolean }
  | { readonly kind: 'none' };

const DOT = 5;
const STEP_MS = 160;

/** Three small dots that pulse in turn; still when Reduce Motion is on or `animated` is false. */
export function WorkingDots(props: { readonly label: string; readonly animated: boolean }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const moving = props.animated && !reduceMotion;
  const phases = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!moving) return;
    const pulse = (value: Animated.Value) =>
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: STEP_MS * 2, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: STEP_MS * 2, useNativeDriver: true }),
      ]);
    const loop = Animated.loop(Animated.stagger(STEP_MS, phases.map(pulse)));
    loop.start();
    return () => {
      loop.stop();
      for (const value of phases) value.setValue(0);
    };
  }, [moving, phases]);
  return (
    <View accessible accessibilityLabel={props.label} style={styles.dots}>
      {phases.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            { backgroundColor: colors.accent },
            moving
              ? {
                  opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                  transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }],
                }
              : { opacity: props.animated ? 0.8 : 0.4 },
          ]}
        />
      ))}
    </View>
  );
}

export function RowIndicatorView(props: { readonly indicator: RowIndicator }) {
  const { colors } = useTheme();
  const { indicator } = props;
  switch (indicator.kind) {
    case 'badge': {
      const tint = indicator.tone === 'danger' ? colors.danger : colors.warn;
      return (
        <View style={[styles.badge, { borderColor: tint }]}>
          <Text numberOfLines={1} style={[typography.meta, { color: tint }]}>
            {indicator.label}
          </Text>
        </View>
      );
    }
    case 'unread':
      return <View accessible accessibilityLabel="Unread" style={[styles.unread, { backgroundColor: colors.accent }]} />;
    case 'working':
      return <WorkingDots label={indicator.label} animated={indicator.animated} />;
    case 'none':
      return null;
  }
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 16, paddingHorizontal: 2 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  badge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  unread: { width: 10, height: 10, borderRadius: 5 },
});
