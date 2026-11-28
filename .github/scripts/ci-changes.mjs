import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Cross-workspace dependencies exercised by a workspace's Vitest suite that are not
 * declared in its `package.json`. If any target (or its transitive `package.json`
 * dependencies) is affected, the dependent workspace's tests must run.
 */
export const TEST_WORKSPACE_DEPS = Object.freeze({
  'apps/host': ['plugins/browser', 'plugins/computer-use'],
  'apps/browser-extension': ['plugins/browser'],
  'apps/desktop': ['apps/host'],
  'apps/mobile': ['apps/host'],
});

/**
 * Targeted cross-workspace file dependencies exercised by another workspace's tests.
 * Keeps workspace-wide changes isolated while protecting cross-workspace assertions.
 */
export const TEST_FILE_DEPS = Object.freeze({
  'apps/desktop/src/renderer/styles/tokens.css': ['apps/mobile'],
});

const FAIL_OPEN_EXACT = new Set([
  'package.json',
  'package-lock.json',
  '.github/workflows/ci.yml',
]);

const FAIL_OPEN_PATTERNS = [
  /^tsconfig(?:\.[^/]+)?\.json$/,
  /^vitest\.config\.[^/]+$/,
  /^eslint\.config\.[^/]+$/,
  /^\.github\/scripts\//,
];

const IGNORED_EXACT = new Set([
  'LICENSE',
  '.gitignore',
  '.coderabbit.yaml',
  '.github/pull_request_template.md',
]);

const IGNORED_PATTERNS = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^THIRD_PARTY_LICENSES\//,
  /^\.agents\//,
  /^\.claude\//,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/workflows\/(?!ci\.yml$)[^/]+\.ya?ml$/,
];

const JOB_KEYS = /** @type {const} */ ([
  'test_packages',
  'test_plugins',
  'test_host',
  'test_desktop',
  'test_mobile',
  'test_browser',
  'claude_range',
]);

function allJobs(value) {
  return {
    test_packages: value,
    test_plugins: value,
    test_host: value,
    test_desktop: value,
    test_mobile: value,
    test_browser: value,
    claude_range: value,
  };
}

