import { fork } from 'node:child_process';
import type { OpenPluginChannel } from '@morrowbot/contracts';

/** A plugin folder's entry, started in its own Node process and reached over its IPC channel. */
export function forkChannel(entryPath: string, cwd: string, env: Readonly<Record<string, string>>): OpenPluginChannel {
  return (events) => {
    const child = fork(entryPath, [], {
      cwd,
      execArgv: ['--disable-sigusr1'],
      env,
      serialization: 'json',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.on('exit', (code, signal) => {
      events.exit(code, signal);
    });
    child.on('error', (error) => {
      events.error(error, child.pid !== undefined);
    });
    child.on('message', (raw: unknown) => {
      events.message(raw);
    });
    return {
      get connected() {
        return child.connected;
      },
      send: (message, done) => {
        child.send(message, (error) => {
          done(error);
        });
      },
      kill: () => {
        child.kill('SIGKILL');
      },
    };
  };
}
