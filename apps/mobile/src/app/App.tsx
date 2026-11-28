import { StatusBar } from 'expo-status-bar';
import { WorkspaceShell } from '../features/layout/index.ts';
import { SavedAppearance } from '../features/settings/index.ts';
import { HostProviders } from './HostProviders.tsx';
import { directory, registry } from './registry.ts';

export function App() {
  const { Provider } = registry.connection;
  return (
    <Provider>
      <SavedAppearance />
      <HostProviders directory={directory}>
        <StatusBar style="auto" />
        <WorkspaceShell registry={registry} />
      </HostProviders>
    </Provider>
  );
}
