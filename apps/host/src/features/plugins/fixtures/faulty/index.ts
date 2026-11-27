import { runPlugin } from '@morrowbot/plugin-sdk';

let failure: unknown = 'none';
let healthChecks = 0;

runPlugin(() => ({
  kind: 'tool',
  init: ({ config }) => {
    failure = config.failure;
  },
  health: async () => {
    if (failure === 'crash-on-health') process.exit(7);
    if (failure === 'hang-on-health') return new Promise(() => undefined);
    if (failure === 'slow-first-health') {
      healthChecks += 1;
      process.send?.({ kind: 'health-result', id: 4242, health: { kind: 'ok' } });
      if (healthChecks === 1) await new Promise((resolve) => setTimeout(resolve, 600));
    }
    return { kind: 'ok' };
  },
}));
