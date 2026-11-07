-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/11_suite_tables.sql
-- Étape 11 : Tables manquantes (stk_order_preparations_log, stk_categories, stk_material_order_items), core_files et bucket privé tot-files
-- =========================================================================
-- =========================================================================
-- TOT SUITE - SCRIPT 11 : TABLES MANQUANTES ET FICHIERS PARTAGÉS (11_suite_tables.sql)
-- Schéma 2.1.0
--
-- Crée les tables déclarées dans src/constants/tables.ts mais absentes du schéma 2.0.0 :
--   1. public.stk_order_preparations_log  (journal des scans de préparation de commande)
--   2. public.stk_categories              (catégories de produits, parent des sous-catégories)
--   3. public.stk_material_order_items    (lignes de commande de matériel, en plus du JSONB items)
--   4. public.core_files                  (métadonnées des fichiers de toute la suite TOT :
--                                          documents d'habilitation, photos de rapport, fiches produit)
-- et le bucket Supabase Storage privé « tot-files » avec ses règles d'accès.
--
-- Permissions utilisées par les règles d'accès (à attribuer aux rôles par chaque app) :
--   perm_hab_view, perm_hab_edit   → TOT Habilitation
--   perm_rpt_view, perm_rpt_edit   → TOT Report
-- Les rôles 0 (Super Admin) et 1 (Administrateur) ont toujours accès.
--
-- Doit être exécuté après 08_print_jobs.sql et avant 07_app_compat.sql.
-- Rejouable : oui
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. RENOMMAGE DES ÉVENTUELLES TABLES HÉRITÉES (bases créées avant 2.0.0)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_pair TEXT[];
  v_pairs TEXT[][] := ARRAY[
    ARRAY['order_preparations_log', 'stk_order_preparations_log'],
    ARRAY['categories', 'stk_categories'],
    ARRAY['material_order_items', 'stk_material_order_items'],
    ARRAY['files', 'core_files']
  ];
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_pair[1] AND c.relkind = 'r'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_pair[2] AND c.relkind = 'r'
    ) THEN
      EXECUTE format('DROP VIEW IF EXISTS public.%I', v_pair[2]);
      EXECUTE format('ALTER TABLE public.%I RENAME TO %I', v_pair[1], v_pair[2]);
      RAISE NOTICE 'Table public.% renommée en public.%', v_pair[1], v_pair[2];
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 1. JOURNAL DE PRÉPARATION DE COMMANDE (stk_order_preparations_log)
-- Colonnes alignées sur logOrderPreparationScan() de src/services/clientSupabase.ts
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stk_order_preparations_log (
  id TEXT PRIMARY KEY DEFAULT ('prep-' || gen_random_uuid()::text),
  order_id TEXT,
  order_number TEXT,
  product_id TEXT,
  product_ref TEXT,
  preparer_id TEXT,
  preparer_name TEXT,
  picked_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  scanned_barcode TEXT,
  pickup_zone TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stk_order_preparations_log
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS product_ref TEXT,
  ADD COLUMN IF NOT EXISTS preparer_id TEXT,
  ADD COLUMN IF NOT EXISTS preparer_name TEXT,
  ADD COLUMN IF NOT EXISTS picked_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scanned_barcode TEXT,
  ADD COLUMN IF NOT EXISTS pickup_zone TEXT,
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_stk_order_prep_log_order ON public.stk_order_preparations_log (order_id);
CREATE INDEX IF NOT EXISTS idx_stk_order_prep_log_preparer ON public.stk_order_preparations_log (preparer_id);
CREATE INDEX IF NOT EXISTS idx_stk_order_prep_log_scanned_at ON public.stk_order_preparations_log (scanned_at DESC);

ALTER TABLE public.stk_order_preparations_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stk_order_preparations_log FROM anon, public;
GRANT SELECT, INSERT ON TABLE public.stk_order_preparations_log TO authenticated;
REVOKE UPDATE, DELETE ON TABLE public.stk_order_preparations_log FROM authenticated;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stk_order_preparations_log' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_order_preparations_log', r.policyname);
  END LOOP;
END $$;

-- Lecture : le préparateur voit ses scans ; responsables et administrateurs voient tout
CREATE POLICY "Read stk_order_preparations_log"
  ON public.stk_order_preparations_log
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_id() IS NOT NULL
    AND (
      preparer_id::text = public.current_user_id()
      OR public.is_administrator()
      OR public.current_user_has_perm('perm_orders_manage')
      OR public.current_user_has_perm('perm_orders_view')
    )
  );

