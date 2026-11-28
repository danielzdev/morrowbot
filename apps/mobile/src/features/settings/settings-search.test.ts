import { describe, expect, it } from 'vitest';
import { describeLink } from './link-status.ts';
import { searchSections } from './sections.ts';

describe('searchSections', () => {
  it('finds sections by name and by the words people use for them', () => {
    expect(['', 'tail', 'DARK', 'models', 'qr code', 'pair usage', 'xyz'].map((query) => [query, searchSections(query).map((info) => info.section)]))
      .toMatchInlineSnapshot(`
        [
          [
            "",
            [
              "connections",
              "notifications",
              "appearance",
              "providers",
              "usage",
            ],
          ],
          [
            "tail",
            [
              "connections",
            ],
          ],
          [
            "DARK",
            [
              "appearance",
            ],
          ],
          [
            "models",
            [
              "providers",
            ],
          ],
          [
            "qr code",
            [
              "connections",
            ],
          ],
          [
            "pair usage",
            [],
          ],
          [
            "xyz",
            [],
          ],
        ]
      `);
  });
});

describe('describeLink', () => {
  it('counts down to the next reconnect', () => {
    expect([
      describeLink({ kind: 'connecting', attempt: 0 }, 0),
      describeLink({ kind: 'reconnecting', attempt: 2, retryAt: 4_200 }, 1_000),
      describeLink({ kind: 'reconnecting', attempt: 2, retryAt: 1_000 }, 1_000),
    ].map((label) => label.label)).toMatchInlineSnapshot(`
      [
        "Connecting…",
        "Offline · retrying in 4 s",
        "Offline · retrying in 1 s",
      ]
    `);
  });
});
