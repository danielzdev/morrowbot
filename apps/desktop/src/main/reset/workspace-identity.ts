import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Agent workspaces as the disk knows them, read afresh at every check: the device and inode of each existing
 * workspace, and of every folder above it, both as named and where it leads now (through any link, and from its
 * nearest existing folder while it does not exist yet). Comparing these, not path strings, catches every other
 * name for the same folder: `/System/Volumes/Data/Users/…` for `/Users/…`, a second mount, any spelling.
 */
export interface WorkspaceIds {
  readonly workspaces: ReadonlySet<string>;
  readonly holders: ReadonlySet<string>;
}

async function idOf(target: string, follow: boolean): Promise<string | null> {
  try {
    const stats = follow ? await stat(target) : await lstat(target);
    return `${String(stats.dev)}:${String(stats.ino)}`;
  } catch {
    return null;
  }
}

/** Where `target` leads now: its real path, or, while it does not exist, its nearest existing folder's real path plus the rest. */
async function resolvedNow(target: string): Promise<string> {
  const rest: string[] = [];
  for (let dir = target; ; dir = path.dirname(dir)) {
    try {
      return path.join(await realpath(dir), ...rest);
    } catch {
      if (dir === path.dirname(dir)) return target;
      rest.unshift(path.basename(dir));
    }
  }
}

/** Every folder above `target`, nearest first, up to `/`. */
function parentsOf(target: string): string[] {
  const parents: string[] = [];
  for (let dir = path.dirname(target); ; dir = path.dirname(dir)) {
    parents.push(dir);
    if (dir === path.dirname(dir)) return parents;
  }
}

export async function workspaceIdsOf(workspaces: readonly string[]): Promise<WorkspaceIds> {
  const own = new Set<string>();
  const holders = new Set<string>();
  for (const workspace of workspaces) {
    const id = await idOf(workspace, true);
    if (id !== null) own.add(id);
    for (const parent of [...parentsOf(workspace), ...parentsOf(await resolvedNow(workspace))]) {
      const parentId = await idOf(parent, true);
      if (parentId !== null) holders.add(parentId);
    }
  }
  return { workspaces: own, holders };
}

/** True when `target` is a workspace, holds one, or sits inside one, by device and inode. */
export async function sharesWorkspace(target: string, ids: WorkspaceIds): Promise<boolean> {
  const self = await idOf(target, false);
  if (self !== null && (ids.workspaces.has(self) || ids.holders.has(self))) return true;
  for (const parent of parentsOf(target)) {
    const parentId = await idOf(parent, true);
    if (parentId !== null && ids.workspaces.has(parentId)) return true;
  }
  return false;
}
