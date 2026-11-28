import { Connector, type ConnectorScope, type ConnectorStatus } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { checklistRows, pendingWrites, reloadRow, settle, stage, switchWarning, type Checklist } from './agent-checklist.ts';

const EVERYONE = ['errand', 'money', 'reading'];
const AT = '2026-01-01T00:00:00.000Z';

const connector = (id: string, scope: Partial<ConnectorScope>, status: ConnectorStatus = { kind: 'connected', toolCount: 1 }): Connector =>
  Connector.parse({
    id,
    label: id,
    labelKey: id,
    setup: { kind: 'http', url: 'https://example.com/mcp', headerNames: [] },
    enabled: true,
    connected: true,
    scope: { mode: 'selected', agentIds: [], revision: 1, scopeReviewRequired: false, ...scope },
    status,
    tools: [],
    createdAt: AT,
    updatedAt: AT,
  });

const shared = connector('shared', { mode: 'all', revision: 4 });
const notes = connector('notes', { agentIds: ['money'], revision: 7 }, { kind: 'reconnect_needed', message: 'Sign in again' });
const starting = connector('starting', { agentIds: ['errand'] }, { kind: 'starting' });
const all = [shared, notes, starting];

/** Both working rows changed: Errand Bot leaves the All-agents one and joins the other. */
const changed = (): Checklist => stage(stage({}, shared, 'errand', false), notes, 'errand', true);

const shown = (connectors: readonly Connector[], checklist: Checklist) =>
  checklistRows(connectors, checklist, 'errand').map(({ connector: { id }, checked, allAgents, editable, change }) =>
    [id, checked ? 'given' : 'not given', ...(allAgents ? ['All agents'] : []), ...(editable ? [] : ['dimmed']), change.kind].join(' · '),
  );

it('stages a change per row and writes each with the revision it was loaded at', () => {
  const checklist = changed();
  const rows = checklistRows(all, checklist, 'errand');
  expect({ rows: shown(all, checklist), writes: pendingWrites(rows, checklist, 'errand', EVERYONE) }).toMatchInlineSnapshot(`
    {
      "rows": [
        "shared · not given · staged",
        "notes · given · staged",
        "starting · given · dimmed · none",
      ],
      "writes": [
        {
          "id": "shared",
          "request": {
            "agentIds": [
              "money",
              "reading",
            ],
            "mode": "selected",
            "revision": 4,
          },
        },
        {
          "id": "notes",
          "request": {
            "agentIds": [
              "money",
              "errand",
            ],
            "mode": "selected",
            "revision": 7,
          },
        },
      ],
    }
  `);
});

it('drops a change that is put back', () => {
  expect(stage(stage(changed(), shared, 'errand', true), notes, 'errand', false)).toEqual({});
});

it('keeps writing the loaded revision when the list moves on underneath a staged change', () => {
  const newer = connector('notes', { agentIds: ['reading'], revision: 9 });
  const checklist = stage(stage({}, notes, 'errand', true), newer, 'errand', true);
  const rows = checklistRows([newer], checklist, 'errand');
  expect(pendingWrites(rows, checklist, 'errand', EVERYONE).map(({ request }) => request)).toEqual([{ mode: 'selected', agentIds: ['money', 'errand'], revision: 7 }]);
});

it('leaves a conflicted row dirty and never sends it again until it is reloaded', () => {
  const newer: ConnectorScope = { mode: 'selected', agentIds: ['reading'], revision: 9, scopeReviewRequired: false };
  const saved = settle(settle(changed(), 'shared', { kind: 'saved' }), 'notes', { kind: 'conflict', current: newer });
  const retried = stage(saved, notes, 'errand', false);
  const written = connector('shared', { agentIds: ['money', 'reading'], revision: 5 });
  expect({
    afterSave: shown([written, notes], retried),
    writes: pendingWrites(checklistRows([written, notes], retried, 'errand'), retried, 'errand', EVERYONE),
    afterReload: shown([written, { ...notes, scope: newer }], reloadRow(retried, 'notes')),
  }).toMatchInlineSnapshot(`
    {
      "afterReload": [
        "shared · not given · none",
        "notes · not given · none",
      ],
      "afterSave": [
        "shared · not given · none",
        "notes · given · conflict",
      ],
      "writes": [],
    }
  `);
});

it('sends a refused row again, and not a change to a row that stopped working', () => {
  const checklist = settle(changed(), 'notes', { kind: 'refused', message: 'The host is busy' });
  const broken = connector('shared', { mode: 'all', revision: 4 }, { kind: 'crashed', message: 'Exited (1)' });
  const rows = checklistRows([broken, notes], checklist, 'errand');
  expect({ rows: shown([broken, notes], checklist), writes: pendingWrites(rows, checklist, 'errand', EVERYONE).map(({ id }) => id) }).toEqual({
    rows: ['shared · given · All agents · dimmed · none', 'notes · given · refused'],
    writes: ['notes'],
  });
});

it('asks before leaving an All-agents connector, naming who keeps it', () => {
  expect([switchWarning('Gmail', 'Errand Bot', 3), switchWarning('Gmail', 'Errand Bot', 1)]).toMatchInlineSnapshot(`
    [
      "Turn off Gmail for Errand Bot? On Save, Gmail switches from All agents to Selected agents: everyone except Errand Bot.",
      "Turn off Gmail for Errand Bot? On Save, Gmail switches from All agents to Selected agents: no agents.",
    ]
  `);
});
