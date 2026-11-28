import { Group, GroupedScroll, IconTile, Row } from './grouped.tsx';

/** Push needs the relay, which does not exist yet; this says so instead of showing switches that do nothing. */
export function NotificationsScreen() {
  return (
    <GroupedScroll>
      <Group header={null} footer="Alerts when the app is closed need Ori Kami’s relay, which is coming later.">
        <Row
          label="While Ori Kami is open"
          detail="Updates arrive live over the host connection."
          leading={<IconTile symbol="bell.badge" />}
          trailing={null}
          tone="default"
          selected={false}
          onPress={null}
        />
        <Row
          label="When Ori Kami is closed"
          detail="Not available yet"
          leading={<IconTile symbol="bell.slash" />}
          trailing={null}
          tone="default"
          selected={false}
          onPress={null}
        />
      </Group>
    </GroupedScroll>
  );
}
