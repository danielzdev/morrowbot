import { describe, expect, it } from 'vitest';
import type { WorkspaceLayout } from '../../lib/layout.ts';
import type { TabKey } from '../../lib/workspace.ts';
import { holdsSplit } from './split-mount.ts';
import { TAB_ITEMS } from './tabs.ts';

type Step = { readonly layout: WorkspaceLayout['kind']; readonly onScreen: TabKey };

/** Which tabs hold a mounted split after each step, starting with none. */
function run(steps: readonly Step[]): string[] {
  let held = new Set<TabKey>();
  return steps.map((step) => {
    held = new Set(
      TAB_ITEMS.map((item) => item.key).filter((tab) =>
        holdsSplit(step.layout, step.onScreen === tab, held.has(tab)),
      ),
    );
    return `${step.layout} on ${step.onScreen}: [${[...held].join(', ')}]`;
  });
}

describe('holdsSplit', () => {
  it('mounts each split only once its tab is on screen, then keeps it until the fold', () => {
    expect(
      run([
        { layout: 'stack', onScreen: 'agents' },
        { layout: 'split', onScreen: 'agents' },
        { layout: 'split', onScreen: 'threads' },
        { layout: 'split', onScreen: 'extensions' },
        { layout: 'split', onScreen: 'agents' },
        { layout: 'stack', onScreen: 'agents' },
        { layout: 'split', onScreen: 'settings' },
      ]),
    ).toMatchInlineSnapshot(`
      [
        "stack on agents: []",
        "split on agents: [agents]",
        "split on threads: [agents, threads]",
        "split on extensions: [agents, threads, extensions]",
        "split on agents: [agents, threads, extensions]",
        "stack on agents: []",
        "split on settings: [settings]",
      ]
    `);
  });
});
