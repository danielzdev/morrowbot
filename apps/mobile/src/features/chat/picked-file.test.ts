import { MAX_TEXT_FILE_BYTES } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { jpegName, jpegUpload, routeOf, textUpload } from './picked-file.ts';

it('reads photos and text files, and refuses other files and text files over 256 KB before reading them', () => {
  const files = [
    { name: 'IMG_0001.HEIC', mimeType: 'image/heic', size: 3_000_000 },
    { name: 'scan.png', mimeType: '', size: null },
    { name: 'notes.md', mimeType: '', size: 120 },
    { name: 'data.json', mimeType: 'application/json', size: 40 },
    { name: 'huge.log', mimeType: 'text/plain', size: MAX_TEXT_FILE_BYTES + 1 },
    { name: 'report.pdf', mimeType: 'application/pdf', size: 5000 },
  ];
  expect(Object.fromEntries(files.map((file) => [file.name, routeOf(file)]))).toEqual({
    'IMG_0001.HEIC': { kind: 'image' },
    'scan.png': { kind: 'image' },
    'notes.md': { kind: 'text' },
    'data.json': { kind: 'text' },
    'huge.log': { kind: 'refused', reason: 'Text files can be up to 256 KB.' },
    'report.pdf': { kind: 'refused', reason: 'Only photos and text files can be attached.' },
  });
});

it('names re-encoded photos .jpg and keeps names the host takes', () => {
  expect([jpegName('IMG_0001.HEIC'), jpegName(null), jpegName('a/b.png'), jpegName(`${'x'.repeat(300)}.png`).length]).toEqual([
    'IMG_0001.jpg',
    'photo.jpg',
    'a_b.jpg',
    255,
  ]);
});

it('refuses text past 256 KB of UTF-8, binary content, and JPEGs over 8 MB once read', () => {
  const kinds = [
    textUpload('ok.md', 'hello'),
    textUpload('wide.txt', 'é'.repeat(MAX_TEXT_FILE_BYTES / 2 + 1)),
    textUpload('blob.txt', 'PK\0\u0003'),
    jpegUpload('big.jpg', 'A'.repeat(Math.ceil((8 * 1024 * 1024 * 4) / 3) + 8), 'file:///big.jpg'),
  ].map((file) => (file.kind === 'upload' ? 'upload' : file.reason));
  expect(kinds).toEqual(['upload', 'Text files can be up to 256 KB.', 'This file is not text.', 'Images can be up to 8 MB.']);
});