export function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isFailOpenFile(filePath) {
  const normalized = normalizePath(filePath);
  if (FAIL_OPEN_EXACT.has(normalized)) return true;
  return FAIL_OPEN_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isIgnoredFile(filePath) {
  const normalized = normalizePath(filePath);
  if (isFailOpenFile(normalized)) return false;
  if (IGNORED_EXACT.has(normalized)) return true;
  return IGNORED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listWorkspaceDirs(repoRoot) {
  const rootManifest = readJson(path.join(repoRoot, 'package.json'));
  const patterns = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : ['packages/*', 'apps/*', 'plugins/*'];
  const dirs = new Set();

  for (const rawPattern of patterns) {
    if (typeof rawPattern !== 'string') continue;
    const pattern = normalizePath(rawPattern).replace(/\/$/, '');
    if (pattern.endsWith('/*')) {
      const parent = pattern.slice(0, -2);
      const absParent = path.join(repoRoot, parent);
      if (!existsSync(absParent)) continue;
      for (const entry of readdirSync(absParent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const rel = `${parent}/${entry.name}`;
        if (existsSync(path.join(repoRoot, rel, 'package.json'))) dirs.add(rel);
      }
    } else if (existsSync(path.join(repoRoot, pattern, 'package.json'))) {
      dirs.add(pattern);
    }
  }

  return [...dirs].sort();
}

export function loadWorkspaceGraph(repoRoot) {
  const workspaces = listWorkspaceDirs(repoRoot);
  const manifests = new Map();
  const nameToWorkspace = new Map();

  for (const ws of workspaces) {
    const manifest = readJson(path.join(repoRoot, ws, 'package.json'));
    manifests.set(ws, manifest);
    if (typeof manifest.name === 'string' && manifest.name.length > 0) {
      nameToWorkspace.set(manifest.name, ws);
    }
  }

  const dependencies = new Map();
  const reverseDependents = new Map();
  for (const ws of workspaces) {
    dependencies.set(ws, new Set());
    reverseDependents.set(ws, new Set());
  }

  for (const ws of workspaces) {
    const manifest = manifests.get(ws);
    const depBlocks = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ];
    for (const block of depBlocks) {
      if (block === null || typeof block !== 'object') continue;
      for (const depName of Object.keys(block)) {
        const depWs = nameToWorkspace.get(depName);
        if (depWs !== undefined && depWs !== ws) {
          dependencies.get(ws).add(depWs);
          reverseDependents.get(depWs).add(ws);
        }
      }
    }
  }

  return { workspaces, dependencies, reverseDependents };
}

function matchWorkspace(filePath, workspaces) {
  for (const ws of workspaces) {
    if (filePath === ws || filePath.startsWith(`${ws}/`)) return ws;
  }
  return null;
}

function collectTransitiveDependents(initial, reverseDependents) {
  const visited = new Set(initial);
  const queue = [...initial];
  while (queue.length > 0) {
    const current = queue.shift();
    const dependents = reverseDependents.get(current);
    if (dependents === undefined) continue;
    for (const dependent of dependents) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return visited;
}

function jobKeyForWorkspace(ws) {
  if (ws.startsWith('packages/')) return 'test_packages';
  if (ws.startsWith('plugins/')) return 'test_plugins';
  if (ws === 'apps/host') return 'test_host';
  if (ws === 'apps/desktop') return 'test_desktop';
  if (ws === 'apps/mobile') return 'test_mobile';
  if (ws === 'apps/browser-extension') return 'test_browser';
  return null;
}

export function detectChanges({ eventName, changedFiles, graph, diffError = null }) {
  if (eventName !== 'pull_request') {
    return {
      runAll: true,
      reason: `event:${eventName || 'unknown'}`,
      affectedWorkspaces: [...graph.workspaces],
      jobs: allJobs(true),
    };
  }

  if (diffError !== null && diffError !== '') {
    return {
      runAll: true,
      reason: `diff-error:${diffError}`,
      affectedWorkspaces: [...graph.workspaces],
      jobs: allJobs(true),
    };
  }

  if (!Array.isArray(changedFiles)) {
    return {
      runAll: true,
      reason: 'diff-error:unavailable',
      affectedWorkspaces: [...graph.workspaces],
      jobs: allJobs(true),
    };
  }

  const normalizedFiles = changedFiles
    .map((file) => normalizePath(file.trim()))
    .filter((file) => file.length > 0);

  const directlyChanged = new Set();
  for (const file of normalizedFiles) {
    if (isFailOpenFile(file)) {
      return {
        runAll: true,
        reason: `root-config:${file}`,
        affectedWorkspaces: [...graph.workspaces],
        jobs: allJobs(true),
      };
    }

    const ws = matchWorkspace(file, graph.workspaces);
    if (ws !== null) {
      directlyChanged.add(ws);
      continue;
    }

    if (isIgnoredFile(file)) continue;

    return {
      runAll: true,
      reason: `unmapped-file:${file}`,
      affectedWorkspaces: [...graph.workspaces],
      jobs: allJobs(true),
    };
  }

  const codeAffected = collectTransitiveDependents(directlyChanged, graph.reverseDependents);
  const testAffected = new Set(codeAffected);

  for (const [workspace, targets] of Object.entries(TEST_WORKSPACE_DEPS)) {
    if (!graph.workspaces.includes(workspace)) continue;
    if (targets.some((target) => codeAffected.has(target))) {
      testAffected.add(workspace);
    }
  }

  for (const file of normalizedFiles) {
    const extraWorkspaces = TEST_FILE_DEPS[file];
    if (extraWorkspaces === undefined) continue;
    for (const workspace of extraWorkspaces) {
      if (graph.workspaces.includes(workspace)) testAffected.add(workspace);
    }
  }

  const jobs = allJobs(false);
  for (const ws of testAffected) {
    const jobKey = jobKeyForWorkspace(ws);
    if (jobKey === null) {
      return {
        runAll: true,
        reason: `unmapped-workspace:${ws}`,
        affectedWorkspaces: [...graph.workspaces],
        jobs: allJobs(true),
      };
    }
    jobs[jobKey] = true;
  }

  if (codeAffected.has('packages/providers')) {
    jobs.claude_range = true;
  }

  return {
    runAll: false,
    reason: testAffected.size === 0 ? 'docs-or-meta-only' : 'affected',
    affectedWorkspaces: [...testAffected].sort(),
    jobs,
  };
}

export function resolveGitChangedFiles({ repoRoot, baseSha, headSha }) {
  if (!baseSha || !headSha) {
    return { changedFiles: null, diffError: 'missing-pr-shas' };
  }
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', `${baseSha}...${headSha}`],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const changedFiles = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { changedFiles, diffError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { changedFiles: null, diffError: message || 'git-diff-failed' };
  }
}

export function formatGithubOutputs(jobs) {
  return JOB_KEYS.map((key) => `${key}=${String(Boolean(jobs[key]))}`).join('\n') + '\n';
}

function main() {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const graph = loadWorkspaceGraph(repoRoot);

  let changedFiles = null;
  let diffError = null;
  if (eventName === 'pull_request') {
    const resolved = resolveGitChangedFiles({
      repoRoot,
      baseSha: process.env.PR_BASE_SHA ?? '',
      headSha: process.env.PR_HEAD_SHA ?? '',
    });
    changedFiles = resolved.changedFiles;
    diffError = resolved.diffError;
  }

  const result = detectChanges({ eventName, changedFiles, graph, diffError });
  const outputs = formatGithubOutputs(result.jobs);

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, outputs, 'utf8');
  }

  console.log(`Event: ${eventName || '(unset)'}`);
  console.log(`Reason: ${result.reason}`);
  if (changedFiles !== null) {
    console.log(`Changed files (${String(changedFiles.length)}): ${changedFiles.join(', ') || '(none)'}`);
  }
  console.log(`Affected workspaces: ${result.affectedWorkspaces.join(', ') || '(none)'}`);
  console.log('Outputs:');
  process.stdout.write(outputs);
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  main();
}
