import type { ExtensionMessage } from '@morrowbot/contracts';
import { z } from 'zod';

type Browser = Extract<ExtensionMessage, { kind: 'hello' }>['browser'];

const UserAgentData = z.object({ brands: z.array(z.object({ brand: z.string(), version: z.string() })) });

/** Which Chromium browser this is (Chrome, Brave, Edge, Opera...), from the user-agent brands. Arc and Dia report Chrome. */
export function detectBrowser(): Browser {
  const data: unknown = Reflect.get(navigator, 'userAgentData');
  const parsed = UserAgentData.safeParse(data);
  const brands = parsed.success ? parsed.data.brands : [];
  const named = brands.filter(({ brand }) => !/not.?a.?brand|^chromium$/i.test(brand));
  const pick = named.find(({ brand }) => brand !== 'Google Chrome') ?? named[0];
  const chromium = brands.find(({ brand }) => brand === 'Chromium');
  const name = pick === undefined ? 'Chromium' : pick.brand === 'Google Chrome' ? 'Chrome' : pick.brand.replace(/^Microsoft /, '');
  return { family: 'chromium', name, version: pick?.version ?? chromium?.version ?? '' };
}
