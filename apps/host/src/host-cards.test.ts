import { Agent, PluginList, ThreadCard, ThreadCardList, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hidePid } from './testing/chat-fixture.ts';
import { startMemberKit, type MemberKit } from './testing/member-kit.ts';

let kit: MemberKit;
beforeEach(async () => {
  kit = await startMemberKit();
});
afterEach(async () => {
  await kit.close();
  expect(kit.chat.host.errors).toEqual([]);
});

const MEETING = {
  kind: 'custom',
  ui: {
    fallbackText: 'When should we meet? Monday or Tuesday.',
    blocks: [
      { kind: 'header', text: 'When should we meet?' },
      { kind: 'kv', items: [{ label: 'Length', value: '30 minutes' }] },
      { kind: 'choices', options: [{ id: 'mon', label: 'Monday' }, { id: 'tue', label: 'Tuesday' }] },
    ],
  },
};

const tool = (name: string, args: object): string => `host-tool ${name} ${JSON.stringify(args)}`;

async function cards(thread: Thread): Promise<ThreadCard[]> {
  return ThreadCardList.parse((await kit.chat.host.call('GET', `/api/ui/v1/threads/${thread.id}/cards`)).body).cards;
}

/** One card as a line: its kind, where it is, and what the user did with it. */
function line(card: ThreadCard): string {
  const where = card.messageId === null ? 'staged' : `on ${card.messageId}`;
  const { body } = card;
  switch (body.kind) {
    case 'custom':
      return `custom r${String(card.revision)} ${where}: answer ${body.answer ?? 'none'}`;
    case 'plugin':
      return `plugin r${String(card.revision)} ${where}: ${body.plugin.name} [${body.plugin.permissions.join(', ')}] ${body.state}`;
    case 'setting':
      return `setting r${String(card.revision)} ${where}: ${body.settingId} ${body.on ? 'on' : 'off'}`;
  }
}

async function act(thread: Thread, card: ThreadCard | undefined, action: object, token?: string): Promise<string> {
  const route = `/api/ui/v1/threads/${thread.id}/cards/${card?.id ?? 'missing'}/act`;
  const reply = token === undefined ? await kit.chat.host.call('POST', route, action) : await kit.as(token, 'POST', route, action);
  const parsed = ThreadCard.safeParse(reply.body);
  return `${String(reply.status)} ${parsed.success ? line(parsed.data) : JSON.stringify(reply.body)}`;
}

