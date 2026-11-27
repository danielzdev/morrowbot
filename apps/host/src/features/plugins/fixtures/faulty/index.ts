import { runPlugin } from '@morrowbot/plugin-sdk';

let failure: unknown = 'none';

runPlugin({
  kind: 'tool',
  init: ({ config }) => {
    failure = config.failure;
  },
  health: () => {
    if (failure === 'crash-on-health') process.exit(7);
    if (failure === 'hang-on-health') return new Promise(() => undefined);
    return { kind: 'ok' };
  },
});
