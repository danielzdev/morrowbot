import { lstat, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Agent workspaces as the disk knows them: the device and inode of each existing workspace, and of every folder
 * above each one (existing or not, the workspace itself). Comparing these, not path strings, catches every other
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
    for (const parent of parentsOf(workspace)) {
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
