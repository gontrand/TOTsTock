-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/23_incremental_sync_updated_at.sql
-- Étape 23 : Triggers updated_at sur stk_products et stk_stock_levels (synchronisation incrémentale / baisse egress)
-- =========================================================================
-- =============================================================================
-- TOT STOCK — Étape 23 : horodatage fiable des mises à jour (synchro incrémentale)
-- =============================================================================
-- But : permettre la synchronisation incrémentale (delta) côté application, qui ne
--       retélécharge que les lignes modifiées depuis la dernière synchro au lieu de
--       tout le catalogue à chaque fois (réduction forte de l'egress Supabase).
--
-- Problème corrigé : les colonnes updated_at de stk_products et stk_stock_levels
--       n'étaient renseignées qu'à l'INSERT (DEFAULT now()). Aucun trigger ne les
--       mettait à jour lors d'un UPDATE, si bien qu'un changement de quantité ne
--       faisait pas avancer updated_at. Un filtre « updated_at > dernier_curseur »
--       aurait donc MANQUÉ ces changements. On ajoute ici le bump manquant.
--
-- Idempotent : peut être rejoué sans risque.
-- =============================================================================

-- Fonction générique : avance updated_at à chaque modification de ligne.
CREATE OR REPLACE FUNCTION public.tot_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Produits : s'ajoute au trigger de garde existant (trg_check_product_quantity_update).
-- Les deux triggers BEFORE UPDATE coexistent ; Postgres les exécute par ordre alphabétique
-- de nom. Si la garde lève une exception, la transaction est annulée de toute façon.
DROP TRIGGER IF EXISTS trg_tot_touch_updated_at_products ON public.stk_products;
CREATE TRIGGER trg_tot_touch_updated_at_products
  BEFORE UPDATE ON public.stk_products
  FOR EACH ROW
  EXECUTE FUNCTION public.tot_touch_updated_at();

-- Niveaux de stock : table potentiellement la plus volumineuse (produits × dépôts),
-- donc la plus rentable à synchroniser en delta.
DROP TRIGGER IF EXISTS trg_tot_touch_updated_at_stock_levels ON public.stk_stock_levels;
CREATE TRIGGER trg_tot_touch_updated_at_stock_levels
  BEFORE UPDATE ON public.stk_stock_levels
  FOR EACH ROW
  EXECUTE FUNCTION public.tot_touch_updated_at();

-- Index pour rendre le filtre delta « updated_at > curseur » efficace.
CREATE INDEX IF NOT EXISTS idx_products_updated_at ON public.stk_products (updated_at);
CREATE INDEX IF NOT EXISTS idx_stock_levels_updated_at ON public.stk_stock_levels (updated_at);

-- Alignement rétroactif : donne une valeur à updated_at pour les lignes historiques
-- où elle serait restée nulle (sécurité ; la colonne a un DEFAULT, mais on force).
UPDATE public.stk_products SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL;
UPDATE public.stk_stock_levels SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL;
