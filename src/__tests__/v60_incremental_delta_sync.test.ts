import { describe, it, expect } from 'vitest';
import { fetchLiveOperationalData } from '../services/clientSupabase';

/**
 * v5.20.1 — synchronisation incrémentale (delta).
 * On vérifie que fetchLiveOperationalData :
 *  - sans curseur : récupère tout (productsDelta/stockLevelsDelta = false) ;
 *  - avec curseur : applique le filtre updated_at > curseur et signale un delta (à fusionner) ;
 *  - renvoie le nouveau curseur (max updated_at) et un tableau vide quand rien n'a changé.
 */

type GtCall = { table: string; col: string; val: string };

function makeMockClient(opts: {
  productsFull: any[];
  productsDelta: any[];
  stockFull: any[];
  stockDelta: any[];
  gtCalls: GtCall[];
}) {
  const from = (table: string) => {
    const state = { table, gtVal: null as string | null };
    const builder: any = {
      select: () => builder,
      order: () => builder,
      gte: () => builder,
      limit: () => builder,
      eq: () => builder,
      in: () => builder,
      gt: (col: string, val: string) => {
        state.gtVal = val;
        opts.gtCalls.push({ table, col, val });
        return builder;
      },
      // thenable : `await builder` renvoie les données selon la table et la présence d'un filtre gt
      then: (resolve: (v: { data: any[]; error: null }) => void) => {
        let data: any[] = [];
        if (table === 'stk_products') data = state.gtVal ? opts.productsDelta : opts.productsFull;
        else if (table === 'stk_stock_levels') data = state.gtVal ? opts.stockDelta : opts.stockFull;
        resolve({ data, error: null });
      },
    };
    return builder;
  };
  return { from } as any;
}

const PRODUCT = (id: string, updated: string) => ({
  id,
  reference: `REF-${id}`,
  brand: 'Bosch',
  model: `M-${id}`,
  unit_price: 10,
  quantity: 5,
  updated_at: updated,
});
const STOCK = (id: string, updated: string) => ({
  id,
  product_id: `P-${id}`,
  depot_name: 'Central',
  quantity: 3,
  updated_at: updated,
});

describe('v5.20.1 — synchronisation incrémentale (delta)', () => {
  it('sans curseur : récupération complète, pas de filtre gt, productsDelta=false', async () => {
    const gtCalls: GtCall[] = [];
    const client = makeMockClient({
      productsFull: [PRODUCT('1', '2026-11-19T08:00:00.000Z'), PRODUCT('2', '2026-11-19T09:00:00.000Z')],
      productsDelta: [],
      stockFull: [STOCK('1', '2026-11-19T07:00:00.000Z')],
      stockDelta: [],
      gtCalls,
    });

    const live = await fetchLiveOperationalData(client, null);

    expect(live.productsDelta).toBe(false);
    expect(live.products?.length).toBe(2);
    expect(live.productsMaxUpdatedAt).toBe('2026-11-19T09:00:00.000Z');
    expect(live.stockLevelsDelta).toBe(false);
    expect(live.stockLevelsMaxUpdatedAt).toBe('2026-11-19T07:00:00.000Z');
    // aucun filtre updated_at posé sur produits/stock en mode complet
    expect(gtCalls.filter((c) => c.table === 'stk_products' || c.table === 'stk_stock_levels')).toHaveLength(0);
  });

  it('avec curseur : filtre updated_at > curseur, delta signalé et nouveau curseur renvoyé', async () => {
    const gtCalls: GtCall[] = [];
    const since = '2026-11-19T09:00:00.000Z';
    const client = makeMockClient({
      productsFull: [],
      productsDelta: [PRODUCT('2', '2026-11-19T10:00:00.000Z')],
      stockFull: [],
      stockDelta: [STOCK('9', '2026-11-19T10:30:00.000Z')],
      gtCalls,
    });

    const live = await fetchLiveOperationalData(client, null, {
      productsSince: since,
      stockLevelsSince: since,
    });

    expect(live.productsDelta).toBe(true);
    expect(live.products?.map((p) => String(p.id))).toEqual(['2']);
    expect(live.productsMaxUpdatedAt).toBe('2026-11-19T10:00:00.000Z');
    expect(live.stockLevelsDelta).toBe(true);
    expect(live.stockLevelsMaxUpdatedAt).toBe('2026-11-19T10:30:00.000Z');
    expect(gtCalls).toContainEqual({ table: 'stk_products', col: 'updated_at', val: since });
    expect(gtCalls).toContainEqual({ table: 'stk_stock_levels', col: 'updated_at', val: since });
  });

  it('delta sans changement : tableau vide présent (fusion no-op), pas undefined', async () => {
    const gtCalls: GtCall[] = [];
    const client = makeMockClient({
      productsFull: [],
      productsDelta: [],
      stockFull: [],
      stockDelta: [],
      gtCalls,
    });

    const live = await fetchLiveOperationalData(client, null, {
      productsSince: '2026-11-19T09:00:00.000Z',
      stockLevelsSince: '2026-11-19T09:00:00.000Z',
    });

    expect(live.productsDelta).toBe(true);
    expect(Array.isArray(live.products)).toBe(true);
    expect(live.products).toHaveLength(0);
    expect(live.productsMaxUpdatedAt).toBeUndefined();
    expect(live.stockLevelsDelta).toBe(true);
    expect(live.stockLevels).toHaveLength(0);
  });
});
