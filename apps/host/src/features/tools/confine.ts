import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export type Confined = { readonly kind: 'inside'; readonly path: string } | { readonly kind: 'outside' };

/**
 * Resolves `requested` against `root` and checks that it, and every symlink on the way to it, stays inside `root`.
 * The target itself may not exist yet. A dangling symlink counts as outside.
 */
export async function confine(root: string, requested: string): Promise<Confined> {
  const realRoot = await realpath(root);
  const target = path.resolve(realRoot, requested);
  if (!isInside(realRoot, target)) return { kind: 'outside' };
  const existing = await nearestExisting(target);
  let realExisting: string;
  try {
    realExisting = await realpath(existing);
  } catch (error) {
    if (isMissing(error)) return { kind: 'outside' };
    throw error;
  }
  if (!isInside(realRoot, realExisting)) return { kind: 'outside' };
  return { kind: 'inside', path: path.join(realExisting, path.relative(existing, target)) };
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function nearestExisting(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current || !isMissing(error)) throw error;
      current = parent;
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}