it('stages an agent’s cards live, keeps them with its reply, and acts only on a click the host checks', async () => {
  const { chat } = kit;
  const { agent, thread } = await kit.named('Helper');
  const other = await kit.named('Other');
  await chat.host.call('PUT', '/api/plugins/faulty/enabled', { enabled: false });
  await chat.send(
    thread,
    [
      tool('search_marketplace', { query: 'faulty' }),
      tool('propose_card', { card: MEETING }),
      tool('propose_card', { card: { kind: 'plugin', pluginId: 'faulty' } }),
      tool('propose_card', { card: { kind: 'setting', settingId: 'agent-emoji-replies' } }),
    ].join('\n'),
  );
  const guest = await kit.join('Guest', { kind: 'scoped', agents: [{ agentId: agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }] });
  const saved = await cards(thread);
  const [meeting, plugin, setting] = saved;
  const liveEvents = chat.events.received.flatMap((event) =>
    event.kind === 'card.changed' ? [line(event.card)] : event.kind === 'generation.finished' && event.threadId === thread.id ? [`finished ${event.message.id}`] : [],
  );

  const clicks = {
    wrongKind: await act(thread, meeting, { kind: 'install' }),
    unknownChoice: await act(thread, meeting, { kind: 'choose', choiceId: 'wed' }),
    choose: await act(thread, meeting, { kind: 'choose', choiceId: 'mon' }),
  };
  await chat.events.until((event) => event.kind === 'generation.finished' && event.threadId === thread.id && event.message.text.includes('Monday'));
  const later = {
    chooseAgain: await act(thread, meeting, { kind: 'choose', choiceId: 'tue' }),
    guestInstall: await act(thread, plugin, { kind: 'install' }, guest.token),
    guestToggle: await act(thread, setting, { kind: 'set', on: false }, guest.token),
    install: await act(thread, plugin, { kind: 'install' }),
    installAgain: await act(thread, plugin, { kind: 'install' }),
    toggleOff: await act(thread, setting, { kind: 'set', on: false }),
    fromAnotherChat: await act(other.thread, setting, { kind: 'set', on: true }),
    unknownCard: await act(thread, undefined, { kind: 'cancel' }),
  };
  const plugins = PluginList.parse((await chat.host.call('GET', '/api/plugins')).body).plugins;
  const helper = Agent.parse((await chat.host.call('GET', `/api/agents/${agent.id}`)).body);

  expect({
    history: (await chat.history(thread)).map((each) => hidePid(each).split('\n')[0]),
    liveEvents,
    saved: saved.map(line),
    clicks,
    later,
    afterwards: {
      cards: (await cards(thread)).map(line),
      faultyEnabled: plugins.find(({ manifest }) => manifest.id === 'faulty')?.enabled,
      emojiReplies: helper.emojiReplies,
    },
  }).toMatchInlineSnapshot(`
    {
      "afterwards": {
        "cards": [
          "custom r1 on id-10: answer mon",
          "plugin r1 on id-10: Faulty [shell] installed",
          "setting r1 on id-10: agent-emoji-replies off",
        ],
        "emojiReplies": "off",
        "faultyEnabled": true,
      },
      "clicks": {
        "choose": "200 custom r1 on id-10: answer mon",
        "unknownChoice": "400 {"error":{"kind":"invalid_request","message":"This card has no such choice."}}",
        "wrongKind": "400 {"error":{"kind":"invalid_request","message":"This card takes a choice."}}",
      },
      "history": [
        "user: host-tool search_marketplace {"query":"faulty"}",
        "assistant(completed): search_marketplace: {"plugins":[{"pluginId":"faulty","name":"Faulty","description":"","kind":"tool","permissions":["shell"],"installed":false}],"note":"These are the plugins in MorrowBot’s plugins folders. Offer one with propose_card (kind \\"plugin\\")."}",
        "user: Monday",
        "assistant(completed): hello from pid <pid>: Monday",
      ],
      "later": {
        "chooseAgain": "409 {"error":{"kind":"conflict","message":"This card was answered already."}}",
        "fromAnotherChat": "404 {"error":{"kind":"not_found","message":"Card not found"}}",
        "guestInstall": "403 {"error":{"kind":"forbidden","message":"Only the server owner can use this card."}}",
        "guestToggle": "403 {"error":{"kind":"forbidden","message":"Only the server owner can use this card."}}",
        "install": "200 plugin r1 on id-10: Faulty [shell] installed",
        "installAgain": "409 {"error":{"kind":"conflict","message":"This plugin is installed already."}}",
        "toggleOff": "200 setting r1 on id-10: agent-emoji-replies off",
        "unknownCard": "404 {"error":{"kind":"not_found","message":"Card not found"}}",
      },
      "liveEvents": [
        "custom r0 staged: answer none",
        "plugin r0 staged: Faulty [shell] offered",
        "setting r0 staged: agent-emoji-replies on",
        "finished id-10",
      ],
      "saved": [
        "custom r0 on id-10: answer none",
        "plugin r0 on id-10: Faulty [shell] offered",
        "setting r0 on id-10: agent-emoji-replies on",
      ],
    }
  `);
});

it('offers no plugins or settings from an agent shared with members, and still takes its own cards', async () => {
  const { chat } = kit;
  const { agent, thread } = await kit.named('Helper');
  await kit.join('Guest', { kind: 'scoped', agents: [{ agentId: agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }] });
  await chat.send(
    thread,
    [
      tool('search_marketplace', {}),
      tool('propose_card', { card: { kind: 'plugin', pluginId: 'faulty' } }),
      tool('propose_card', { card: { kind: 'setting', settingId: 'agent-emoji-replies' } }),
      tool('propose_card', { card: MEETING }),
    ].join('\n'),
  );
  const [, reply] = (await chat.history(thread)).map(hidePid);
  expect({ reply, cards: (await cards(thread)).map(line) }).toMatchInlineSnapshot(`
    {
      "cards": [
        "custom r0 on id-7: answer none",
      ],
      "reply": "assistant(completed): search_marketplace: error Plugin and setting cards are not available to agents shared with other people.
    propose_card: error Plugin and setting cards are not available to agents shared with other people.
    propose_card: error Plugin and setting cards are not available to agents shared with other people.
    propose_card: {"cardId":"id-6","note":"The card shows in the desktop chat now and stays with your reply. Say in a line what it offers or asks: the phone app shows only your text."}",
    }
  `);
});

