import type { CreateFolderRequest, Folder, UpdateFolderRequest } from '@morrowbot/contracts';

/** Where folder records are kept (the storage feature provides one). */
export interface FolderRecords {
  insert(folder: Folder): void;
  rename(id: string, name: string): Folder | undefined;
  delete(id: string): boolean;
  get(id: string): Folder | undefined;
  list(): Folder[];
}

export interface FolderServiceOptions {
  readonly records: FolderRecords;
  readonly newId: () => string;
  readonly now: () => string;
}

export interface FolderService {
  list(): Folder[];
  get(id: string): Folder | undefined;
  create(request: CreateFolderRequest): Folder;
  rename(id: string, request: UpdateFolderRequest): Folder | undefined;
  /** Agents in the folder stay, outside any folder. */
  delete(id: string): boolean;
}

export function createFolderService(options: FolderServiceOptions): FolderService {
  const { records } = options;
  return {
    list: () => records.list(),
    get: (id) => records.get(id),
    create: (request) => {
      const folder: Folder = { id: options.newId(), name: request.name, createdAt: options.now() };
      records.insert(folder);
      return folder;
    },
    rename: (id, request) => records.rename(id, request.name),
    delete: (id) => records.delete(id),
  };
}
