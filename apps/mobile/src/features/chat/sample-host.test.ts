import { describe, expect, it } from 'vitest';
import { sampleCatalog } from '../../lib/sample-catalog.ts';
import { createChatHub } from './chat-hub.ts';
import { createSampleChatHost } from './sample-host.ts';

describe('sample chat host parity (#123) and revision concurrency (#112)', () => {
  it('opens every sample catalog agent and thread cleanly without reporting gone', async () => {
    const catalog = sampleCatalog(Date.parse('2026-11-27T12:00:00.000Z'));
    const host = createSampleChatHost();
    const agentsResult = await host.agents();
    expect(agentsResult.kind).toBe('ok');
    if (agentsResult.kind !== 'ok') return;

    const hostAgentIds = agentsResult.value.agents.map(({ id }) => id);
    expect(hostAgentIds).toEqual(catalog.agents.map(({ id }) => id));

    for (const { thread } of catalog.threads) {
      const threadsResult = await host.threads(thread.agentId);
      expect(threadsResult.kind).toBe('ok');
      if (threadsResult.kind !== 'ok') continue;
      expect(threadsResult.value.threads.some(({ id }) => id === thread.id)).toBe(true);

      const watched = await new Promise<'fresh' | 'gone'>((resolve) => {
        const stop = host.watch(thread.id, {
          onFresh: () => {
            stop();
            resolve('fresh');
          },
          onEvent: () => undefined,
          onStale: () => undefined,
          onGone: () => {
            stop();
            resolve('gone');
          },
        });
      });
      expect(watched).toBe('fresh');
    }
  });

  it('rejects thread creation for a deleted sample agent and notifies listeners', async () => {
    const host = createSampleChatHost();
    const deleted: string[] = [];
    const stop = host.onAgentDeleted((id) => {
      deleted.push(id);
    });
    await host.deleteAgent('recipe-coach');
    stop();
    expect(deleted).toEqual(['recipe-coach']);

    const created = await host.createThread('recipe-coach');
    expect(created.kind).toBe('failed');
    if (created.kind === 'failed') expect(created.status).toBe(404);
  });

  it('enforces agent revision optimistic concurrency and ignores delayed stale refreshes', async () => {
    const base = createSampleChatHost();
    const first = await base.updateAgent('errand-bot', { disabledExtensions: ['web-search'], revision: 0 });
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    expect(first.value.revision).toBe(1);
    expect(first.value.disabledExtensions).toEqual(['web-search']);

    const stale = await base.updateAgent('errand-bot', { disabledExtensions: ['notes-sync'], revision: 0 });
    expect(stale.kind).toBe('failed');
    if (stale.kind !== 'failed') return;
    expect(stale.status).toBe(409);
    expect(stale.error.kind).toBe('agent-conflict');
    expect(stale.error.message).toBe('Changed elsewhere.');

    // Verify ChatHub never rolls back revision 1 when a delayed agents() list arrives with revision 0
    const staleList = await createSampleChatHost().agents();
    if (staleList.kind !== 'ok') return;
    let resolveDelayed!: (value: typeof staleList) => void;
    let calls = 0;
    const hub = createChatHub({
      ...base,
      agents: () => {
        calls += 1;
        if (calls === 1) return base.agents();
        return new Promise((resolve) => {
          resolveDelayed = resolve;
        });
      },
    });
    await hub.refreshAgents();
    const pendingRefresh = hub.refreshAgents();
    resolveDelayed(staleList);
    await pendingRefresh;

    const current = hub.agents.get();
    expect(current.kind).toBe('loaded');
    if (current.kind === 'loaded') {
      const errand = current.value.find(({ id }) => id === 'errand-bot');
      expect(errand?.revision).toBe(1);
      expect(errand?.disabledExtensions).toEqual(['web-search']);
    }
    hub.dispose();
  });
});
