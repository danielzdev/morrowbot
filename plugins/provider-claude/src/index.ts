import { runPlugin } from '@morrowbot/plugin-sdk';
import { checkHealth, streamReply } from './claude.ts';
import { parseSettings, type Settings } from './settings.ts';

let settings: Settings | undefined;

function current(): Settings {
  if (settings === undefined) throw new Error('provider-claude has not been started yet');
  return settings;
}

runPlugin({
  kind: 'provider',
  init: ({ config }) => {
    settings = parseSettings(config);
  },
  health: () => checkHealth(current()),
  stream: (request, sink) => streamReply(request, current(), sink),
});
