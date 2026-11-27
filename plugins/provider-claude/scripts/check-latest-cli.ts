import { checkVersion, z } from '@morrowbot/plugin-sdk';
import { SUPPORTED, SUPPORTED_TEXT } from '../src/version.ts';

/**
 * Fails when npm's latest Claude Code is outside the tested range, so a new minor version is
 * noticed in CI: run the §5 fixtures on it, then widen the range in `src/version.ts`.
 */
const LATEST = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';

const response = await fetch(LATEST, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`${LATEST} answered ${String(response.status)}`);
const { version } = z.looseObject({ version: z.string().min(1) }).parse(await response.json());
const range = checkVersion(version, SUPPORTED);
switch (range) {
  case 'inside':
  case 'below':
    console.log(`Claude Code ${version} on npm is inside or below the tested range ${SUPPORTED_TEXT}.`);
    break;
  case 'above':
  case 'unparsable':
    console.error(
      `Claude Code ${version} on npm is outside the tested range ${SUPPORTED_TEXT}. Run the live provider-claude fixtures (MORROWBOT_LIVE_CLAUDE=1) on it, then widen the range in plugins/provider-claude/src/version.ts.`,
    );
    process.exitCode = 1;
    break;
}
