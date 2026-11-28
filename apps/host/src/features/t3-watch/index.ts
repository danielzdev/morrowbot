export { cliProbe } from './cli-probe.ts';
export { classifyFailure, parseList, parseShow } from './observation.ts';
export type { ListResult, ListedThread, Observation, ProbeResult } from './observation.ts';
export { createT3WatchService, DISCOVERY_MS, TICK_MS } from './service.ts';
export type { T3WatchService, T3WatchServiceOptions } from './service.ts';
export type { AckResult } from './delivery.ts';
export { IDLE_MS, LEASE_MS } from './delivery-policy.ts';
export { ACKS_FILE, CURRENT_WATCHES_FILE, HANDLED_FILE } from './watch-files.ts';
export type { FileCursor, SinkAnswer, T3DeliverySink, T3Probe, T3WatchClock, T3WatchRecord, T3WatchStore } from './ports.ts';
