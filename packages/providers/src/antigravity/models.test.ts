import { readOptionalFile } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { createModelCatalog } from './models.ts';
import { SessionNewResponse } from './protocol.ts';

/** A real agy 1.5.18 `session/new` reply, with its session id redacted. */
async function opened(): Promise<SessionNewResponse> {
  const text = await readOptionalFile(decodeURIComponent(new URL('./fixtures/1.5.18/session-new.json', import.meta.url).pathname), { maxBytes: 1_000_000 });
  if (text === null) throw new Error('missing fixture session-new.json');
  return SessionNewResponse.parse(JSON.parse(text));
}

it('lists the models of a real new session, with thinking levels for the default model only', async () => {
  const session = await opened();
  const catalog = createModelCatalog();
  catalog.observe(session.configOptions ?? [], true);
  expect({ tier: session._meta?.antigravity?.tier?.name, models: catalog.models() }).toMatchInlineSnapshot(`
    {
      "models": [
        {
          "id": "gemini-4-neon",
          "isDefault": true,
          "label": "Gemini 4 Neon",
          "options": [
            {
              "choices": [
                {
                  "id": "low",
                  "label": "Low",
                },
                {
                  "id": "medium",
                  "label": "Medium",
                },
                {
                  "id": "high",
                  "label": "High",
                },
                {
                  "id": "xhigh",
                  "label": "Extra",
                },
              ],
              "defaultChoiceId": "high",
              "id": "thought_level",
              "label": "Thinking Level",
            },
          ],
        },
        {
          "id": "gemini-4-carbon",
          "isDefault": false,
          "label": "Gemini 4 Carbon",
          "options": [],
        },
        {
          "id": "gemini-4-argon",
          "isDefault": false,
          "label": "Gemini 4 Argon",
          "options": [],
        },
        {
          "id": "gemini-4-hydrogen",
          "isDefault": false,
          "label": "Gemini 4 Hydrogen",
          "options": [],
        },
        {
          "id": "gemini-pro-orchestrator-neon",
          "isDefault": false,
          "label": "Orchestrator (Neon)",
          "options": [],
        },
        {
          "id": "gemini-pro-orchestrator",
          "isDefault": false,
          "label": "Orchestrator (Carbon)",
          "options": [],
        },
        {
          "id": "gemini-pro-orchestrator-argon",
          "isDefault": false,
          "label": "Orchestrator (Argon)",
          "options": [],
        },
        {
          "id": "gemini-3.8-flash",
          "isDefault": false,
          "label": "Gemini 3.8 Flash",
          "options": [],
        },
        {
          "id": "claude-opus-5-5",
          "isDefault": false,
          "label": "Claude Opus 5.5",
          "options": [],
        },
        {
          "id": "claude-sonnet-5-5",
          "isDefault": false,
          "label": "Claude Sonnet 5.5",
          "options": [],
        },
        {
          "id": "gpt-oss-120b-medium",
          "isDefault": false,
          "label": "GPT-OSS 120B (Medium)",
          "options": [],
        },
      ],
      "tier": "Google AI Ultra",
    }
  `);
});

it('leaves out blank and repeated values, and knows no model while agy names none', () => {
  const catalog = createModelCatalog();
  const select = (id: string, currentValue: string, values: readonly string[]) => ({ id, name: '', type: 'select', currentValue, options: values.map((value) => ({ value, name: '' })) });
  const blank = catalog.observe([select('model', '', ['a'])], true);
  catalog.observe([select('model', 'a', ['a', '', ' ', 'a', 'b']), select('thought_level', 'hi', ['hi', '', 'hi', 'lo'])], true);
  expect({ blank, models: catalog.models() }).toMatchInlineSnapshot(`
    {
      "blank": null,
      "models": [
        {
          "id": "a",
          "isDefault": true,
          "label": "a",
          "options": [
            {
              "choices": [
                {
                  "id": "hi",
                  "label": "hi",
                },
                {
                  "id": "lo",
                  "label": "lo",
                },
              ],
              "defaultChoiceId": "hi",
              "id": "thought_level",
              "label": "Thinking",
            },
          ],
        },
        {
          "id": "b",
          "isDefault": false,
          "label": "b",
          "options": [],
        },
      ],
    }
  `);
});
