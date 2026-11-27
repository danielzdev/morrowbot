import { StatusBar } from 'expo-status-bar';
import { WorkspaceShell } from '../features/layout/index.ts';
import { registry } from './registry.ts';

export function App() {
  const { Provider } = registry.connection;
  return (
    <Provider>
      <StatusBar style="auto" />
      <WorkspaceShell registry={registry} />
    </Provider>
  );
}