-- Écriture : journal immuable, un utilisateur n'écrit que ses propres scans
CREATE POLICY "Insert own stk_order_preparations_log"
  ON public.stk_order_preparations_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_id() IS NOT NULL
    AND (preparer_id IS NULL OR preparer_id::text = public.current_user_id() OR public.is_administrator())
  );

-- -------------------------------------------------------------------------
-- 2. CATÉGORIES DE PRODUITS (stk_categories)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stk_categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stk_categories
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
DECLARE
  v_id_type TEXT;
  v_id_default TEXT;
  v_seq TEXT;
BEGIN
  SELECT data_type, column_default
  INTO v_id_type, v_id_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'stk_categories' AND column_name = 'id';

  v_seq := pg_get_serial_sequence('public.stk_categories', 'id');

  IF v_id_default IS NULL AND v_seq IS NULL THEN
    IF v_id_type IN ('text', 'character varying') THEN
      ALTER TABLE public.stk_categories ALTER COLUMN id SET DEFAULT ('cat-' || gen_random_uuid()::text);
    ELSIF v_id_type = 'uuid' THEN
      ALTER TABLE public.stk_categories ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ELSIF v_id_type IN ('integer', 'bigint', 'smallint') THEN
      CREATE SEQUENCE IF NOT EXISTS public.stk_categories_id_seq;
      PERFORM setval(
        'public.stk_categories_id_seq',
        GREATEST(COALESCE((SELECT MAX(id::bigint) FROM public.stk_categories), 0) + 1, 1),
        false
      );
      ALTER TABLE public.stk_categories ALTER COLUMN id SET DEFAULT nextval('public.stk_categories_id_seq');
      ALTER SEQUENCE public.stk_categories_id_seq OWNED BY public.stk_categories.id;
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stk_categories_name ON public.stk_categories (name);

-- Reprise des catégories déjà saisies en texte dans stk_sub_categories.category
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stk_sub_categories' AND column_name = 'category'
  ) THEN
    INSERT INTO public.stk_categories (name)
    SELECT DISTINCT TRIM(category)
    FROM public.stk_sub_categories
    WHERE category IS NOT NULL AND TRIM(category) <> ''
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

ALTER TABLE public.stk_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stk_categories FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_categories TO authenticated;
DO $$
DECLARE
  v_seq TEXT;
BEGIN
  v_seq := pg_get_serial_sequence('public.stk_categories', 'id');
  IF v_seq IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', v_seq);
  END IF;
END $$;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stk_categories' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_categories', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Authenticated read stk_categories"
  ON public.stk_categories
  FOR SELECT
  TO authenticated
  USING (public.current_user_id() IS NOT NULL);

CREATE POLICY "Admin write stk_categories"
  ON public.stk_categories
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_categories') OR public.current_user_has_perm('perm_prod_edit'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_categories') OR public.current_user_has_perm('perm_prod_edit'));

-- -------------------------------------------------------------------------
-- 3. LIGNES DE COMMANDE DE MATÉRIEL (stk_material_order_items)
-- La colonne JSONB stk_material_orders.items reste la source utilisée par l'app ;
-- cette table permet des requêtes et rapports par ligne.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stk_material_order_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id TEXT NOT NULL REFERENCES public.stk_material_orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES public.stk_products(id) ON DELETE SET NULL,
  product_ref TEXT,
  description TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  picked_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stk_material_order_items
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS product_ref TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS picked_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_stk_material_order_items_order ON public.stk_material_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_stk_material_order_items_product ON public.stk_material_order_items (product_id);

ALTER TABLE public.stk_material_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stk_material_order_items FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_material_order_items TO authenticated;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stk_material_order_items' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_material_order_items', r.policyname);
  END LOOP;
END $$;

-- Mêmes droits que la commande parente : la règle de stk_material_orders s'applique dans la sous-requête
CREATE POLICY "Read stk_material_order_items"
  ON public.stk_material_order_items
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stk_material_orders o WHERE o.id::text = order_id::text));

