/**
 * Migration 3 (bot avatars). Append-only: never edit a migration that has shipped.
 * Initials avatars `{kind: 'initials', color}` become `{kind: 'bot', shape: 'chat', color, finish: 'flat'}`,
 * keeping each agent's color.
 */
export const MIGRATION_3 = `
  UPDATE agents SET avatar = json_object(
    'kind', 'bot',
    'shape', 'chat',
    'color', json_extract(avatar, '$.color'),
    'finish', 'flat'
  )
  WHERE json_extract(avatar, '$.kind') = 'initials';
`;
