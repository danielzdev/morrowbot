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

## Run

```sh
npm install                       # from the repo root
npm run prebuild -w apps/mobile   # generates ios/ (needs CocoaPods)
npm run ios -w apps/mobile        # builds the dev client and opens the simulator
```

Unit tests for the pure engine run with the root `npm test`.