CREATE POLICY "Write stk_material_order_items"
  ON public.stk_material_order_items
  FOR ALL
  TO authenticated
  USING (
    public.is_administrator()
    OR public.current_user_has_perm('perm_orders_manage')
    OR EXISTS (
      SELECT 1 FROM public.stk_material_orders o
      WHERE o.id::text = order_id::text AND o.requester_id::text = public.current_user_id() AND o.status IN ('WAITING_APPROVAL', 'PENDING')
    )
  )
  WITH CHECK (
    public.is_administrator()
    OR public.current_user_has_perm('perm_orders_manage')
    OR EXISTS (
      SELECT 1 FROM public.stk_material_orders o
      WHERE o.id::text = order_id::text AND o.requester_id::text = public.current_user_id() AND o.status IN ('WAITING_APPROVAL', 'PENDING')
    )
  );

-- -------------------------------------------------------------------------
-- 4. FICHIERS PARTAGÉS DE LA SUITE TOT (core_files)
--
-- Une ligne = un fichier stocké dans le bucket privé « tot-files ».
-- Chemin de stockage obligatoire : {app}/{entity_type}/{entity_id}/{nom_unique}
--   ex. habilitation/hab_qualification/7f3c…/ba4_lambert_2026.pdf
--       stock/stk_product/PRD-0042/photo.jpg
--       report/rpt_report/RPT-2026-118/photo_01.jpg
--
-- Champs pensés pour TOT Habilitation :
--   subject_user_id : la personne concernée (employé ou ouvrier, ligne de core_users)
--   doc_category    : certificat, permis, attestation, visite_medicale, carte, autre
--   valid_from / valid_until : période de validité figurant sur le document
--   version / replaces_file_id : historique quand un certificat renouvelé remplace l'ancien
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app TEXT NOT NULL DEFAULT 'stock',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  subject_user_id TEXT REFERENCES public.core_users(id) ON DELETE SET NULL,
  bucket TEXT NOT NULL DEFAULT 'tot-files',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  checksum_sha256 TEXT,
  doc_category TEXT,
  title TEXT,
  valid_from DATE,
  valid_until DATE,
  version INT NOT NULL DEFAULT 1,
  replaces_file_id UUID REFERENCES public.core_files(id) ON DELETE SET NULL,
  uploaded_by TEXT REFERENCES public.core_users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT core_files_app_check CHECK (app IN ('core', 'stock', 'habilitation', 'report', 'tools')),
  CONSTRAINT core_files_doc_category_check CHECK (
    doc_category IS NULL OR doc_category IN (
      'certificat', 'permis', 'attestation', 'visite_medicale', 'carte', 'photo', 'fiche_technique', 'rapport', 'autre'
    )
  ),
  CONSTRAINT core_files_size_check CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT core_files_validity_check CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT core_files_path_check CHECK (split_part(storage_path, '/', 1) = app)
);

