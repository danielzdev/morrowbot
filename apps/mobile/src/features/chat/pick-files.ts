import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync, UIImagePickerPreferredAssetRepresentationMode } from 'expo-image-picker';
import type { Pick, PickedFile } from './composer-attachments.ts';
import { cleanName, IMAGE_LONG_EDGE, IMAGE_QUALITY, jpegName, jpegUpload, routeOf, textUpload } from './picked-file.ts';

const UNREADABLE = 'The file could not be read.';

/** Re-encodes any photo (HEIC included) as a JPEG no longer than `IMAGE_LONG_EDGE`, downsampled while decoding. */
async function photo(uri: string, name: string): Promise<PickedFile> {
  const context = ImageManipulator.manipulate(uri, { maxWidth: IMAGE_LONG_EDGE, maxHeight: IMAGE_LONG_EDGE });
  try {
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({ base64: true, compress: IMAGE_QUALITY, format: SaveFormat.JPEG });
      return saved.base64 === undefined ? { kind: 'refused', name, reason: UNREADABLE } : jpegUpload(name, saved.base64, saved.uri);
    } finally {
      image.release();
    }
  } catch {
    return { kind: 'refused', name, reason: UNREADABLE };
  } finally {
    context.release();
  }
}

/** A file from Files. iOS gives no type for some extensions, so a missing one reads as empty. */
function document(file: File): Pick {
  const name = cleanName(file.name, 'file');
  const route = routeOf({ name, mimeType: typeof file.type === 'string' ? file.type : '', size: file.size });
  switch (route.kind) {
    case 'refused':
      return { kind: 'refused', name, reason: route.reason };
    case 'image':
      return { kind: 'file', name: jpegName(name), preview: file.uri, read: () => photo(file.uri, jpegName(name)) };
    case 'text':
      return {
        kind: 'file',
        name,
        preview: null,
        read: async () => {
          try {
            return textUpload(name, await file.text());
          } catch {
            return { kind: 'refused', name, reason: UNREADABLE };
          }
        },
      };
  }
}

/** Opens the photo library for up to `limit` photos. Cancelling picks nothing. */
export async function pickPhotos(limit: number): Promise<readonly Pick[]> {
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Current,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => {
    const name = jpegName(asset.fileName);
    return { kind: 'file', name, preview: asset.uri, read: () => photo(asset.uri, name) };
  });
}

/** Opens Files on every file type; ones the host can't take come back as refused tiles that say why. Cancelling picks nothing. */
export async function pickFiles(): Promise<readonly Pick[]> {
  const result = await File.pickFileAsync({ mimeTypes: ['*/*'], multipleFiles: true });
  if (result.canceled) return [];
  return result.result.map(document);
}
