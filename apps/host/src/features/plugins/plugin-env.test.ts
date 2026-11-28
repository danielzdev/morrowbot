import { expect, it } from 'vitest';
import { fallbackPluginDirs } from './plugin-env.ts';

it('includes standard CLI and desktop app install paths for packaged app discovery', () => {
  expect({
    darwin: fallbackPluginDirs('darwin', '/Users/sam', {}),
    linux: fallbackPluginDirs('linux', '/home/sam', {}),
    win32: fallbackPluginDirs('win32', 'C:\\Users\\sam', { APPDATA: 'C:\\Users\\sam\\AppData\\Roaming' }),
  }).toMatchInlineSnapshot(`
    {
      "darwin": [
        "/Users/sam/.local/bin",
        "/Users/sam/.opencode/bin",
        "/Users/sam/.antigravity/antigravity/bin",
        "/Users/sam/.claude/local",
        "/Users/sam/.local/share/mise/shims",
        "/Users/sam/.volta/bin",
        "/Users/sam/.bun/bin",
        "/Users/sam/.npm-global/bin",
        "/Users/sam/.asdf/shims",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin",
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS",
        "/Applications/Antigravity.app/Contents/Resources/app/bin",
        "/Applications/Antigravity.app/Contents/Resources/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ],
      "linux": [
        "/home/sam/.local/bin",
        "/home/sam/.opencode/bin",
        "/home/sam/.antigravity/antigravity/bin",
        "/home/sam/.claude/local",
        "/home/sam/.local/share/mise/shims",
        "/home/sam/.volta/bin",
        "/home/sam/.bun/bin",
        "/home/sam/.npm-global/bin",
        "/home/sam/.asdf/shims",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ],
      "win32": [
        "C:\\Users\\sam\\AppData\\Roaming/npm",
        "C:\\Users\\sam/.local/bin",
      ],
    }
  `);
});
