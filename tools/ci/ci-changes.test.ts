import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectChanges,
  formatGithubOutputs,
  loadWorkspaceGraph,
  resolveGitChangedFiles,
  TEST_FILE_DEPS,
  TEST_WORKSPACE_DEPS,
  type CiJobFlags,
  type WorkspaceGraph,
} from '../../.github/scripts/ci-changes.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT_PATH = path.join(REPO_ROOT, '.github/scripts/ci-changes.mjs');
const REAL_GRAPH = loadWorkspaceGraph(REPO_ROOT);

const ALL_TRUE: CiJobFlags = {
  test_packages: true,
  test_plugins: true,
  test_host: true,
  test_desktop: true,
  test_mobile: true,
  test_browser: true,
  claude_range: true,
};

const ALL_FALSE: CiJobFlags = {
  test_packages: false,
  test_plugins: false,
  test_host: false,
  test_desktop: false,
  test_mobile: false,
  test_browser: false,
  claude_range: false,
};

function jobsFor(changedFiles: readonly string[]): CiJobFlags {
  return detectChanges({ eventName: 'pull_request', changedFiles, graph: REAL_GRAPH }).jobs;
}

describe('ci-changes workspace graph', () => {
  it('loads all repository workspaces and their internal package.json dependency edges', () => {
    const deps = Object.fromEntries(
      REAL_GRAPH.workspaces.map((ws) => [ws, [...(REAL_GRAPH.dependencies.get(ws) ?? [])].sort()]),
    );
    expect(deps).toMatchInlineSnapshot(`
      {
        "apps/browser-extension": [
          "packages/contracts",
        ],
        "apps/desktop": [
          "packages/contracts",
        ],
        "apps/host": [
          "packages/contracts",
          "packages/plugin-sdk",
          "packages/providers",
        ],
        "apps/mobile": [
          "packages/contracts",
        ],
        "packages/contracts": [],
        "packages/plugin-sdk": [
          "packages/contracts",
        ],
        "packages/providers": [
          "packages/contracts",
          "packages/plugin-sdk",
        ],
        "plugins/browser": [
          "packages/contracts",
          "packages/plugin-sdk",
        ],
        "plugins/computer-use": [
          "packages/contracts",
          "packages/plugin-sdk",
        ],
      }
    `);
  });

  it('references only real workspaces and files in extra test dependencies', () => {
    for (const [workspace, targets] of Object.entries(TEST_WORKSPACE_DEPS)) {
      expect(REAL_GRAPH.workspaces).toContain(workspace);
      for (const target of targets) expect(REAL_GRAPH.workspaces).toContain(target);
    }
    for (const [file, targets] of Object.entries(TEST_FILE_DEPS)) {
      expect(existsSync(path.join(REPO_ROOT, file))).toBe(true);
      for (const target of targets) expect(REAL_GRAPH.workspaces).toContain(target);
    }
  });
});

