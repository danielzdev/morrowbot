import { HOST_TOOLS_SERVER, type HostTools } from '@morrowbot/contracts';
import { acp, type ProviderError } from '@morrowbot/plugin-sdk';

/**
 * How agy names Ori Bot's tools: `mcp_oribot_<tool>`, or `mcp_oribot_<8 hex>_<tool>` while another
 * session's server of that name still runs (checked on agy 1.5.18).
 */
const HOST_TOOL = new RegExp(`^mcp_${HOST_TOOLS_SERVER}_`);

/** Whether agy asks to run one of Ori Bot's own tools, which it reports as kind `other` (checked on agy 1.5.18). */
export function isHostTool(request: acp.PermissionRequest): boolean {
  return request.toolCall.kind === 'other' && HOST_TOOL.test(request.toolCall.name ?? '');
}

export type Bridged = { readonly kind: 'open'; readonly bridge: acp.HostToolsBridge } | { readonly kind: 'refused'; readonly error: ProviderError };

/** Ori Bot's tools for the turn as agy runs them, over stdio: agy 1.5.18 connects to no MCP server over HTTP. */
export async function bridgeHostTools(tools: HostTools): Promise<Bridged> {
  try {
    return { kind: 'open', bridge: await acp.openHostToolsBridge(tools) };
  } catch (error) {
    return { kind: 'refused', error: { kind: 'other', message: `Ori Bot could not hand its tools to Antigravity: ${error instanceof Error ? error.message : String(error)}` } };
  }
}

/** Ends the turn's bridge, so the program agy runs for it exits before the next turn. */
export async function closeBridge(bridge: acp.HostToolsBridge): Promise<void> {
  try {
    await bridge.close();
  } catch (error) {
    console.error("provider-antigravity: could not close a turn's tools bridge", error);
  }
}
