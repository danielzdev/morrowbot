import { standaloneRuntime } from '@morrowbot/plugin-sdk';
import { callTool, toolsFor, type ToolOutput } from '../src/tools.ts';

/**
 * Runs Computer Use tools outside the host, in order, sharing one set of snapshots:
 *   node plugins/computer-use/scripts/call.ts <data folder> <tool> [json input] [<tool> [json input]]...
 * Screenshots are summarized, never printed or saved.
 */
const [dataDir, ...steps] = process.argv.slice(2);
if (dataDir === undefined || steps.length === 0) {
  console.error('Usage: call.ts <data folder> <tool> [json input] ...');
  process.exit(2);
}
const tools = toolsFor(standaloneRuntime(), dataDir);
for (let index = 0; index < steps.length; index += 1) {
  const name = steps[index] ?? '';
  const next = steps[index + 1];
  const input: unknown = next?.startsWith('{') === true ? JSON.parse(next) : {};
  if (next?.startsWith('{') === true) index += 1;
  const output = await callTool(tools, name, input, new AbortController().signal);
  console.log(`$ ${name} ${JSON.stringify(input)}\n${summarize(output)}\n`);
}

function summarize(output: ToolOutput): string {
  const image = output.kind === 'ok' && output.image !== null ? `\n[PNG ${String(output.image.width)}×${String(output.image.height)}, ${String(Math.round((output.image.base64.length * 3) / 4 / 1024))} KiB, not shown]` : '';
  return `${output.kind}: ${output.text}${image}`;
}
