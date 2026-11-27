import { z } from '@morrowbot/plugin-sdk';

/**
 * The parts of the Codex `app-server` protocol this plugin reads, written from
 * `codex app-server generate-json-schema --experimental` of the pinned version (`schema/pinned.json`).
 * Every payload is a loose object holding only the fields used.
 */

export const InitializeResponse = z.looseObject({
  userAgent: z.string(),
  codexHome: z.string().nullish(),
});

/** `account.type` is the auth class: `chatgpt`, `apiKey`, `amazonBedrock`, `gcp`, or one added later. */
const Account = z.looseObject({
  type: z.string(),
  email: z.string().nullish(),
  planType: z.string().nullish(),
  workspaceName: z.string().nullish(),
});

/** Present only with `initialize.capabilities.experimentalApi: true`. */
const WorkspaceRouting = z.looseObject({
  chatgptAccountId: z.string().min(1),
  backendOrigin: z.string().min(1),
  accountRoutingOverride: z.string().nullish(),
});

export const GetAccountResponse = z.looseObject({
  account: Account.nullable(),
  userId: z.string().nullish(),
  requiresOpenaiAuth: z.boolean(),
  workspaceRouting: WorkspaceRouting.nullish(),
});
export type GetAccountResponse = z.infer<typeof GetAccountResponse>;

const Url = z.string().nullish();

/** The effective config (`config/read`): the route keys, and what MorrowBot turns off per thread. */
export const ConfigReadResponse = z.looseObject({
  config: z.looseObject({
    model_provider: z.string().nullish(),
    profile: z.string().nullish(),
    openai_base_url: Url,
    chatgpt_base_url: Url,
    model_providers: z.record(z.string(), z.looseObject({ base_url: Url, auth: z.looseObject({ command: z.unknown().optional() }).nullish(), aws: z.unknown().optional() })).nullish(),
    mcp_servers: z.record(z.string(), z.unknown()).nullish(),
  }),
});
export type CodexConfig = z.infer<typeof ConfigReadResponse>['config'];

/** Managed requirements (`requirements.toml`, MDM): null when an administrator set none. */
export const ConfigRequirementsResponse = z.looseObject({ requirements: z.unknown().nullish() });

const RateLimitWindow = z.looseObject({
  usedPercent: z.number(),
  windowDurationMins: z.number().nullish(),
  resetsAt: z.number().nullish(),
});

export const RateLimitSnapshot = z.looseObject({
  limitId: z.string().nullish(),
  planType: z.string().nullish(),
  primary: RateLimitWindow.nullish(),
  secondary: RateLimitWindow.nullish(),
  individualLimit: z.looseObject({ remainingPercent: z.number(), resetsAt: z.number().nullish() }).nullish(),
});
export type RateLimitSnapshot = z.infer<typeof RateLimitSnapshot>;

export const GetAccountRateLimitsResponse = z.looseObject({
  rateLimits: RateLimitSnapshot,
  rateLimitsByLimitId: z.record(z.string(), RateLimitSnapshot).nullish(),
  /** The workspace the backend counted this usage for; nullable in the pinned schema. */
  accountId: z.string().nullish(),
});
export type GetAccountRateLimitsResponse = z.infer<typeof GetAccountRateLimitsResponse>;

const ReasoningEffortOption = z.looseObject({ reasoningEffort: z.string().min(1) });

export const ModelListResponse = z.looseObject({
  data: z.array(
    z.looseObject({
      model: z.string().min(1),
      displayName: z.string(),
      hidden: z.boolean().nullish(),
      isDefault: z.boolean(),
      supportedReasoningEfforts: z.array(ReasoningEffortOption),
      defaultReasoningEffort: z.string().nullish(),
    }),
  ),
  nextCursor: z.string().nullish(),
});
export type CodexModel = z.infer<typeof ModelListResponse>['data'][number];

/** The daemon's own report of a started or resumed thread's permissions and instructions. */
export const ThreadOpened = z.looseObject({
  thread: z.looseObject({ id: z.string().min(1) }),
  model: z.string().nullish(),
  modelProvider: z.string(),
  approvalPolicy: z.unknown(),
  sandbox: z.looseObject({ type: z.string(), networkAccess: z.boolean().nullish() }),
  activePermissionProfile: z.unknown().optional(),
  instructionSources: z.array(z.string()).nullish(),
});
export type ThreadOpened = z.infer<typeof ThreadOpened>;

export const TurnStartResponse = z.looseObject({ turn: z.looseObject({ id: z.string().min(1) }) });

/** A result whose content is not used. */
export const Ignored = z.unknown();

/** `unsubscribed`, `notSubscribed` or `notLoaded`. */
export const ThreadUnsubscribed = z.looseObject({ status: z.string() });

export const ThreadLoadedListResponse = z.looseObject({ data: z.array(z.string()), nextCursor: z.string().nullish() });

export const McpServerStatusList = z.looseObject({
  data: z.array(z.looseObject({ name: z.string(), runtimeStatus: z.string().nullish() })),
  nextCursor: z.string().nullish(),
});

export const HooksList = z.looseObject({
  data: z.array(z.looseObject({ hooks: z.array(z.unknown()) })),
});

const TokenUsageBreakdown = z.looseObject({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  cacheWriteInputTokens: z.number().nullish(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
});
export type TokenUsageBreakdown = z.infer<typeof TokenUsageBreakdown>;

export const TokenUsageUpdated = z.looseObject({
  threadId: z.string(),
  turnId: z.string(),
  tokenUsage: z.looseObject({ total: TokenUsageBreakdown, last: TokenUsageBreakdown }),
});
export type TokenUsageUpdated = z.infer<typeof TokenUsageUpdated>;

const TurnError = z.looseObject({
  message: z.string(),
  /** A string such as `usageLimitExceeded`, or an object such as `{httpConnectionFailed: {...}}`. */
  codexErrorInfo: z.unknown().optional(),
});
export type TurnError = z.infer<typeof TurnError>;

export const TurnStarted = z.looseObject({ threadId: z.string(), turn: z.looseObject({ id: z.string().min(1) }) });

export const TurnCompleted = z.looseObject({
  threadId: z.string(),
  turn: z.looseObject({ id: z.string(), status: z.string(), error: TurnError.nullish() }),
});

export const AgentMessageDelta = z.looseObject({ threadId: z.string(), turnId: z.string(), itemId: z.string(), delta: z.string() });

/** A thread item: only the fields shown for tool calls are read. */
export const ThreadItem = z.looseObject({
  type: z.string(),
  id: z.string(),
  text: z.string().nullish(),
  command: z.string().nullish(),
  status: z.string().nullish(),
  server: z.string().nullish(),
  tool: z.string().nullish(),
  query: z.string().nullish(),
  path: z.string().nullish(),
  changes: z.array(z.looseObject({ path: z.string() })).nullish(),
});
export type ThreadItem = z.infer<typeof ThreadItem>;

export const ItemEvent = z.looseObject({ threadId: z.string(), turnId: z.string(), item: ThreadItem });

export const ErrorNotification = z.looseObject({ threadId: z.string(), turnId: z.string(), willRetry: z.boolean(), error: TurnError });

export const ModelRerouted = z.looseObject({ threadId: z.string(), turnId: z.string(), toModel: z.string().min(1) });

/** Any notification about one thread: how turn events are routed. */
export const ThreadScoped = z.looseObject({ threadId: z.string() });

export const ThreadStatusChanged = z.looseObject({ threadId: z.string(), status: z.looseObject({ type: z.string() }) });
