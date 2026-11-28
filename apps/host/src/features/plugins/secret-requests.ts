import type { HostMessage, PluginMessage, SecretFillRequest, SecretResolution } from '@morrowbot/contracts';

/** Resolves one vault secret for a running tool call. Only built-in plugins with the `secrets` permission get one. */
export type SecretResolver = (request: SecretFillRequest) => Promise<SecretResolution>;

export interface SecretAnswerDeps {
  readonly secrets: SecretResolver | null;
  /** The tool call still waiting on request id `callId`, or undefined once it has ended. */
  readonly callOf: (callId: number) => object | undefined;
  readonly send: (message: HostMessage) => void;
}

/** Answers one `secret-request`. A value goes out only while the tool call that asked is still the one waiting. */
export async function answerSecret({ secretId, callId, request }: Extract<PluginMessage, { kind: 'secret-request' }>, { secrets, callOf, send }: SecretAnswerDeps): Promise<void> {
  const call = callOf(callId);
  const resolution = await resolve(secrets, call === undefined, request);
  const live = call !== undefined && callOf(callId) === call;
  send({ kind: 'secret-result', secretId, resolution: live || resolution.kind === 'refused' ? resolution : { kind: 'refused', reason: 'The tool call ended.' } });
}

async function resolve(secrets: SecretResolver | null, noCall: boolean, request: SecretFillRequest): Promise<SecretResolution> {
  if (secrets === null) return { kind: 'refused', reason: 'Only plugins that ship with Ori Bot and ask for the secrets permission may use the Secrets Vault.' };
  if (noCall) return { kind: 'refused', reason: 'Secrets are given only during a tool call.' };
  try {
    return await secrets(request);
  } catch {
    return { kind: 'refused', reason: 'The Secrets Vault could not be read.' };
  }
}