describe('ci-changes affected workspace detection', () => {
  it('isolates single-app changes and respects cross-workspace test dependencies', () => {
    expect({
      desktopOnly: jobsFor(['apps/desktop/src/renderer/features/chat/Chat.tsx']),
      desktopTokens: jobsFor(['apps/desktop/src/renderer/styles/tokens.css']),
      mobileOnly: jobsFor(['apps/mobile/src/lib/layout.ts']),
      browserOnly: jobsFor(['apps/browser-extension/src/cdp/driver.ts']),
      hostOnly: jobsFor(['apps/host/src/main.ts']),
      pluginBrowser: jobsFor(['plugins/browser/src/bridge.ts']),
      pluginComputerUse: jobsFor(['plugins/computer-use/src/tools.ts']),
    }).toMatchInlineSnapshot(`
      {
        "browserOnly": {
          "claude_range": false,
          "test_browser": true,
          "test_desktop": false,
          "test_host": false,
          "test_mobile": false,
          "test_packages": false,
          "test_plugins": false,
        },
        "desktopOnly": {
          "claude_range": false,
          "test_browser": false,
          "test_desktop": true,
          "test_host": false,
          "test_mobile": false,
          "test_packages": false,
          "test_plugins": false,
        },
        "desktopTokens": {
          "claude_range": false,
          "test_browser": false,
          "test_desktop": true,
          "test_host": false,
          "test_mobile": true,
          "test_packages": false,
          "test_plugins": false,
        },
        "hostOnly": {
          "claude_range": false,
          "test_browser": false,
          "test_desktop": true,
          "test_host": true,
          "test_mobile": true,
          "test_packages": false,
          "test_plugins": false,
        },
        "mobileOnly": {
          "claude_range": false,
          "test_browser": false,
          "test_desktop": false,
          "test_host": false,
          "test_mobile": true,
          "test_packages": false,
          "test_plugins": false,
        },
        "pluginBrowser": {
          "claude_range": false,
          "test_browser": true,
          "test_desktop": false,
          "test_host": true,
          "test_mobile": false,
          "test_packages": false,
          "test_plugins": true,
        },
        "pluginComputerUse": {
          "claude_range": false,
          "test_browser": false,
          "test_desktop": false,
          "test_host": true,
          "test_mobile": false,
          "test_packages": false,
          "test_plugins": true,
        },
      }
    `);
  });

  it('ripples shared package changes to all transitive dependents', () => {
    expect(jobsFor(['packages/contracts/src/chat-api.ts'])).toEqual(ALL_TRUE);
    expect(jobsFor(['packages/plugin-sdk/src/command.ts'])).toEqual(ALL_TRUE);
    expect(jobsFor(['packages/providers/src/claude/version.ts'])).toEqual({
      test_packages: true,
      test_plugins: false,
      test_host: true,
      test_desktop: true,
      test_mobile: true,
      test_browser: false,
      claude_range: true,
    });
  });

  it('skips all test suites on docs-only and repo-meta PRs', () => {
    const result = detectChanges({
      eventName: 'pull_request',
      changedFiles: [
        'README.md',
        'AGENTS.md',
        'docs/architecture.md',
        '.github/pull_request_template.md',
        '.github/workflows/size-label.yml',
      ],
      graph: REAL_GRAPH,
    });
    expect(result).toEqual({
      runAll: false,
      reason: 'docs-or-meta-only',
      affectedWorkspaces: [],
      jobs: ALL_FALSE,
    });
  });

  it('fails open on root config, lockfile, workflow, and CI script edits', () => {
    const failOpenFiles = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.base.json',
      'vitest.config.ts',
      'eslint.config.ts',
      '.github/workflows/ci.yml',
      '.github/scripts/ci-changes.mjs',
      'untracked-root-script.mjs',
    ];
    for (const file of failOpenFiles) {
      const result = detectChanges({
        eventName: 'pull_request',
        changedFiles: ['apps/desktop/src/main/main.ts', file],
        graph: REAL_GRAPH,
      });
      expect(result.runAll, file).toBe(true);
      expect(result.jobs, file).toEqual(ALL_TRUE);
    }
  });

  it('fails open on push to main, diff errors, and unmapped workspaces', () => {
    const push = detectChanges({ eventName: 'push', changedFiles: null, graph: REAL_GRAPH });
    expect(push.runAll).toBe(true);
    expect(push.reason).toBe('event:push');
    expect(push.jobs).toEqual(ALL_TRUE);

    const diffFailed = detectChanges({
      eventName: 'pull_request',
      changedFiles: null,
      graph: REAL_GRAPH,
      diffError: 'git-diff-failed',
    });
    expect(diffFailed.runAll).toBe(true);
    expect(diffFailed.jobs).toEqual(ALL_TRUE);

    const syntheticGraph: WorkspaceGraph = {
      workspaces: ['apps/new-app'],
      dependencies: new Map([['apps/new-app', new Set()]]),
      reverseDependents: new Map([['apps/new-app', new Set()]]),
    };
    const unmapped = detectChanges({
      eventName: 'pull_request',
      changedFiles: ['apps/new-app/src/index.ts'],
      graph: syntheticGraph,
    });
    expect(unmapped.runAll).toBe(true);
    expect(unmapped.reason).toBe('unmapped-workspace:apps/new-app');
    expect(unmapped.jobs).toEqual(ALL_TRUE);
  });

  it('returns an error rather than throwing when git diff cannot be resolved', () => {
    expect(resolveGitChangedFiles({ repoRoot: REPO_ROOT, baseSha: '', headSha: '' })).toEqual({
      changedFiles: null,
      diffError: 'missing-pr-shas',
    });

    const badRef = resolveGitChangedFiles({
      repoRoot: REPO_ROOT,
      baseSha: '0000000000000000000000000000000000000000',
      headSha: 'HEAD',
    });
    expect(badRef.changedFiles).toBeNull();
    expect(badRef.diffError).not.toBeNull();
  });

  it('writes formatted GitHub Actions outputs when invoked as a CLI script', () => {
    expect(formatGithubOutputs(ALL_FALSE)).toBe(
      [
        'test_packages=false',
        'test_plugins=false',
        'test_host=false',
        'test_desktop=false',
        'test_mobile=false',
        'test_browser=false',
        'claude_range=false',
        '',
      ].join('\n'),
    );

    const dir = mkdtempSync(path.join(tmpdir(), 'morrowbot-ci-changes-'));
    try {
      const outputFile = path.join(dir, 'github-output.txt');
      execFileSync(process.execPath, [SCRIPT_PATH], {
        cwd: REPO_ROOT,
        env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: outputFile },
        encoding: 'utf8',
      });
      expect(readFileSync(outputFile, 'utf8')).toBe(formatGithubOutputs(ALL_TRUE));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
