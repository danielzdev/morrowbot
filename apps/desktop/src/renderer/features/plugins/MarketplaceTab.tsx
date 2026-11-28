import type { PluginEntry } from '@morrowbot/contracts';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { sourceLabel } from './PluginDetail.tsx';

export type CatalogFilter = 'all' | 'plugins' | 'connectors';

/**
 * Extensions › Marketplace (spec IA §3): one catalog with All · Plugins · Connectors. The online
 * catalog is not in this version, so it says so, lists what is installed, and shows how to add a plugin by hand.
 */
export function MarketplaceTab(props: {
  readonly filter: CatalogFilter;
  readonly installed: readonly PluginEntry[];
  readonly rescanning: boolean;
  readonly onFilter: (filter: CatalogFilter) => void;
  readonly onShowInstalled: (id: string) => void;
  readonly onOpenFolder: () => void;
  readonly onRescan: () => void;
}) {
  const showPlugins = props.filter !== 'connectors';
  return (
    <div class="marketplace">
      <Segmented
        label="Show"
        value={props.filter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'plugins', label: 'Plugins' },
          { value: 'connectors', label: 'Connectors' },
        ]}
        onChange={props.onFilter}
      />
      <div class="tab-empty">
        <p>The MorrowBot catalog isn't available in this version yet.</p>
        <p class="muted">To add a plugin now, put its folder in your plugins folder, then choose Rescan.</p>
        <div class="row">
          <button type="button" class="btn secondary" onClick={props.onOpenFolder}>
            Open plugins folder
          </button>
          <button type="button" class="btn ghost" disabled={props.rescanning} onClick={props.onRescan}>
            {props.rescanning ? 'Rescanning…' : 'Rescan'}
          </button>
        </div>
      </div>
      {showPlugins && props.installed.length > 0 && (
        <ul class="catalog" aria-label="Installed plugins">
          {props.installed.map((entry) => (
            <li key={entry.manifest.id} class="catalog-row">
              <ItemMark name={entry.manifest.name} />
              <span class="item-text">
                <span class="item-name">
                  {entry.manifest.name}
                  <span class="tag">{sourceLabel(entry)}</span>
                </span>
              </span>
              <button type="button" class="btn ghost" onClick={() => { props.onShowInstalled(entry.manifest.id); }}>
                Installed →
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
