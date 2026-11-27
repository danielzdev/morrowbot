import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';

export interface LayoutMetricsChangeEvent {
  /** Untrusted until parsed with `parseNativeLayoutMetrics`. */
  readonly nativeEvent: unknown;
}

export interface MorrowLayoutMetricsViewProps extends ViewProps {
  readonly onMetricsChange: (event: LayoutMetricsChangeEvent) => void;
}

/** Invisible view reporting size classes, hinge and reserved-region geometry. iOS only. */
export const MorrowLayoutMetricsView = requireNativeView<MorrowLayoutMetricsViewProps>(
  'MorrowNativeControls',
  'MorrowLayoutMetricsView',
);
