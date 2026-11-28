import { ActionSheetIOS, Alert } from 'react-native';
import type { AttachmentTray } from './composer-attachments.ts';
import { pickFiles, pickPhotos } from './pick-files.ts';

const CHOICES = ['Photo Library', 'Files', 'Cancel'] as const;

/** The composer `+`: choose Photo Library or Files, then upload what was picked (at most `room` photos). */
export function openAttachMenu(tray: AttachmentTray, room: number): void {
  ActionSheetIOS.showActionSheetWithOptions({ options: [...CHOICES], cancelButtonIndex: CHOICES.length - 1 }, (index) => {
    const pick = index === 0 ? () => pickPhotos(room) : index === 1 ? pickFiles : null;
    if (pick === null) return;
    tray.pickFrom(pick).catch(
      () => {
        Alert.alert('Could not open', index === 0 ? 'Ori Bot could not open your photos.' : 'Ori Bot could not open Files.');
      },
    );
  });
}
