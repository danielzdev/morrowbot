/** "How to set up" for when a command cannot be shown safely, or the provider gave none (spec §6.2, owner decision O3). */
export interface SetupGuide {
  readonly steps: readonly string[];
  /** The vendor's own install page. */
  readonly link: { readonly label: string; readonly url: string } | null;
}

const GUIDES: Readonly<Record<string, SetupGuide>> = {
  'provider-claude': {
    steps: ['Install Claude Code.', 'In a terminal, run claude once and sign in with your Claude account.'],
    link: { label: 'Claude Code setup', url: 'https://docs.claude.com/claude-code' },
  },
  'provider-openai': {
    steps: ['Install the Codex CLI.', 'In a terminal, run codex login and sign in with your ChatGPT account.'],
    link: { label: 'Codex CLI setup', url: 'https://developers.openai.com/codex/cli' },
  },
  'provider-antigravity': {
    steps: ['Install Google Antigravity with its agy command-line tool.', 'Open Antigravity once and sign in with your Google account.'],
    link: { label: 'Google Antigravity', url: 'https://antigravity.google' },
  },
  'provider-opencode': {
    steps: ['Install the opencode CLI, version 2.4. Its free models need no account or sign-in.'],
    link: { label: 'opencode', url: 'https://opencode.ai' },
  },
};

const COMMUNITY: SetupGuide = { steps: ['Follow the setup steps of the plugin that adds this provider.'], link: null };

/** Every guide ends by coming back to MorrowBot. */
export const AFTER_SETUP = 'When it finishes, press Recheck.';

export function guideFor(providerId: string): SetupGuide {
  return GUIDES[providerId] ?? COMMUNITY;
}
