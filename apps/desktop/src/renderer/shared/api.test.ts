import { describe, expect, it } from 'vitest';
import type { ApiMethod, ApiReply } from '../bridge.ts';
import { createApi } from './api.ts';

const NOW = '2026-11-27T12:00:00.000Z';

function apiWith(replies: Readonly<Record<string, ApiReply>>) {
  return createApi({
    request: (method: ApiMethod, path: string): Promise<ApiReply> => {
      const reply = replies[`${method} ${path}`];
      if (reply === undefined) throw new Error(`Unexpected request: ${method} ${path}`);
      return Promise.resolve(reply);
    },
  });
}

describe('createApi lenient host reply parsing', () => {
  it('strips unknown fields on agent and thread list replies and keeps 204 null replies', async () => {
    const api = apiWith({
      'GET /api/agents': {
        status: 200,
        body: {
          agents: [
            {
              id: 'a1',
              name: 'Helper',
              description: '',
              workspace: { kind: 'dedicated', dir: '/workspace/helper', quotaMb: 512 },
              avatar: { kind: 'bot', shape: 'chat', color: '#6b7280', finish: 'flat', accessory: 'hat' },
              provider: { kind: 'unbound', hintedModel: 'next' },
              folderId: 'f1',
              createdAt: NOW,
              updatedAt: NOW,
              pinnedAt: NOW,
            },
          ],
          folders: [{ id: 'f1', name: 'Work', createdAt: NOW, sortOrder: 1 }],
          lastMessages: [{ agentId: 'a1', threadId: 't1', kind: 'assistant', preview: 'Done', at: NOW, hasAttachments: true }],
          serverVersion: '2.0.0',
        },
      },
      'GET /api/agents/a1/threads': {
        status: 200,
        body: {
          threads: [{ id: 't1', agentId: 'a1', title: 'Main', createdAt: NOW, updatedAt: NOW, archivedAt: null, pinned: true }],
          nextCursor: null,
        },
      },
      'DELETE /api/threads/t1': { status: 204, body: null },
    });

    expect({
      agents: await api.listAgents(),
      threads: await api.listThreads('a1'),
      deleted: await api.deleteThread('t1'),
    }).toEqual({
      agents: {
        kind: 'ok',
        value: {
          agents: [
            {
              id: 'a1',
              name: 'Helper',
              description: '',
              workspace: { kind: 'dedicated', dir: '/workspace/helper' },
              avatar: { kind: 'bot', shape: 'chat', color: '#6b7280', finish: 'flat' },
              provider: { kind: 'unbound' },
              folderId: 'f1',
              emojiReplies: 'allowed',
              disabledExtensions: [],
              revision: 0,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          folders: [{ id: 'f1', name: 'Work', createdAt: NOW }],
          lastMessages: [{ agentId: 'a1', threadId: 't1', kind: 'assistant', preview: 'Done', at: NOW }],
        },
      },
      threads: {
        kind: 'ok',
        value: {
          threads: [{ id: 't1', agentId: 'a1', title: 'Main', createdAt: NOW, updatedAt: NOW, archivedAt: null }],
        },
      },
      deleted: { kind: 'ok', value: null },
    });
  });

  it('strips unknown fields on thread state messages, tool steps and cursor while keeping defaults', async () => {
    const api = apiWith({
      'GET /api/threads/t1/state': {
        status: 200,
        body: {
          thread: { id: 't1', agentId: 'a1', title: 'Main', createdAt: NOW, updatedAt: NOW, archivedAt: null, pinned: true },
          messages: [
            { kind: 'user', id: 'm1', threadId: 't1', text: 'hi', createdAt: NOW, attachments: [], locale: 'en' },
            {
              kind: 'assistant',
              id: 'm2',
              threadId: 't1',
              text: 'here is the report',
              createdAt: NOW,
              outcome: { kind: 'completed', finishReason: 'stop', latencyMs: 42 },
              attachments: [{ kind: 'file', id: 'att-1', name: 'report.pdf', mimeType: 'application/pdf', size: 1024, sha256: 'abc' }],
              citations: ['doc-1'],
            },
          ],
          queue: [],
          blockedGroups: [],
          subagents: [],
          toolSteps: [
            {
              messageId: 'm2',
              steps: [{ toolUseId: 'u1', name: 'Read', input: { file_path: 'a.md' }, outcome: 'ok', startedAt: NOW, endedAt: NOW, output: 'hello' }],
              extraMeta: true,
            },
          ],
          activeTurn: null,
          cursor: { hostEpoch: 'e1', seq: 4, shard: 0 },
          cards: [{ id: 'c1', kind: 'action' }],
        },
      },
    });

    expect(await api.threadState('t1')).toEqual({
      kind: 'ok',
      value: {
        thread: { id: 't1', agentId: 'a1', title: 'Main', createdAt: NOW, updatedAt: NOW, archivedAt: null },
        messages: [
          { kind: 'user', id: 'm1', threadId: 't1', text: 'hi', createdAt: NOW, attachments: [] },
          {
            kind: 'assistant',
            id: 'm2',
            threadId: 't1',
            text: 'here is the report',
            createdAt: NOW,
            outcome: { kind: 'completed', finishReason: 'stop' },
            attachments: [{ kind: 'file', id: 'att-1', name: 'report.pdf', mimeType: 'application/pdf', size: 1024 }],
          },
        ],
        queue: [],
        reactions: [],
        blockedGroups: [],
        subagents: [],
        toolSteps: [
          {
            messageId: 'm2',
            steps: [{ toolUseId: 'u1', name: 'Read', input: { file_path: 'a.md' }, outcome: 'ok', startedAt: NOW, endedAt: NOW }],
          },
        ],
        activeTurn: null,
        cursor: { hostEpoch: 'e1', seq: 4 },
      },
    });
  });

  it('strips unknown fields on ApiError replies and still rejects malformed replies', async () => {
    const api = apiWith({
      'GET /api/agents': {
        status: 403,
        body: { error: { kind: 'forbidden', message: 'Not allowed', retryAfterMs: 1000 }, traceId: 'tr-1' },
      },
      'GET /api/agents/a1/threads': {
        status: 200,
        body: { threads: [{ id: 't1' }] },
      },
    });

    expect({
      refused: await api.listAgents(),
      malformed: await api.listThreads('a1'),
    }).toEqual({
      refused: { kind: 'failed', status: 403, error: { kind: 'forbidden', message: 'Not allowed' } },
      malformed: { kind: 'failed', status: 200, error: { kind: 'internal', message: 'The host sent a reply this window does not understand' } },
    });
  });
});
