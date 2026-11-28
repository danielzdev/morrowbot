# MorrowBot Mobile

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

## Host connection

- `src/lib/host-connection.ts` is the contract every screen uses (`useHostConnection()`); only
  `src/features/connection/` provides it and ever sees a device token.
- Pairing: scan the desktop's QR (`morrowbot://pair?url=…&code=…`, in-app or with the system
  Camera) or type the host address and 6-digit code. Tokens live in the iOS Keychain, this device
  only.
- `/api/events` closes when the app goes to the background and reconnects as soon as it is
  active again; a dropped socket retries with backoff (0.5 s doubling to 30 s). On every
  reconnect, and on `resync`, each watched thread fetches `/state` first and then subscribes
  from that cursor. Until then the thread is stale and its actions are disabled.
- Host replies are parsed with `lenient()`, so newer hosts can add fields.

## Run

```sh
npm install                       # from the repo root
npm run prebuild -w apps/mobile   # generates ios/ (needs CocoaPods)
npm run ios -w apps/mobile        # builds the dev client and opens the simulator
```

Tests run with the root `npm test`; the connection tests start a real host process.