ALTER TABLE public.core_files
  ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS entity_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS subject_user_id TEXT,
  ADD COLUMN IF NOT EXISTS bucket TEXT NOT NULL DEFAULT 'tot-files',
  ADD COLUMN IF NOT EXISTS storage_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS doc_category TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS valid_from DATE,
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS replaces_file_id UUID,
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_files_storage ON public.core_files (bucket, storage_path);
CREATE INDEX IF NOT EXISTS idx_core_files_entity ON public.core_files (app, entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_core_files_subject ON public.core_files (subject_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_core_files_valid_until ON public.core_files (valid_until) WHERE deleted_at IS NULL AND valid_until IS NOT NULL;

-- Droits par application (SECURITY DEFINER : évite la récursion RLS dans les règles Storage)
CREATE OR REPLACE FUNCTION public.can_view_app_files(p_app TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_id() IS NOT NULL AND (
    public.is_administrator()
    OR CASE p_app
      WHEN 'stock' THEN true
      WHEN 'tools' THEN true
      WHEN 'core' THEN true
      WHEN 'habilitation' THEN public.current_user_has_perm('perm_hab_view') OR public.current_user_has_perm('perm_hab_edit')
      WHEN 'report' THEN public.current_user_has_perm('perm_rpt_view') OR public.current_user_has_perm('perm_rpt_edit')
      ELSE false
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_app_files(p_app TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_id() IS NOT NULL AND (
    public.is_administrator()
    OR CASE p_app
      WHEN 'stock' THEN public.current_user_has_perm('perm_prod_edit') OR public.current_user_has_perm('perm_inventory_edit')
      WHEN 'tools' THEN public.current_user_has_perm('perm_prod_edit')
      WHEN 'core' THEN false
      WHEN 'habilitation' THEN public.current_user_has_perm('perm_hab_edit')
      WHEN 'report' THEN public.current_user_has_perm('perm_rpt_edit')
      ELSE false
    END
  );
$$;

-- Lecture d'un fichier par son chemin de stockage (utilisée par les règles du bucket)
CREATE OR REPLACE FUNCTION public.can_read_storage_file(p_bucket TEXT, p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_files f
    WHERE f.bucket = p_bucket
      AND f.storage_path = p_path
      AND f.deleted_at IS NULL
      AND (
        public.can_view_app_files(f.app)
        OR (f.subject_user_id IS NOT NULL AND f.subject_user_id = public.current_user_id())
        OR (f.uploaded_by IS NOT NULL AND f.uploaded_by = public.current_user_id())
      )
  );
$$;

-- Dépôt d'un fichier : droit d'édition sur l'app, ou employé déposant son propre document d'habilitation
-- (chemin habilitation/self/{son id}/…)
CREATE OR REPLACE FUNCTION public.can_upload_storage_file(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_id() IS NOT NULL AND (
    public.can_edit_app_files(split_part(p_path, '/', 1))
    OR (
      split_part(p_path, '/', 1) = 'habilitation'
      AND split_part(p_path, '/', 2) = 'self'
      AND split_part(p_path, '/', 3) = public.current_user_id()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_app_files(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_app_files(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_storage_file(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_upload_storage_file(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_app_files(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_app_files(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_storage_file(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_upload_storage_file(TEXT) TO authenticated;

ALTER TABLE public.core_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.core_files FROM anon, public;
GRANT SELECT, INSERT, UPDATE ON TABLE public.core_files TO authenticated;
REVOKE DELETE ON TABLE public.core_files FROM authenticated;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'core_files' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.core_files', r.policyname);
  END LOOP;
END $$;

-- Lecture : droit de consultation sur l'app, ou la personne concernée, ou l'auteur du dépôt
CREATE POLICY "Read core_files"
  ON public.core_files
  FOR SELECT
  TO authenticated
  USING (
    public.can_view_app_files(app)
    OR (subject_user_id IS NOT NULL AND subject_user_id = public.current_user_id())
    OR (uploaded_by IS NOT NULL AND uploaded_by = public.current_user_id())
  );

-- Ajout : droit d'édition sur l'app, ou un employé qui dépose son propre document d'habilitation
CREATE POLICY "Insert core_files"
  ON public.core_files
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = public.current_user_id()
    AND deleted_at IS NULL
    AND (
      public.can_edit_app_files(app)
      OR (app = 'habilitation' AND subject_user_id = public.current_user_id())
    )
  );

-- Modification (titre, validité, suppression logique via deleted_at) : droit d'édition sur l'app
-- La suppression physique est réservée au service_role (pas de DELETE pour authenticated).
CREATE POLICY "Update core_files"
  ON public.core_files
  FOR UPDATE
  TO authenticated
  USING (public.can_edit_app_files(app))
  WITH CHECK (public.can_edit_app_files(app));

-- -------------------------------------------------------------------------
-- 5. BUCKET SUPABASE STORAGE PRIVÉ « tot-files »
-- Fichiers lus uniquement par URL signée (createSignedUrl), jamais en accès public.
-- Ignoré si le schéma storage n'existe pas (tests hors Supabase).
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    RAISE NOTICE 'Schéma storage absent : bucket tot-files non créé';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'tot-files', 'tot-files', false, 20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  )
  ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

  DROP POLICY IF EXISTS "tot-files read" ON storage.objects;
  DROP POLICY IF EXISTS "tot-files insert" ON storage.objects;
  DROP POLICY IF EXISTS "tot-files update" ON storage.objects;
  DROP POLICY IF EXISTS "tot-files delete" ON storage.objects;

  CREATE POLICY "tot-files read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'tot-files' AND public.can_read_storage_file(bucket_id, name));

  CREATE POLICY "tot-files insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'tot-files' AND public.can_upload_storage_file(name));

  CREATE POLICY "tot-files update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'tot-files' AND public.can_edit_app_files(split_part(name, '/', 1)))
    WITH CHECK (bucket_id = 'tot-files' AND public.can_edit_app_files(split_part(name, '/', 1)));

  CREATE POLICY "tot-files delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'tot-files' AND public.is_administrator());
END $$;
