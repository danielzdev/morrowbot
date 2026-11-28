import { useEffect, useState, type RefObject } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, type KeyboardEvent, type ViewInstance } from 'react-native';

/**
 * How many points of `view`'s bottom edge the keyboard covers, measured in the window, so it holds in a split
 * column under a header as well as full screen. Changes animate in step with the keyboard.
 */
export function useKeyboardOverlap(view: RefObject<ViewInstance | null>): number {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    const animate = (event: KeyboardEvent): void => {
      const duration = Math.max(event.duration, 10);
      LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types[event.easing] } });
    };
    const follow = (event: KeyboardEvent): void => {
      const { screenY, height } = event.endCoordinates;
      const keyboardTop = screenY > 0 ? screenY : Dimensions.get('window').height - height;
      view.current?.measureInWindow((_x, y, _width, viewHeight) => {
        animate(event);
        setOverlap(Math.max(0, y + viewHeight - keyboardTop));
      });
    };
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', follow),
      Keyboard.addListener('keyboardWillChangeFrame', follow),
      Keyboard.addListener('keyboardWillHide', (event) => {
        animate(event);
        setOverlap(0);
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [view]);
  return overlap;
}
