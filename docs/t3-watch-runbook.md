# T3 watch runbook (orchestrator)

How an orchestrator agent launches T3 Code threads, has the Ori Kami host watch them, and handles the updates the host sends back. The host watches; the orchestrator acts.

> **Preferred interface for Ori Kami agents:** Agents running inside Ori Kami receive built-in MCP tools directly — use `watch_t3_thread`, `list_t3_watches`, `ack_t3_batch`, `unwatch_t3_thread`, and routine tools (`list_routines`, `create_routine`, `update_routine`, `delete_routine`, `routine_no_update`) instead of writing JSONL files by hand. The JSONL file protocol below remains available for external scripts and hosts without tool access.

## The pieces

- **The orchestrator:** one Ori Kami agent. It launches and steers T3 Code threads with the `t3` CLI.
- **Its updates routine:** a *manual* routine of that agent (for example "T3 updates"), used only for watch batches. Each batch runs as one routine run in a chat of its own. Batches never post to the orchestrator's interactive chat, never reload it and never cancel a turn there.
- **The sink:** the host's `routine` sink. Set `ORIKAMI_T3_ROUTINE_ID` to that routine's id and restart the host. Without it, delivery is off: events wait in the host's outbox and nothing reaches any chat.
- **The watch folder:** `ORIKAMI_T3_WATCH_DIR`, else `t3-watch/` in the host's data folder. Point it at a folder the orchestrator can write. It holds:

| File | Written by | What it is |
|---|---|---|
| `requests.jsonl` | orchestrator | one registration per line (same body as `POST /api/t3-watches`) |
| `current-watches.json` | host | each `threadId` → its current `watchId`, replaced atomically |
| `acks.jsonl` | orchestrator | one ack per line (same body as `POST /api/t3-watches/acks`) |
| `handled.jsonl` | orchestrator | its own record of what it handled; the host never reads it |

The host reads `requests.jsonl` and `acks.jsonl` every second, only up to the last complete line, and skips a malformed line with a warning. The API forms need the host's API token; agents without it use the files.

## Launching and registering

1. Take `launchedAt` (an ISO time) **just before** you run `t3 thread start` or `t3 thread send`.
2. Run the command with `--json`. It prints the exact `runId`, even for a `send` queued behind work.
3. Register right after: append `{"threadId":"…","launchedAt":"…","runId":"…","label":"…"}` to `requests.jsonl`.
   - No `runId`? Before a `send`, read the thread's current run with `t3 thread show --json <id>` and pass it as `priorRunId`.
   - Pass `"exclusive": true` only for a thread nobody else types in. A `send` to a shared thread without a `runId` can only end as `idle_unverified`.
   - Optional: `stallAfterMin` (default 15).
4. **One queued turn per thread:** never `send` to a thread that already has a queued turn. Wait for that turn's update first.
5. Registering a thread again replaces its watch. Its unsent ending is dropped, and an ack for the old watch never settles the new one.

## What a batch looks like

Each routine run's prompt is the routine's instruction, then the batch as JSON:

- `batchId`, `attempt`, `asOf`;
- `events`: the updates to handle, `needs_you` first, `finished` last. Each has an `eventId` and may be marked `unverified`;
- `status`: every unsettled watch, as of `asOf`. **Context only:** never act on it;
- `rules`: the receiver rules below, repeated;
- `ack`: both ack forms, ready to use.

A resend (after the 10 min lease, or after a failed send) keeps `batchId` and every `eventId`; only `attempt`, `asOf` and `status` change. Only one batch is in flight at a time. The host holds batches while the updates routine or any turn of the orchestrator agent is running, and sends 5 s after both go idle.

## Handling a batch

