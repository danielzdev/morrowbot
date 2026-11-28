import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync, UIImagePickerPreferredAssetRepresentationMode } from 'expo-image-picker';
import type { PickedFile } from './composer-attachments.ts';
import { cleanName, IMAGE_LONG_EDGE, IMAGE_QUALITY, jpegName, jpegUpload, routeOf, textUpload } from './picked-file.ts';

const UNREADABLE = 'The file could not be read.';

/** Re-encodes any photo (HEIC included) as a JPEG no longer than `IMAGE_LONG_EDGE`, for upload. */
async function photo(uri: string, rawName: string | null | undefined): Promise<PickedFile> {
  const name = jpegName(rawName);
  try {
    const full = await ImageManipulator.manipulate(uri).renderAsync();
    const longEdge = Math.max(full.width, full.height);
    const scaled =
      longEdge <= IMAGE_LONG_EDGE
        ? full
        : await ImageManipulator.manipulate(full)
            .resize(full.width >= full.height ? { width: IMAGE_LONG_EDGE } : { height: IMAGE_LONG_EDGE })
            .renderAsync();
    const saved = await scaled.saveAsync({ base64: true, compress: IMAGE_QUALITY, format: SaveFormat.JPEG });
    return saved.base64 === undefined ? { kind: 'refused', name, reason: UNREADABLE } : jpegUpload(name, saved.base64, saved.uri);
  } catch {
    return { kind: 'refused', name, reason: UNREADABLE };
  }
}

async function document(file: File): Promise<PickedFile> {
  const name = cleanName(file.name, 'file');
  const route = routeOf({ name, mimeType: file.type, size: file.size });
  switch (route.kind) {
    case 'refused':
      return { kind: 'refused', name, reason: route.reason };
    case 'image':
      return photo(file.uri, name);
    case 'text':
      try {
        return textUpload(name, await file.text());
      } catch {
        return { kind: 'refused', name, reason: UNREADABLE };
      }
  }
}

/** Opens the photo library for up to `limit` photos. Cancelling picks nothing. */
export async function pickPhotos(limit: number): Promise<readonly PickedFile[]> {
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1,
    preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.map((asset) => photo(asset.uri, asset.fileName)));
}

/** Opens Files for text files and images. Cancelling picks nothing. */
export async function pickFiles(): Promise<readonly PickedFile[]> {
  const result = await File.pickFileAsync({ mimeTypes: ['text/*', 'image/*', 'application/json'], multipleFiles: true });
  if (result.canceled) return [];
  return Promise.all(result.result.map(document));
}
