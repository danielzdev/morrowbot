import { PluginManifest } from '@morrowbot/contracts';
import { readOptionalFile } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';

it('declares a tool plugin that asks for Accessibility and Screen Recording', async () => {
  const raw = await readOptionalFile(decodeURIComponent(new URL('../manifest.json', import.meta.url).pathname), { maxBytes: 16_384 });
  const parsed = PluginManifest.safeParse(JSON.parse(raw ?? 'null'));
  expect(parsed.success ? parsed.data : parsed.error.issues).toMatchInlineSnapshot(`
    {
      "description": "Lets agents see your screen and use apps on this Mac with the mouse and keyboard.",
      "envPreset": "cli-runtime",
      "id": "computer-use",
      "kind": "tool",
      "main": "src/index.ts",
      "name": "Computer Use",
      "permissions": [
        "accessibility",
        "screen-recording",
      ],
      "protocolVersion": 1,
      "settingsSchema": {},
      "version": "0.1.0",
    }
  `);
});