1. Read `handled.jsonl`. Rebuild this batch's `goneEventIds` from its `done` records with disposition `gone`. Skip every event that already has a `done` record.
2. Handle `needs_you` entries first. One unreadable thread never holds back the others.
3. **Revalidate before acting** on `finished` or `needs_you`: run one fresh `t3 thread show --json <threadId>`.
   - **finished:** act only if the read shows the event's `runId` completed, no newer run, `pendingRequestCount` 0, no `pendingBackgroundTasks` and `blockedOnThreadWait` false, **and** `current-watches.json` still maps the thread to the event's `watchId`. A different `watchId`: record `stale`, no action. File unreadable: defer.
   - **needs_you:** act only if the same request is still pending. Otherwise record `stale`.
   - **Two `NotFound` reads at least 5 s apart:** the thread is gone. Record `gone` and list the event in `goneEventIds`. Its watch stays open until the host sees `watch_missing` itself.
   - **Any other failed or incomplete read:** defer. Record no `done`, and list the event in `deferredEventIds`. The host sends it again after 1 min (`needs_you`, `failed`) or 10 min (others).
4. **`unverified` events:** the host could not confirm them three times. Show the user the update as unconfirmed, take no action, record `done` with disposition `unverified`, and ack. Never revalidate or defer one. Once the thread reads again, the host sends one verified event under a new `eventId`.
5. Other events (`failed`, `stalled`, `idle_unverified`, `watch_missing`, `t3_unreachable`, `t3_degraded`): tell the user, or act as your instructions say.

## Recording (at least once, retry-safe)

- Before acting, append `{"eventId":"…","phase":"start"}` to `handled.jsonl`.
- After the outcome is durable, append `{"eventId":"…","batchId":"…","phase":"done","disposition":"handled|stale|gone|unverified"}`.
- A `start` without a `done` means a run died mid-handling. Revalidate, and check whether the action already happened before doing it again.
- Make every action retry-safe by `eventId`. A thread you start carries it in its title: `t3 thread start --title "<label> [<eventId>]"` (never `--generate-title`, which replaces it); `t3 thread list --project <p> --json` then shows whether it exists. A note to the user may repeat once after a crash, but is never dropped. An action you cannot make retry-safe goes to your own durable inbox, keyed by `eventId`.
- Keep each batch's handling **under 5 minutes**. Start long work as new T3 threads and register them; never do it inline.

## Acking

Ack only after every event in the batch is handled, suppressed or deferred. Either form works:

```text
POST /api/t3-watches/acks {"batchId":"…","deferredEventIds":[],"goneEventIds":[]}
```

or append the same JSON as one line to `acks.jsonl`.

- Plain ack: the batch settles, and so does each watch whose ending (`finished`, `failed`, `idle_unverified`, `watch_missing`) it carried.
- `deferredEventIds` come back in a later batch, under the same ids, after their retry spacing. After three deferrals an event comes back once more, `unverified`. Only `finished` and `needs_you` can be deferred; any other id listed there is taken as handled (with a warning in the host log).
- `goneEventIds` settle nothing; the host keeps reading those threads, until it sees `watch_missing` itself or the same ending again.
- Acking a batch twice is harmless (`already_acked`). An unknown `batchId` gets 404 (or a warning for a file line).
- Without an ack, the batch is sent again when its 10 min lease runs out, and stays the only one in flight.

## Checking on it

- `GET /api/t3-watches`: every watch, its state, and whether it has settled.
- The host's log warns about malformed lines, acks for unknown batches and failed sends.

## Turning it on (smoke test)

1. Create the orchestrator's manual updates routine. Set `ORIKAMI_T3_ROUTINE_ID` to its id and restart.
2. Start one quick T3 thread and one that asks for an approval, and register both.
3. While both run, type in the orchestrator's chat.
4. Pass: no reload, no interrupted turn, one batch in the updates routine's own chat with both events, and an acked batch (`GET /api/t3-watches` shows the finished watch settled).

Retire the per-thread watcher scripts only after this passes. Until then, leave `ORIKAMI_T3_ROUTINE_ID` unset.
