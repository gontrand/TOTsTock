import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TABLES } from '../constants/tables';

export const MASTER_SUPABASE_URL = 'https://dsmempdbcfbixbopfctj.supabase.co';
export const MASTER_SUPABASE_KEY = 'sb_publishable_fd5y08b4z8W25W7q4c7W1g_C8qljzbe';

export const masterSupabase = createClient(MASTER_SUPABASE_URL, MASTER_SUPABASE_KEY);

export const DEFAULT_LOGO_SVG = '/logo.png';

export interface ReleaseNote {
  id?: number | string;
  version: string;
  title?: string;
  description?: string;
  release_date?: string;
  date?: string;
}

const SETTING_TABLE_CANDIDATES = [
  'APP_TOT-Stock_Setting',
  'APP_TOT_Stock_Setting',
  'tot_settings',
  'settings',
  TABLES.appSettings,
];

const RELEASE_TABLE_CANDIDATES = [
  'APP_TOT-Stock_Release',
  'APP_TOT_Stock_Release',
  'tot_releases',
  'releases',
  'release_notes',
];

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 heure de cache mémoire avec rafraîchissement depuis la DB Éditeur

function isStaleFallbackLogo(logo: string | null): boolean {
  if (!logo || logo.length <= 5) return true;
  if (logo === '/logo.png' || logo.startsWith('data:image/svg+xml')) return true;
  return false;
}

export async function fetchMasterLogo(
  customClient?: SupabaseClient | null,
  forceRefresh = false
): Promise<string> {
  // 1. Vérifier le cache local si valide et qu'il ne s'agit pas d'un ancien SVG de secours
  if (!forceRefresh) {
    try {
      const cachedLogo = localStorage.getItem('tot_app_logo_url');
      const cachedTs = Number(localStorage.getItem('tot_app_logo_ts') || '0');
      const isFresh = Date.now() - cachedTs < CACHE_TTL_MS;

      if (cachedLogo && !isStaleFallbackLogo(cachedLogo) && isFresh) {
        return cachedLogo;
      }
    } catch {
      // Ignore storage issues
    }
  }

  // Toujours interroger la base Éditeur (masterSupabase) en priorité absolue pour le logo officiel de l'application
  const targetKeys = ['app_logo_url', 'logo', 'logo_url', 'company_logo'];
  const sourcesToTry: Array<{ client: SupabaseClient; table: string }> = [
    { client: masterSupabase, table: 'APP_TOT-Stock_Setting' },
    ...(customClient ? [{ client: customClient, table: TABLES.appSettings }] : []),
  ];

  for (const { client, table } of sourcesToTry) {
    try {
      const { data, error } = await client.from(table).select('*').limit(25);

      if (!error && Array.isArray(data) && data.length > 0) {
        const matchedRow =
          data.find((row: any) => {
            const rowKey = String(row?.key || row?.name || row?.setting_key || '')
              .trim()
              .toLowerCase();
            return targetKeys.includes(rowKey);
          }) || (table.startsWith('APP_TOT') ? data[0] : null);

        const logoVal =
          matchedRow?.value ||
          matchedRow?.val ||
          matchedRow?.content ||
          matchedRow?.logo_url ||
          matchedRow?.url;

        if (logoVal && typeof logoVal === 'string' && logoVal.trim().length > 5) {
          const cleanLogo = logoVal.trim();
          try {
            localStorage.setItem('tot_app_logo_url', cleanLogo);
            localStorage.setItem('tot_app_logo_ts', Date.now().toString());
          } catch {}
          return cleanLogo;
        }
      }
    } catch {
      // Continue to next source
    }
  }

  try {
    const cached = localStorage.getItem('tot_app_logo_url');
    if (cached && !isStaleFallbackLogo(cached)) {
      return cached;
    }
  } catch {}

  return DEFAULT_LOGO_SVG;
}

export async function fetchReleaseNotes(_customClient?: SupabaseClient | null): Promise<ReleaseNote[]> {
  // 1. Buffer / Cache local immédiat : Si présent et valide (< 1h)
  try {
    const cachedRaw = localStorage.getItem('tot_release_notes_cache');
    const cachedTs = Number(localStorage.getItem('tot_release_notes_ts') || '0');
    const isFresh = Date.now() - cachedTs < CACHE_TTL_MS;

    if (cachedRaw && isFresh) {
      const parsed = JSON.parse(cachedRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore cache parse errors
  }

  // Interroger uniquement la table officielle Éditeur APP_TOT-Stock_Release sur masterSupabase
  try {
    const { data, error } = await masterSupabase
      .from('APP_TOT-Stock_Release')
      .select('*')
      .limit(15);

    if (!error && data && data.length > 0) {
      const sorted = [...data].sort((a, b) => {
        const dateA = a.release_date || a.date || a.created_at || '';
        const dateB = b.release_date || b.date || b.created_at || '';
        return dateB.localeCompare(dateA);
      });

      try {
        localStorage.setItem('tot_release_notes_cache', JSON.stringify(sorted));
        localStorage.setItem('tot_release_notes_ts', Date.now().toString());
      } catch {}

      return sorted;
    }
  } catch {
    // fallback to cache below
  }

  try {
    const staleRaw = localStorage.getItem('tot_release_notes_cache');
    if (staleRaw) {
      return JSON.parse(staleRaw);
    }
  } catch {}

  return [];
}
