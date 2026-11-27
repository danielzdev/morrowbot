import { runPlugin, type PluginConfig } from '@morrowbot/plugin-sdk';

let config: PluginConfig = {};

runPlugin({
  kind: 'provider',
  init: ({ config: settings }) => {
    config = settings;
  },
  health: () => ({ kind: 'ok' }),
  stream: (request, sink) => {
    const last = request.messages.at(-1)?.content ?? '';
    sink.emit({ kind: 'text', text: `${String(config.greeting)} from pid ${String(process.pid)}:` });
    for (let i = 0; i < Number(config.repeat); i += 1) sink.emit({ kind: 'text', text: ` ${last}` });
    return Promise.resolve('stop');
  },
});
