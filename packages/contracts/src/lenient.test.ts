import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ClaimPairingResponse,
  EventServerFrame,
  HealthResponse,
  HostUrl,
  lenient,
  MessageList,
  PairingCode,
  PluginList,
  ProviderInfoResponse,
  ThreadState,
  TokenUsageResponse,
} from './index.ts';

function outcome(result: z.ZodSafeParseResult<unknown>) {
  return result.success ? result.data : result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

const NOW = '2026-11-27T12:00:00.000Z';

describe('lenient', () => {
  it('drops unknown keys inside messages and their nested unions', () => {
    const reply = {
      messages: [
        { kind: 'user', id: 'm1', threadId: 't1', text: 'hi', createdAt: NOW, attachments: [], reactions: ['+1'] },
        {
          kind: 'assistant',
          id: 'm2',
          threadId: 't1',
          text: 'hello',
          createdAt: NOW,
          outcome: { kind: 'completed', finishReason: 'stop', latencyMs: 40 },
          citations: [],
        },
      ],
      nextPage: null,
    };
    expect([outcome(MessageList.safeParse(reply)), outcome(lenient(MessageList).safeParse(reply))]).toMatchInlineSnapshot(`
      [
        [
          "messages.0: Unrecognized key: "reactions"",
          "messages.1.outcome: Unrecognized key: "latencyMs"",
          "messages.1: Unrecognized key: "citations"",
          "(root): Unrecognized key: "nextPage"",
        ],
        {
          "messages": [
            {
              "attachments": [],
              "createdAt": "2026-11-27T12:00:00.000Z",
              "id": "m1",
              "kind": "user",
              "text": "hi",
              "threadId": "t1",
            },
            {
              "createdAt": "2026-11-27T12:00:00.000Z",
              "id": "m2",
              "kind": "assistant",
              "outcome": {
                "finishReason": "stop",
                "kind": "completed",
              },
              "text": "hello",
              "threadId": "t1",
            },
          ],
        },
      ]
    `);
  });

  it('drops unknown keys inside a plugin manifest and keeps its defaults and refinements', () => {
    const entry = (permissions: string[]) => ({
      manifest: {
        protocolVersion: 1,
        id: 'claude',
        name: 'Claude',
        version: '1.0.0',
        kind: 'provider',
        main: 'index.ts',
        permissions,
        settingsSchema: { model: { kind: 'string', label: 'Model', placeholder: 'default' } },
        homepage: 'https://example.com',
      },
      source: 'built-in',
      status: { kind: 'running', since: NOW },
      enabled: true,
      config: {},
      blockedGroups: [],
    });
    const list = (permissions: string[]) => ({ plugins: [entry(permissions)], safeMode: false, pluginsDir: '/plugins', problems: [], marketplace: true });
    expect([outcome(lenient(PluginList).safeParse(list(['network']))), outcome(lenient(PluginList).safeParse(list(['network', 'network'])))])
      .toMatchInlineSnapshot(`
        [
          {
            "plugins": [
              {
                "blockedGroups": [],
                "config": {},
                "enabled": true,
                "manifest": {
                  "envPreset": "none",
                  "id": "claude",
                  "kind": "provider",
                  "main": "index.ts",
                  "name": "Claude",
                  "permissions": [
                    "network",
                  ],
                  "protocolVersion": 1,
                  "settingsSchema": {
                    "model": {
                      "kind": "string",
                      "label": "Model",
                    },
                  },
                  "version": "1.0.0",
                },
                "source": "built-in",
                "status": {
                  "kind": "running",
                },
              },
            ],
            "pluginsDir": "/plugins",
            "problems": [],
            "safeMode": false,
          },
          [
            "plugins.0.manifest.permissions: List each permission once",
          ],
        ]
      `);
  });

  it('keeps JSON leaves whole and still refuses unknown event kinds', () => {
    const cursor = { hostEpoch: 'e1', seq: 3, shard: 0 };
    const toolStart = { kind: 'generation.tool-start', threadId: 't1', generationId: 'g1', cursor, toolUseId: 'u1', name: 'search', input: { q: 'x', extra: { deep: true } }, lane: 2 };
    const frame = lenient(EventServerFrame);
    expect([outcome(frame.safeParse(toolStart)), frame.safeParse({ kind: 'surface.updated', threadId: 't1' }).success]).toMatchInlineSnapshot(`
      [
        {
          "cursor": {
            "hostEpoch": "e1",
            "seq": 3,
          },
          "generationId": "g1",
          "input": {
            "extra": {
              "deep": true,
            },
            "q": "x",
          },
          "kind": "generation.tool-start",
          "name": "search",
          "threadId": "t1",
          "toolUseId": "u1",
        },
        false,
      ]
    `);
  });

  it('accepts additive fields on every other reply the mobile app reads', () => {
    const extra = { addedLater: 1 };
    const replies: readonly [z.ZodType, unknown][] = [
      [HealthResponse, { status: 'ok', version: '1.0.0', uptimeMs: 5, ...extra }],
      [ClaimPairingResponse, { deviceId: 'd1', token: 'x'.repeat(32), hostName: 'Studio Host', hostVersion: '1.0.0', ...extra }],
      [TokenUsageResponse, { range: '7d', since: NOW, totals: [{ pluginId: 'claude', agentId: 'a1', model: null, turns: 1, turnsWithoutCounts: 0, inputTokens: 1, cachedInputTokens: null, outputTokens: 2, reasoningTokens: null, ...extra }], ...extra }],
      [ProviderInfoResponse, { info: { kind: 'error', message: 'Down', ...extra }, ...extra }],
    ];
    expect(replies.map(([schema, value]) => [schema.safeParse(value).success, lenient(schema).safeParse(value).success])).toMatchInlineSnapshot(`
      [
        [
          false,
          true,
        ],
        [
          false,
          true,
        ],
        [
          false,
          true,
        ],
        [
          false,
          true,
        ],
      ]
    `);
  });

  it("reads an older host's thread state as having no tool steps, and drops fields a newer host adds to a step", () => {
    const thread = { id: 't1', agentId: 'a1', title: 'Chat', createdAt: NOW, updatedAt: NOW };
    const turn = { generationId: 'g1', trigger: { kind: 'chat' }, state: 'running', queueNote: null, text: '', pendingApprovals: [] };
    const base = { thread, messages: [], queue: [], blockedGroups: [], subagents: [], cursor: { hostEpoch: 'e1', seq: 1 } };
    const step = { toolUseId: 'r1', name: 'Read', input: { file_path: 'a.md' }, outcome: 'ok', startedAt: NOW, endedAt: NOW, output: 'hi' };
    const older = { ...base, activeTurn: turn };
    const newer = { ...base, toolSteps: [{ messageId: 'm1', steps: [step] }], activeTurn: { ...turn, toolSteps: [step] } };
    const read = (state: unknown) => {
      const result = lenient(ThreadState).safeParse(state);
      return result.success ? { toolSteps: result.data.toolSteps, active: result.data.activeTurn?.toolSteps } : outcome(result);
    };
    expect({ older: read(older), newer: read(newer) }).toMatchInlineSnapshot(`
      {
        "newer": {
          "active": [
            {
              "endedAt": "2026-11-27T12:00:00.000Z",
              "input": {
                "file_path": "a.md",
              },
              "name": "Read",
              "outcome": "ok",
              "startedAt": "2026-11-27T12:00:00.000Z",
              "toolUseId": "r1",
            },
          ],
          "toolSteps": [
            {
              "messageId": "m1",
              "steps": [
                {
                  "endedAt": "2026-11-27T12:00:00.000Z",
                  "input": {
                    "file_path": "a.md",
                  },
                  "name": "Read",
                  "outcome": "ok",
                  "startedAt": "2026-11-27T12:00:00.000Z",
                  "toolUseId": "r1",
                },
              ],
            },
          ],
        },
        "older": {
          "active": [],
          "toolSteps": [],
        },
      }
    `);
  });

  it('keeps checks and transforms on leaves', () => {
    expect([
      outcome(lenient(z.strictObject({ url: HostUrl, code: PairingCode })).safeParse({ url: 'http://100.64.0.1:47800/', code: '123456', v: 2 })),
      outcome(lenient(z.strictObject({ code: PairingCode })).safeParse({ code: '12' })),
    ]).toMatchInlineSnapshot(`
      [
        {
          "code": "123456",
          "url": "http://100.64.0.1:47800",
        },
        [
          "code: Expected a 6-digit code",
        ],
      ]
    `);
  });
});
