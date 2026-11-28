import type { AvatarShape } from './agents.ts';

/** A silhouette in open-bot-avatar's definition format: one filled path in a 0 0 100 100 viewBox and an eye pair. */
export interface AvatarOutline {
  readonly version: 1;
  readonly id: AvatarShape;
  readonly name: string;
  readonly body: { readonly path: string };
  readonly eyes: { readonly x: number; readonly y: number; readonly spacing: number; readonly scale: number };
}

const shape = (id: AvatarShape, name: string, path: string, eyes: AvatarOutline['eyes']): AvatarOutline => ({ version: 1, id, name, body: { path }, eyes });

/** Ori Bot's own silhouettes beside open-bot-avatar's starter examples: outlines wind clockwise, corners rounded. */
export const CUSTOM_AVATAR_OUTLINES: readonly AvatarOutline[] = [
  shape(
    'star',
    'Star',
    'M46.3 16Q50 10 53.7 16L62.1 29.5Q64.7 33.8 69.6 35L85 38.7Q91.8 40.4 87.3 45.7L77 57.9Q73.8 61.7 74.1 66.7L75.3 82.6Q75.9 89.6 69.4 86.9L54.6 80.9Q50 79 45.4 80.9L30.6 86.9Q24.1 89.6 24.7 82.6L25.9 66.7Q26.2 61.7 23 57.9L12.7 45.7Q8.2 40.4 15 38.7L30.4 35Q35.3 33.8 37.9 29.5Z',
    { x: 50, y: 55, spacing: 15, scale: 1.1 },
  ),
  shape(
    'cloud',
    'Cloud',
    'M27 78C17 78 10 71 10 62C10 53 17 46 26 46C28 33 38 24 51 24C62 24 70 31 73 40C83 41 90 49 90 59C90 70 82 78 72 78Z',
    { x: 50, y: 56, spacing: 17, scale: 1.2 },
  ),
  shape(
    'bolt',
    'Bolt',
    'M38.1 12.6Q40 8 45 8L73 8Q78 8 75.8 12.5L65.3 33.3Q64 36 67 36L79 36Q84 36 80.7 39.8L39.3 88.2Q36 92 37.5 87.2L45.1 62.9Q46 60 43 60L23 60Q18 60 19.9 55.4Z',
    { x: 49, y: 44, spacing: 14, scale: 1 },
  ),
  shape(
    'flame',
    'Flame',
    'M52 9Q55 7 57.5 10.5C66 22 81 34 81 57C81 77 68 90 50 90C32 90 19 77 19 60C19 49 23 39 28.5 31Q30.5 28.5 32.5 31C34.5 37 38 42 43 45C42 32 45 19 52 9Z',
    { x: 50, y: 66, spacing: 16, scale: 1.15 },
  ),
  shape(
    'heart',
    'Heart',
    'M50 28C56 16 68 12 78 16C88 20 92 32 90 43C87 60 70 74 53 87Q50 89 47 87C30 74 13 60 10 43C8 32 12 20 22 16C32 12 44 16 50 28Z',
    { x: 50, y: 46, spacing: 18, scale: 1.2 },
  ),
  shape(
    'book',
    'Book',
    'M50 26C60 18 76 16 86 19Q89 20 89 23V76Q89 79 86 78C76 75 60 76 50 84C40 76 24 75 14 78Q11 79 11 76V23Q11 20 14 19C24 16 40 18 50 26Z',
    { x: 50, y: 50, spacing: 20, scale: 1.15 },
  ),
  shape(
    'ghost',
    'Ghost',
    'M50 10C70 10 84 25 84 45V78C84 85 79 89 73 89C67 89 64 82 61 82C58 82 55 89 50 89C45 89 42 82 39 82C36 82 33 89 27 89C21 89 16 85 16 78V45C16 25 30 10 50 10Z',
    { x: 50, y: 44, spacing: 18, scale: 1.25 },
  ),
  shape(
    'shield',
    'Shield',
    'M50 10C60 15 72 17 84 17Q88 17 88 21V44C88 66 72 82 52 90Q50 91 48 90C28 82 12 66 12 44V21Q12 17 16 17C28 17 40 15 50 10Z',
    { x: 50, y: 44, spacing: 18, scale: 1.25 },
  ),
];
