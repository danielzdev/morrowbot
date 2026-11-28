import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** iOS Settings › Accessibility › Reduce Motion, following changes while the app runs. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (live) setReduce(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}
