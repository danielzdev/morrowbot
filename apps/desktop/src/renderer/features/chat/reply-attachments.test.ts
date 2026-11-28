import type { ReplyAttachment } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { ReplyAttachments } from './ReplyAttachments.tsx';

const FILES = { url: (id: string) => `morrowbot-file://reply/${id}`, act: () => Promise.resolve({ kind: 'cancelled' as const }) };

it('shows images and videos inline, a PDF as a card to open or save, and an unknown file only to save', () => {
  const attachments: ReplyAttachment[] = [
    { kind: 'image', id: 'i1', name: 'chart.png', mimeType: 'image/png', size: 48_213 },
    { kind: 'video', id: 'v1', name: 'demo.mp4', mimeType: 'video/mp4', size: 3_407_872 },
    { kind: 'file', id: 'f1', name: 'Morning Report.pdf', mimeType: 'application/pdf', size: 1_258_291 },
    { kind: 'file', id: 'f2', name: 'tool.bin', mimeType: 'application/octet-stream', size: 12 },
  ];
  const html = renderToString(h(ReplyAttachments, { attachments, files: FILES }));
  const shown = [...html.matchAll(/<(img|video|button|span class="reply-file-(?:name|meta|badge)")[^>]*>([^<]*)/g)].map(([shownTag = '']) => shownTag.replace(/ (?:class|loading|title)="[^"]*"/g, ''));
  expect(shown).toMatchInlineSnapshot(`
    [
      "<button aria-label="Open chart.png">",
      "<img src="morrowbot-file://reply/i1" alt="chart.png"/>",
      "<span>chart.png",
      "<span>47 KB",
      "<button aria-label="Save chart.png">Save…",
      "<video src="morrowbot-file://reply/v1" controls preload="metadata" aria-label="demo.mp4">",
      "<span>demo.mp4",
      "<span>3.3 MB",
      "<button aria-label="Save demo.mp4">Save…",
      "<span>PDF",
      "<span>Morning Report.pdf",
      "<span>PDF · 1.2 MB",
      "<button aria-label="Open Morning Report.pdf">Open",
      "<button aria-label="Save Morning Report.pdf">Save…",
      "<span>tool.bin",
      "<span>File · 12 B",
      "<button aria-label="Save tool.bin">Save…",
    ]
  `);
});
