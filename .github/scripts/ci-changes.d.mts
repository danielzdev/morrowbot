export interface WorkspaceGraph {
  readonly workspaces: readonly string[];
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>;
  readonly reverseDependents: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface CiJobFlags {
  readonly test_packages: boolean;
  readonly test_plugins: boolean;
  readonly test_host: boolean;
  readonly test_desktop: boolean;
  readonly test_mobile: boolean;
  readonly test_browser: boolean;
  readonly claude_range: boolean;
}

export interface ChangeDetectionResult {
  readonly runAll: boolean;
  readonly reason: string;
  readonly affectedWorkspaces: readonly string[];
  readonly jobs: CiJobFlags;
}

export declare const TEST_WORKSPACE_DEPS: Readonly<Record<string, readonly string[]>>;
export declare const TEST_FILE_DEPS: Readonly<Record<string, readonly string[]>>;

export declare function normalizePath(filePath: string): string;
export declare function isFailOpenFile(filePath: string): boolean;
export declare function isIgnoredFile(filePath: string): boolean;
export declare function loadWorkspaceGraph(repoRoot: string): WorkspaceGraph;
export declare function detectChanges(input: {
  readonly eventName: string;
  readonly changedFiles: readonly string[] | null;
  readonly graph: WorkspaceGraph;
  readonly diffError?: string | null;
}): ChangeDetectionResult;
export declare function resolveGitChangedFiles(input: {
  readonly repoRoot: string;
  readonly baseSha: string;
  readonly headSha: string;
}): { readonly changedFiles: readonly string[] | null; readonly diffError: string | null };
export declare function formatGithubOutputs(jobs: CiJobFlags): string;