it('refuses a card that is not plain blocks, a plugin or setting it does not know, and a fourth card in one reply', async () => {
  const { chat } = kit;
  const { thread } = await kit.named('Helper');
  const block = (extra: object) => tool('propose_card', { card: { kind: 'custom', ui: { fallbackText: 'Hi', blocks: [extra] } } });
  const sent = await chat.send(
    thread,
    [
      block({ kind: 'html', html: '<img src=x onerror=alert(1)>' }),
      block({ kind: 'text', text: 'Hi', style: 'color: red' }),
      block({ kind: 'text', text: 'invoice\u202Etxt.exe' }),
      tool('propose_card', { card: { kind: 'custom', ui: { fallbackText: 'Hi', blocks: [{ kind: 'choices', options: [{ id: 'a', label: 'A' }] }, { kind: 'choices', options: [{ id: 'b', label: 'B' }] }] } } }),
      tool('propose_card', { card: { kind: 'plugin', pluginId: 'nowhere' } }),
      tool('propose_card', { card: { kind: 'setting', settingId: 'safe-mode' } }),
      block({ kind: 'text', text: '<b>shown as text</b>' }),
      block({ kind: 'divider' }),
      block({ kind: 'divider' }),
      block({ kind: 'divider' }),
    ].join('\n'),
  );
  expect({ status: sent.status, history: await chat.history(thread), cards: (await cards(thread)).map(line) }).toMatchInlineSnapshot(`
    {
      "cards": [
        "custom r0 on id-8: answer none",
        "custom r0 on id-8: answer none",
        "custom r0 on id-8: answer none",
      ],
      "history": [
        "user: host-tool propose_card {"card":{"kind":"custom","ui":{"fallbackText":"Hi","blocks":[{"kind":"html","html":"<img src=x onerror=alert(1)>"}]}}}
    host-tool propose_card {"card":{"kind":"custom","ui":{"fallbackText":"Hi","blocks":[{"kind":"text","text":"Hi","style":"color: red"}]}}}
    host-tool propose_card {"card":{"kind":"custom","ui":{"fallbackText":"Hi","blocks":[{"kind":"text","text":"invoice\u202Etxt.exe"}]}}}
    host-tool propose_card {"card":{"kind":"custom","ui":{"fallbackText":"Hi","blocks":[{"kind":"choices","options":[{"id":"a","label":"A"}]},{"kind":"choices","options":[{"id":"b","label":"B"}]}]}}}
    host-tool propose_card {"card":{"kind":"plugin","pluginId":"nowhere"}}
    host-tool propose_card {"card":{"kind":"setting","settingId":"safe-mode"}}
    host-tool propose_card {"card":{"kind":"custom","ui":{"fallbackText":"Hi","blocks":[{"kind":"text","text":"<b>shown as text</b>"}]}}}
    host-tool propose_card {"card":{"kind":"custom","ui":{"fallbackText":"Hi","blocks":[{"kind":"divider"}]}}}
    host-tool propose_card {"card":{"kind":"custom","ui":{"fallbackText":"Hi","blocks":[{"kind":"divider"}]}}}
    host-tool propose_card {"card":{"kind":"custom","ui":{"fallbackText":"Hi","blocks":[{"kind":"divider"}]}}}",
        "assistant(completed): propose_card: error ✖ Invalid discriminator value. Expected 'header' | 'text' | 'kv' | 'list' | 'badges' | 'divider' | 'choices'
      → at card.ui.blocks[0].kind
    propose_card: error ✖ Unrecognized key: "style"
      → at card.ui.blocks[0]
    propose_card: error ✖ Remove control, invisible and text-direction characters
      → at card.ui.blocks[0].text
    propose_card: error ✖ Use at most one choices block
      → at card.ui
    propose_card: error No plugin "nowhere" is in the Marketplace. Call search_marketplace to see which are.
    propose_card: error ✖ Invalid input: expected "agent-emoji-replies"
      → at card.settingId
    propose_card: {"cardId":"id-5","note":"The card shows in the desktop chat now and stays with your reply. Say in a line what it offers or asks: the phone app shows only your text."}
    propose_card: {"cardId":"id-6","note":"The card shows in the desktop chat now and stays with your reply. Say in a line what it offers or asks: the phone app shows only your text."}
    propose_card: {"cardId":"id-7","note":"The card shows in the desktop chat now and stays with your reply. Say in a line what it offers or asks: the phone app shows only your text."}
    propose_card: error A reply holds at most 3 cards.",
      ],
      "status": 202,
    }
  `);
});

it('drops a turn’s cards when it ends with no reply in the chat', async () => {
  const { chat } = kit;
  const { thread } = await kit.named('Helper');
  await chat.send(thread, [tool('propose_card', { card: MEETING }), tool('stay_quiet', {})].join('\n'));
  const staged = chat.events.received.filter((event) => event.kind === 'card.changed').length;
  expect({ staged, cards: await cards(thread) }).toMatchInlineSnapshot(`
    {
      "cards": [],
      "staged": 1,
    }
  `);
});
