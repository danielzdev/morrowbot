import { acp } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { createModelCatalog } from './models.ts';
import { probeSession } from './probe.ts';
import type { Live } from './turn.ts';

const MODELS = [
  { value: 'neon', name: 'Neon' },
  { value: 'gated', name: 'Gated' },
  { value: 'flash', name: 'Flash' },
];
const LEVELS: Readonly<Record<string, readonly string[]>> = { neon: ['low', 'xhigh'], flash: ['low', 'high'] };

function options(model: string): unknown[] {
  return [
    { id: 'model', name: 'Model', type: 'select', currentValue: model, options: MODELS },
    { id: 'thought_level', name: 'Thinking Level', type: 'select', currentValue: 'low', options: (LEVELS[model] ?? []).map((value) => ({ value, name: value })) },
  ];
}

/** An agy that refuses to switch to `gated`, as for a model the user's plan does not include. */
function daemon(sent: string[]): acp.AcpClient {
  return {
    version: '1.5.18',
    canLoad: true,
    canClose: true,
    mcpHttp: false,
    alive: () => true,
    call: (method, params, schema) => {
      const value = typeof params === 'object' && params !== null && 'value' in params && typeof params.value === 'string' ? params.value : '';
      sent.push(value === '' ? method : `${method} ${value}`);
      if (method === 'session/set_config_option' && value === 'gated') return Promise.resolve({ kind: 'error', code: -32603, message: 'model gated is not available' });
      const raw = method === 'session/new' ? { sessionId: 'probe', configOptions: options('neon') } : method === 'session/set_config_option' ? { configOptions: options(value) } : {};
      return Promise.resolve({ kind: 'ok', value: schema.parse(raw) });
    },
    notify: () => undefined,
    attach: () => () => undefined,
    exited: new Promise(() => undefined),
    close: () => Promise.resolve(),
    breach: () => undefined,
  };
}

it('skips a model agy refuses to switch to, still learns the thinking levels of the models after it, and counts the probe as done', async () => {
  const sent: string[] = [];
  const live: Live = { daemon: daemon(sent), catalog: createModelCatalog(), tier: null, signedOut: false, probed: false };
  await probeSession(live, '/data', Date.now() + 10_000);
  expect({
    sent,
    probed: live.probed,
    levels: live.catalog.models()?.map((model) => `${model.id}: ${model.options.flatMap((option) => option.choices.map((choice) => choice.id)).join(',')}`),
  }).toMatchInlineSnapshot(`
    {
      "levels": [
        "neon: low,xhigh",
        "gated: ",
        "flash: low,high",
      ],
      "probed": true,
      "sent": [
        "session/new",
        "session/set_config_option gated",
        "session/set_config_option flash",
        "session/close",
      ],
    }
  `);
});
