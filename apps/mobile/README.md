# Ori Bot Mobile

Expo (dev client) + React Native app for iOS, built first for iPhone Duo folded and unfolded.

## Layout

- `modules/morrow-native-controls/` — local Expo module. `MorrowLayoutMetricsView` reports size
  classes, hinge, the system vertical bar edge and reserved regions (iOS 27.1+);
  `MorrowOrientationSubscriber` lets hinge windows rotate.
- `src/lib/` — shared, pure code: the hinge-safe layout engine (`reserved-regions.ts`,
  `layout.ts`), theme tokens (`theme.ts`, matching desktop), and the slot contract
  (`workspace.ts`) between the shell and feature slices.
- `src/features/layout/` — the adaptive shell: native tab rail, folded push stack, unfolded split
  with the `⤢` toggle, floating Liquid Glass actions.
- `src/features/<slice>/` — one folder per feature slice. Each exports its slots from `index.ts`;
  `src/app/registry.ts` wires them in. A new detail screen is a new kind in `DetailRouteMap` plus
  its slot in the registry; the shell does not change.
- `src/features/chat/` — the chat canvas, approvals, composer and Agent Settings sheet. It talks to
  the host only through `ChatHost` (`src/lib/chat-host.ts`); `src/features/extensions/` through
  its plugin part, `ExtensionsHost`. `src/app/HostProviders.tsx` hands both the active paired
  host (`createLiveChatHost` in `features/connection`), and the Agents and Threads lists that
  host's directory; with no host paired, all three show the built-in sample host (made-up agents).

## Host connection

- `src/lib/host-connection.ts` is the contract every screen uses (`useHostConnection()`); only
  `src/features/connection/` provides it and ever sees a device token.
- Pairing: scan the desktop's QR (`oribot://pair?url=…&code=…`, in-app or with the system
  Camera) or type the host address and 6-digit code. Tokens live in the iOS Keychain, this device
  only.
- `/api/events` closes when the app goes to the background and reconnects as soon as it is
  active again; a dropped socket retries with backoff (0.5 s doubling to 30 s). On every
  reconnect, and on `resync`, each watched thread fetches `/state` first and then subscribes
  from that cursor. Until then the thread is stale and its actions are disabled.
- The Agents and Threads lists load `/api/agents` and `/api/threads` (each thread with its activity and newest
  message) when the link comes online, then follow the host's global `thread.changed` frames: new chats,
  previews, order, working dots and badges update live. A reply that arrives while its chat is not on screen is
  unread on this phone until the chat is opened.
- Host replies are parsed with `lenient()`, so newer hosts can add fields.

## Run

```sh
npm install                       # from the repo root
npm run prebuild -w apps/mobile   # generates ios/ (needs CocoaPods)
npm run ios -w apps/mobile        # builds the dev client and opens the simulator
```

Tests run with the root `npm test`; the connection tests start a real host process.
