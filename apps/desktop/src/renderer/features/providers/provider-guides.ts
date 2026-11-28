/** "How to set up" for when a command cannot be shown safely, or the provider gave none (spec §6.2, owner decision O3). */
export interface SetupGuide {
  readonly steps: readonly string[];
  /** This engine's section of the Ori Kami setup guide, which links on to the vendor's own pages. */
  readonly link: { readonly label: string; readonly url: string } | null;
}

/** The Ori Kami setup guide (owner decision O3): one docs page with a section per built-in engine. */
export const SETUP_GUIDE_URL = 'https://github.com/danielzdev/ori-kami/blob/main/docs/setup.md';

const guideLink = (anchor: string) => ({ label: 'Ori Kami setup guide', url: `${SETUP_GUIDE_URL}#${anchor}` });

const GUIDES: Readonly<Record<string, SetupGuide>> = {
  'provider-claude': {
    steps: ['Install Claude Code.', 'In a terminal, run claude once and sign in with your Claude account.'],
    link: guideLink('claude'),
  },
  'provider-openai': {
    steps: ['Install the Codex CLI.', 'In a terminal, run codex login and sign in with your ChatGPT account.'],
    link: guideLink('openai-codex'),
  },
  'provider-antigravity': {
    steps: ['Install Google Antigravity with its agy command-line tool.', 'Open Antigravity once and sign in with your Google account.'],
    link: guideLink('google-antigravity'),
  },
  'provider-opencode': {
    steps: ['Install the opencode CLI, version 2.4. Its free models need no account or sign-in.'],
    link: guideLink('opencode'),
  },
};

const COMMUNITY: SetupGuide = { steps: ['Follow the setup steps of the plugin that adds this provider.'], link: null };

/** Every guide ends by coming back to Ori Kami. */
export const AFTER_SETUP = 'When it finishes, come back: Ori Kami rechecks by itself, or press Recheck.';

export function guideFor(providerId: string): SetupGuide {
  return GUIDES[providerId] ?? COMMUNITY;
}
