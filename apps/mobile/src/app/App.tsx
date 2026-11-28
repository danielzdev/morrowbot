import { StatusBar } from 'expo-status-bar';
import { WorkspaceShell } from '../features/layout/index.ts';
import { SavedAppearance } from '../features/settings/index.ts';
import { registry } from './registry.ts';

export function App() {
  const { Provider } = registry.connection;
  return (
    <Provider>
      <SavedAppearance />
      <StatusBar style="auto" />
      <WorkspaceShell registry={registry} />
    </Provider>
  );
}
