-- =========================================================================
-- TOT STOCK - SCRIPT 08 : IMPRESSION D'ÉTIQUETTES À DISTANCE (08_print_jobs.sql)
-- Postes d'impression (print_stations), file de travaux (print_jobs),
-- fonctions RPC sécurisées (SECURITY DEFINER, SET search_path = public),
-- contrôle perm_menu_print_labels et allowed_depots, aucun accès anon.
-- Compatible schéma 1.1.0 (min_schema_version = 1.0.0 conservé).
-- Rejouable : oui
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (08_print_jobs.sql) : La table public.users est absente. Exécutez d''abord les scripts 01 à 06.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'roles'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (08_print_jobs.sql) : La table public.roles est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. TABLES : public.print_stations & public.print_jobs
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.print_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  depot_name TEXT NULL,
  owner_user_id TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.print_stations
  ADD COLUMN IF NOT EXISTS depot_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES public.print_stations(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('order_label', 'product_label')),
  format TEXT NOT NULL CHECK (format IN ('avery_70x37', 'avery_105x42', 'thermal_50x30', 'bin_90x50')),
  payload JSONB NOT NULL,
  copies INT NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PRINTING', 'DONE', 'FAILED', 'CANCELLED')),
  error TEXT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours');

-- Index sur (station_id, status)
CREATE INDEX IF NOT EXISTS idx_print_jobs_station_status
  ON public.print_jobs (station_id, status);

-- Unicité partielle sur (station_id, dedupe_key) quand dedupe_key IS NOT NULL et status = 'PENDING'
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_station_dedupe_pending
  ON public.print_jobs (station_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'PENDING';

-- Index pour la limitation de débit par utilisateur (10 créations / minute)
CREATE INDEX IF NOT EXISTS idx_print_jobs_created_by_created_at
  ON public.print_jobs (created_by, created_at);

-- -------------------------------------------------------------------------
-- 2. DROITS & RLS SUR LES TABLES (aucun accès direct, tout passe par RPC)
-- Purge de toutes les règles RLS existantes sur print_stations et print_jobs (v37)
-- -------------------------------------------------------------------------
ALTER TABLE public.print_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'print_stations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.print_stations', r.policyname);
  END LOOP;

  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'print_jobs'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.print_jobs', r.policyname);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.print_stations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.print_jobs FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. PUBLICATION REALTIME PROTÉGÉE (sans erreur sur PostgreSQL pur)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'print_stations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.print_stations;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'print_jobs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.print_jobs;
    END IF;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 4. FONCTIONS INTERNES DE CONTRÔLE D'ACCÈS (perm_menu_print_labels & dépôts)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_print_depot(
  p_role_id INT,
  p_allowed_depots TEXT[],
  p_depot_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_target TEXT := NULLIF(TRIM(COALESCE(p_depot_name, '')), '');
  v_item TEXT;
BEGIN
  -- Rôles 0 et 1 ou joker '*' / 'ALL' dans allowed_depots -> tous les dépôts
  IF p_role_id IN (0, 1) THEN
    RETURN TRUE;
  END IF;

  IF p_allowed_depots IS NOT NULL AND ('*' = ANY(p_allowed_depots) OR 'ALL' = ANY(p_allowed_depots)) THEN
    RETURN TRUE;
  END IF;

  -- Si la station n'est rattachée à aucun dépôt spécifique : accessible si l'utilisateur n'est pas restreint
  -- ou s'il a au moins un dépôt autorisé et qu'aucun dépôt n'est imposé sur la station
  IF v_target IS NULL THEN
    RETURN TRUE;
  END IF;

  IF p_allowed_depots IS NULL OR array_length(p_allowed_depots, 1) IS NULL THEN
    RETURN FALSE;
  END IF;

  FOREACH v_item IN ARRAY p_allowed_depots LOOP
    IF LOWER(TRIM(COALESCE(v_item, ''))) = LOWER(v_target) THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.user_can_access_print_depot(INT, TEXT[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_print_depot(INT, TEXT[], TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 5. FONCTIONS RPC MÉTIER D'IMPRESSION À DISTANCE
-- -------------------------------------------------------------------------

-- 5.1 register_print_station(p_name text, p_depot text)
CREATE OR REPLACE FUNCTION public.register_print_station(
  p_name TEXT,
  p_depot TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_allowed_depots TEXT[];
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
  v_clean_name TEXT := TRIM(COALESCE(p_name, ''));
  v_clean_depot TEXT := NULLIF(TRIM(COALESCE(p_depot, '')), '');
  v_existing_id UUID;
  v_existing_owner TEXT;
  v_station_id UUID;
BEGIN
  SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false), u.allowed_depots
  INTO v_user_id, v_role_id, v_is_blocked, v_allowed_depots
  FROM public.users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
  LIMIT 1;

  IF v_user_id IS NULL OR v_is_blocked THEN
    RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role_id = 0 THEN
    v_has_perm := TRUE;
  ELSE
    SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
    IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
      v_has_perm := TRUE;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels est requise pour enregistrer un poste d''impression.'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'Nom de poste invalide (2 à 80 caractères requis).'
      USING ERRCODE = '22023';
  END IF;

  IF v_clean_depot IS NOT NULL AND NOT public.user_can_access_print_depot(v_role_id, v_allowed_depots, v_clean_depot) THEN
    RAISE EXCEPTION 'Accès refusé : vous n''êtes pas autorisé sur le dépôt "%".', v_clean_depot
      USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.owner_user_id
  INTO v_existing_id, v_existing_owner
  FROM public.print_stations s
  WHERE LOWER(TRIM(s.name)) = LOWER(v_clean_name)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_owner <> v_user_id THEN
      RAISE EXCEPTION 'Conflit : ce nom de poste d''impression est déjà attribué à un autre utilisateur.'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.print_stations
    SET name = v_clean_name,
        depot_name = v_clean_depot,
        last_seen_at = now(),
        is_active = true
    WHERE id = v_existing_id
    RETURNING id INTO v_station_id;

    RETURN v_station_id;
  END IF;

  INSERT INTO public.print_stations (name, depot_name, owner_user_id, last_seen_at, is_active)
  VALUES (v_clean_name, v_clean_depot, v_user_id, now(), true)
  RETURNING id INTO v_station_id;

  RETURN v_station_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_print_station(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_print_station(TEXT, TEXT) TO authenticated;

-- 5.2 list_print_stations()
CREATE OR REPLACE FUNCTION public.list_print_stations()
RETURNS TABLE (
  id UUID,
  name TEXT,
  depot_name TEXT,
  owner_user_id TEXT,
  last_seen_at TIMESTAMPTZ,
  is_active BOOLEAN,
  is_online BOOLEAN,
  is_mine BOOLEAN,
  pending_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_allowed_depots TEXT[];
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
BEGIN
  SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false), u.allowed_depots
  INTO v_user_id, v_role_id, v_is_blocked, v_allowed_depots
  FROM public.users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
  LIMIT 1;

  IF v_user_id IS NULL OR v_is_blocked THEN
    RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role_id = 0 THEN
    v_has_perm := TRUE;
  ELSE
    SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
    IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
      v_has_perm := TRUE;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels requise.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.depot_name,
    s.owner_user_id,
    s.last_seen_at,
    s.is_active,
    (s.last_seen_at IS NOT NULL AND s.last_seen_at > (now() - interval '2 minutes')) AS is_online,
    (s.owner_user_id = v_user_id) AS is_mine,
    (
      SELECT COUNT(*)
      FROM public.print_jobs pj
      WHERE pj.station_id = s.id
        AND pj.status IN ('PENDING', 'PRINTING')
        AND pj.expires_at > now()
    ) AS pending_count,
    s.created_at
  FROM public.print_stations s
  WHERE s.is_active = true
    AND (
      s.owner_user_id = v_user_id
      OR public.user_can_access_print_depot(v_role_id, v_allowed_depots, s.depot_name)
    )
  ORDER BY
    (s.last_seen_at IS NOT NULL AND s.last_seen_at > (now() - interval '2 minutes')) DESC,
    s.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_print_stations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_print_stations() TO authenticated;

-- 5.3 create_print_job(p_station uuid, p_kind text, p_format text, p_payload jsonb, p_copies int, p_dedupe_key text)
CREATE OR REPLACE FUNCTION public.create_print_job(
  p_station UUID,
  p_kind TEXT,
  p_format TEXT,
  p_payload JSONB,
  p_copies INT DEFAULT 1,
  p_dedupe_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_allowed_depots TEXT[];
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
  v_station RECORD;
  v_clean_dedupe TEXT := NULLIF(TRIM(COALESCE(p_dedupe_key, '')), '');
  v_payload_bytes INT;
  v_pending_count INT;
  v_user_rate_count INT;
  v_job_id UUID;
  v_key TEXT;
  v_val JSONB;
BEGIN
  SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false), u.allowed_depots
  INTO v_user_id, v_role_id, v_is_blocked, v_allowed_depots
  FROM public.users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
  LIMIT 1;

  IF v_user_id IS NULL OR v_is_blocked THEN
    RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role_id = 0 THEN
    v_has_perm := TRUE;
  ELSE
    SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
    IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
      v_has_perm := TRUE;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels est requise pour créer un travail d''impression.'
      USING ERRCODE = '42501';
  END IF;

  IF p_station IS NULL THEN
    RAISE EXCEPTION 'Identifiant de station manquant.'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.*
  INTO v_station
  FROM public.print_stations s
  WHERE s.id = p_station AND s.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poste d''impression introuvable ou inactif.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.user_can_access_print_depot(v_role_id, v_allowed_depots, v_station.depot_name) THEN
    RAISE EXCEPTION 'Accès refusé : vous ne pouvez pas envoyer d''impression vers un poste d''un autre dépôt (%).', COALESCE(v_station.depot_name, 'N/A')
      USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('order_label', 'product_label') THEN
    RAISE EXCEPTION 'Type d''étiquette invalide (order_label ou product_label attendu).'
      USING ERRCODE = '22023';
  END IF;

  IF p_format IS NULL OR p_format NOT IN ('avery_70x37', 'avery_105x42', 'thermal_50x30', 'bin_90x50') THEN
    RAISE EXCEPTION 'Format d''étiquette invalide (avery_70x37, avery_105x42, thermal_50x30 ou bin_90x50 attendu).'
      USING ERRCODE = '22023';
  END IF;

  IF p_copies IS NULL OR p_copies < 1 OR p_copies > 100 THEN
    RAISE EXCEPTION 'Nombre de copies invalide (doit être compris entre 1 et 100).'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Le payload doit être un objet JSON valide.'
      USING ERRCODE = '22023';
  END IF;

  v_payload_bytes := octet_length(p_payload::text);
  IF v_payload_bytes > 2048 THEN
    RAISE EXCEPTION 'Payload trop volumineux (% octets > limite de 2048 octets).', v_payload_bytes
      USING ERRCODE = '22023';
  END IF;

  -- Interdiction stricte de balises HTML ou de scripts dans le payload
  IF p_payload::text ~* '<\s*/?\s*(script|iframe|object|embed|style|link|meta|html|body|svg|img|div|span|table|form|input|button|a\s)' THEN
    RAISE EXCEPTION 'Payload refusé : le payload ne doit contenir que des identifiants et valeurs courtes, jamais de HTML.'
      USING ERRCODE = '22023';
  END IF;

  -- Vérification que chaque valeur du payload est scalaire et courte (≤ 250 caractères)
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_payload) LOOP
    IF jsonb_typeof(v_val) NOT IN ('string', 'number', 'boolean', 'null') THEN
      RAISE EXCEPTION 'Payload refusé : la clé "%" doit contenir une valeur simple (identifiant ou texte court).', v_key
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_val) = 'string' AND char_length(v_val #>> '{}') > 250 THEN
      RAISE EXCEPTION 'Payload refusé : la valeur de "%" dépasse 250 caractères.', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Expire d'abord les travaux PENDING dépassés sur cette station
  UPDATE public.print_jobs
  SET status = 'CANCELLED',
      error = 'Expiré (24h)'
  WHERE station_id = p_station
    AND status = 'PENDING'
    AND expires_at <= now();

  -- Limite : 30 travaux en attente maximum par station
  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.print_jobs
  WHERE station_id = p_station
    AND status = 'PENDING'
    AND expires_at > now();

  IF v_pending_count >= 30 THEN
    RAISE EXCEPTION 'Limite atteinte : ce poste compte déjà 30 travaux en attente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Limite : 10 créations par minute par utilisateur
  SELECT COUNT(*)
  INTO v_user_rate_count
  FROM public.print_jobs
  WHERE created_by = v_user_id
    AND created_at > (now() - interval '1 minute');

  IF v_user_rate_count >= 10 THEN
    RAISE EXCEPTION 'Limite de débit atteinte : maximum 10 demandes d''impression par minute par utilisateur.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.print_jobs (
    station_id,
    created_by,
    kind,
    format,
    payload,
    copies,
    status,
    dedupe_key,
    created_at,
    expires_at
  )
  VALUES (
    p_station,
    v_user_id,
    p_kind,
    p_format,
    p_payload,
    p_copies,
    'PENDING',
    v_clean_dedupe,
    now(),
    now() + interval '24 hours'
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_print_job(UUID, TEXT, TEXT, JSONB, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_print_job(UUID, TEXT, TEXT, JSONB, INT, TEXT) TO authenticated;

-- 5.4 claim_print_jobs(p_station uuid)
CREATE OR REPLACE FUNCTION public.claim_print_jobs(p_station UUID)
RETURNS SETOF public.print_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
  v_station_owner TEXT;
BEGIN
  SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false)
  INTO v_user_id, v_role_id, v_is_blocked
  FROM public.users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
  LIMIT 1;

  IF v_user_id IS NULL OR v_is_blocked THEN
    RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role_id = 0 THEN
    v_has_perm := TRUE;
  ELSE
    SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
    IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
      v_has_perm := TRUE;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels requise.'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.owner_user_id
  INTO v_station_owner
  FROM public.print_stations s
  WHERE s.id = p_station
  LIMIT 1;

  IF v_station_owner IS NULL THEN
    RAISE EXCEPTION 'Poste d''impression introuvable.'
      USING ERRCODE = '22023';
  END IF;

  IF v_station_owner <> v_user_id THEN
    RAISE EXCEPTION 'Accès refusé : seul le propriétaire du poste peut réserver et lire ses travaux.'
      USING ERRCODE = '42501';
  END IF;

  -- Mise à jour du battement de cœur (last_seen_at)
  UPDATE public.print_stations
  SET last_seen_at = now()
  WHERE id = p_station;

  -- Annulation automatique des travaux expirés (> 24h)
  UPDATE public.print_jobs
  SET status = 'CANCELLED',
      error = 'Expiré (24h)'
  WHERE station_id = p_station
    AND status = 'PENDING'
    AND expires_at <= now();

  -- Réservation atomique des travaux PENDING non expirés avec FOR UPDATE SKIP LOCKED
  RETURN QUERY
  WITH claimed AS (
    SELECT pj.id
    FROM public.print_jobs pj
    WHERE pj.station_id = p_station
      AND pj.status = 'PENDING'
      AND pj.expires_at > now()
    ORDER BY pj.created_at ASC
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.print_jobs j
  SET status = 'PRINTING'
  FROM claimed c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_print_jobs(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_print_jobs(UUID) TO authenticated;

-- 5.5 complete_print_job(p_job uuid, p_ok boolean, p_error text)
CREATE OR REPLACE FUNCTION public.complete_print_job(
  p_job UUID,
  p_ok BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS public.print_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
  v_job public.print_jobs;
  v_station_owner TEXT;
BEGIN
  SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false)
  INTO v_user_id, v_role_id, v_is_blocked
  FROM public.users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
  LIMIT 1;

  IF v_user_id IS NULL OR v_is_blocked THEN
    RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role_id = 0 THEN
    v_has_perm := TRUE;
  ELSE
    SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
    IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
      v_has_perm := TRUE;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels requise.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.*, s.owner_user_id
  INTO v_job.id, v_job.station_id, v_job.created_by, v_job.kind, v_job.format,
       v_job.payload, v_job.copies, v_job.status, v_job.error, v_job.dedupe_key,
       v_job.created_at, v_job.printed_at, v_job.expires_at, v_station_owner
  FROM public.print_jobs j
  JOIN public.print_stations s ON s.id = j.station_id
  WHERE j.id = p_job
  LIMIT 1;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Travail d''impression introuvable.'
      USING ERRCODE = '22023';
  END IF;

  IF v_station_owner <> v_user_id THEN
    RAISE EXCEPTION 'Accès refusé : seul le propriétaire du poste peut clôturer ce travail.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.print_stations
  SET last_seen_at = now()
  WHERE id = v_job.station_id;

  IF COALESCE(p_ok, false) THEN
    UPDATE public.print_jobs
    SET status = 'DONE',
        printed_at = now(),
        error = NULL
    WHERE id = p_job
    RETURNING * INTO v_job;
  ELSE
    UPDATE public.print_jobs
    SET status = 'FAILED',
        error = LEFT(COALESCE(NULLIF(TRIM(p_error), ''), 'Impression annulée ou en échec'), 500)
    WHERE id = p_job
    RETURNING * INTO v_job;
  END IF;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_print_job(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_print_job(UUID, BOOLEAN, TEXT) TO authenticated;

-- 5.6 cancel_print_job(p_job uuid)
CREATE OR REPLACE FUNCTION public.cancel_print_job(p_job UUID)
RETURNS public.print_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
  v_job public.print_jobs;
  v_station_owner TEXT;
BEGIN
  SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false)
  INTO v_user_id, v_role_id, v_is_blocked
  FROM public.users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
  LIMIT 1;

  IF v_user_id IS NULL OR v_is_blocked THEN
    RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role_id = 0 THEN
    v_has_perm := TRUE;
  ELSE
    SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
    IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
      v_has_perm := TRUE;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels requise.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.*, s.owner_user_id
  INTO v_job.id, v_job.station_id, v_job.created_by, v_job.kind, v_job.format,
       v_job.payload, v_job.copies, v_job.status, v_job.error, v_job.dedupe_key,
       v_job.created_at, v_job.printed_at, v_job.expires_at, v_station_owner
  FROM public.print_jobs j
  JOIN public.print_stations s ON s.id = j.station_id
  WHERE j.id = p_job
  LIMIT 1;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Travail d''impression introuvable.'
      USING ERRCODE = '22023';
  END IF;

  IF v_job.created_by <> v_user_id AND v_station_owner <> v_user_id THEN
    RAISE EXCEPTION 'Accès refusé : seul le créateur du travail ou le propriétaire du poste peut l''annuler.'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Impossible d''annuler ce travail : seuls les travaux au statut PENDING peuvent être annulés (statut actuel : %).', v_job.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.print_jobs
  SET status = 'CANCELLED'
  WHERE id = p_job
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_print_job(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_print_job(UUID) TO authenticated;

-- 5.7 purge_print_jobs()
CREATE OR REPLACE FUNCTION public.purge_print_jobs()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
  v_deleted INT := 0;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' OR session_user = 'postgres' THEN
    v_has_perm := TRUE;
  ELSE
    SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false)
    INTO v_user_id, v_role_id, v_is_blocked
    FROM public.users u
    WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
    LIMIT 1;

    IF v_user_id IS NULL OR v_is_blocked THEN
      RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
        USING ERRCODE = '42501';
    END IF;

    IF v_role_id IN (0, 1, 5) THEN
      v_has_perm := TRUE;
    ELSE
      SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
      IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
        v_has_perm := TRUE;
      END IF;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels requise.'
      USING ERRCODE = '42501';
  END IF;

  WITH deleted_rows AS (
    DELETE FROM public.print_jobs
    WHERE (
      status IN ('DONE', 'FAILED', 'CANCELLED')
      AND created_at < (now() - interval '7 days')
    )
    OR expires_at < (now() - interval '7 days')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted_rows;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_print_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_print_jobs() TO authenticated, service_role;

-- 5.8 get_print_job_status(p_job uuid) (pour le suivi côté Scanner mobile)
CREATE OR REPLACE FUNCTION public.get_print_job_status(p_job UUID)
RETURNS TABLE (
  id UUID,
  station_id UUID,
  kind TEXT,
  format TEXT,
  copies INT,
  status TEXT,
  error TEXT,
  created_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
BEGIN
  SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false)
  INTO v_user_id, v_role_id, v_is_blocked
  FROM public.users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
  LIMIT 1;

  IF v_user_id IS NULL OR v_is_blocked THEN
    RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role_id = 0 THEN
    v_has_perm := TRUE;
  ELSE
    SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
    IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
      v_has_perm := TRUE;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels requise.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    j.id,
    j.station_id,
    j.kind,
    j.format,
    j.copies,
    j.status,
    j.error,
    j.created_at,
    j.printed_at,
    j.expires_at
  FROM public.print_jobs j
  JOIN public.print_stations s ON s.id = j.station_id
  WHERE j.id = p_job
    AND (j.created_by = v_user_id OR s.owner_user_id = v_user_id)
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_print_job_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_print_job_status(UUID) TO authenticated;

-- 5.9 list_station_print_jobs(p_station uuid, p_limit int) (journal des 20 derniers travaux du poste)
CREATE OR REPLACE FUNCTION public.list_station_print_jobs(
  p_station UUID,
  p_limit INT DEFAULT 20
)
RETURNS SETOF public.print_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_role_id INT;
  v_is_blocked BOOLEAN;
  v_perms TEXT[];
  v_has_perm BOOLEAN := FALSE;
  v_station_owner TEXT;
  v_safe_limit INT := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  SELECT u.id::text, u.role_id, COALESCE(u.is_blocked, false)
  INTO v_user_id, v_role_id, v_is_blocked
  FROM public.users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
  LIMIT 1;

  IF v_user_id IS NULL OR v_is_blocked THEN
    RAISE EXCEPTION 'Accès refusé : utilisateur non authentifié ou compte bloqué.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role_id = 0 THEN
    v_has_perm := TRUE;
  ELSE
    SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.id::text = v_role_id::text LIMIT 1;
    IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR 'perm_menu_print_labels' = ANY(v_perms)) THEN
      v_has_perm := TRUE;
    END IF;
  END IF;

  IF NOT v_has_perm THEN
    RAISE EXCEPTION 'Permission refusée : perm_menu_print_labels requise.'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.owner_user_id
  INTO v_station_owner
  FROM public.print_stations s
  WHERE s.id = p_station
  LIMIT 1;

  IF v_station_owner IS NULL THEN
    RAISE EXCEPTION 'Poste d''impression introuvable.'
      USING ERRCODE = '22023';
  END IF;

  IF v_station_owner <> v_user_id THEN
    RAISE EXCEPTION 'Accès refusé : seul le propriétaire du poste peut consulter le journal de ses travaux.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.print_stations
  SET last_seen_at = now()
  WHERE id = p_station;

  RETURN QUERY
  SELECT j.*
  FROM public.print_jobs j
  WHERE j.station_id = p_station
  ORDER BY j.created_at DESC
  LIMIT v_safe_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_station_print_jobs(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_station_print_jobs(UUID, INT) TO authenticated;

-- -------------------------------------------------------------------------
-- 6. MISE À NIVEAU COMPATIBILITÉ (schema_version = 1.1.0, min_schema_version = 1.0.0)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'app_compat'
  ) THEN
    UPDATE public.app_compat
    SET schema_version = '1.1.0',
        min_schema_version = COALESCE(NULLIF(TRIM(min_schema_version), ''), '1.0.0'),
        updated_at = now()
    WHERE id = 1;
  END IF;
END $$;

-- Mise à jour de diagnostic_installation() lors d'une montée de version 1.0.0 -> 1.1.0
CREATE OR REPLACE FUNCTION public.diagnostic_installation()
RETURNS TABLE (
  check_key TEXT,
  check_label TEXT,
  status TEXT,
  details TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role INT;
  v_expected_tables TEXT[] := ARRAY[
    'roles', 'departments', 'users', 'projects', 'sub_categories',
    'depots', 'products', 'movements', 'stock_movements', 'material_orders',
    'app_settings', 'audit_logs', 'license_config', 'app_compat',
    'print_stations', 'print_jobs'
  ];
  v_explicit_public_select_tables TEXT[] := ARRAY['app_compat'];
  v_tbl TEXT;
  v_missing_tables TEXT[] := ARRAY[]::TEXT[];
  v_no_rls_tables TEXT[] := ARRAY[]::TEXT[];
  v_rls_enabled BOOLEAN;
  v_anon_leaks TEXT[] := ARRAY[]::TEXT[];
  v_pol RECORD;
  v_permissive_policies TEXT[] := ARRAY[]::TEXT[];
  v_permissive_tables TEXT[] := ARRAY[]::TEXT[];
  v_super_admin_count INT := 0;
  v_plain_pin_count INT := 0;
  v_has_pin_col BOOLEAN := false;
  v_schema_ver TEXT;
  v_min_schema_ver TEXT;
  v_min_app_ver TEXT;
  v_maint BOOLEAN;
  v_lic_plan TEXT := 'free';
  v_lic_modules TEXT[] := ARRAY['stock']::TEXT[];
  v_lic_max_depots INT := 1;
  v_active_depots INT := 0;
  v_limits JSONB;
  v_sensitive_funcs TEXT[] := ARRAY[
    'handle_auth_user_created',
    'get_or_link_my_profile',
    'diagnostic_installation',
    'enforce_license_max_references_quota',
    'enforce_license_max_depots_quota',
    'get_email_secret',
    'register_print_station',
    'list_print_stations',
    'create_print_job',
    'claim_print_jobs',
    'complete_print_job',
    'cancel_print_job',
    'purge_print_jobs',
    'get_print_job_status',
    'list_station_print_jobs'
  ];
  v_print_rpc_funcs TEXT[] := ARRAY[
    'register_print_station',
    'list_print_stations',
    'create_print_job',
    'claim_print_jobs',
    'complete_print_job',
    'cancel_print_job',
    'purge_print_jobs'
  ];
  v_missing_print_funcs TEXT[] := ARRAY[]::TEXT[];
  v_fn TEXT;
  v_fn_oid OID;
  v_exposed_funcs TEXT[] := ARRAY[]::TEXT[];
  v_edge_meta TEXT := NULL;
  v_has_email_secret_fn BOOLEAN := false;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' OR session_user = 'postgres' THEN
    v_caller_role := 0;
  ELSE
    SELECT role_id INTO v_caller_role
    FROM public.users
    WHERE auth_user_id = auth.uid()
      AND COALESCE(is_blocked, false) = false
    LIMIT 1;
  END IF;

  IF v_caller_role IS NULL OR v_caller_role NOT IN (0, 1, 5) THEN
    RAISE EXCEPTION 'Accès refusé : le diagnostic d''installation est réservé aux rôles 0, 1 et 5.'
      USING ERRCODE = '42501';
  END IF;

  FOREACH v_tbl IN ARRAY v_expected_tables LOOP
    SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind = 'r';

    IF NOT FOUND THEN
      v_missing_tables := array_append(v_missing_tables, v_tbl);
    ELSIF COALESCE(v_rls_enabled, false) = false THEN
      v_no_rls_tables := array_append(v_no_rls_tables, v_tbl);
    END IF;
  END LOOP;

  IF array_length(v_missing_tables, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'tables_rls'::TEXT,
      'Tables attendues & RLS activé'::TEXT,
      'ERREUR'::TEXT,
      format('Tables absentes : %s', array_to_string(v_missing_tables, ', '))::TEXT;
  ELSIF array_length(v_no_rls_tables, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'tables_rls'::TEXT,
      'Tables attendues & RLS activé'::TEXT,
      'ERREUR'::TEXT,
      format('RLS désactivé sur : %s', array_to_string(v_no_rls_tables, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'tables_rls'::TEXT,
      'Tables attendues & RLS activé'::TEXT,
      'OK'::TEXT,
      format('%s/%s tables présentes avec RLS actif', array_length(v_expected_tables, 1), array_length(v_expected_tables, 1))::TEXT;
  END IF;

  FOREACH v_tbl IN ARRAY ARRAY['users', 'license_config', 'movements', 'products', 'print_stations', 'print_jobs'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      IF has_table_privilege('anon', 'public.' || quote_ident(v_tbl), 'SELECT, INSERT, UPDATE, DELETE') THEN
        v_anon_leaks := array_append(v_anon_leaks, v_tbl);
      END IF;
    END IF;
  END LOOP;

  IF array_length(v_anon_leaks, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'anon_privileges'::TEXT,
      'Révocation des droits anon (users, license_config, movements, products, print_stations, print_jobs)'::TEXT,
      'ERREUR'::TEXT,
      format('Droits anon encore actifs sur : %s', array_to_string(v_anon_leaks, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'anon_privileges'::TEXT,
      'Révocation des droits anon (users, license_config, movements, products, print_stations, print_jobs)'::TEXT,
      'OK'::TEXT,
      'Aucun privilège accordé à anon sur les tables sensibles'::TEXT;
  END IF;

  FOR v_pol IN
    SELECT
      p.tablename,
      p.policyname,
      p.cmd,
      p.roles::text[] AS role_names
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND ('public' = ANY(p.roles::text[]) OR 'anon' = ANY(p.roles::text[]))
      AND (
        regexp_replace(LOWER(COALESCE(p.qual, '')), '[\s()]', '', 'g') = 'true'
        OR regexp_replace(LOWER(COALESCE(p.with_check, '')), '[\s()]', '', 'g') = 'true'
      )
      AND NOT (
        p.tablename = ANY(v_explicit_public_select_tables)
        AND p.cmd = 'SELECT'
        AND COALESCE(p.with_check, '') = ''
      )
    ORDER BY p.tablename ASC, p.policyname ASC
  LOOP
    v_permissive_policies := array_append(
      v_permissive_policies,
      format('%s."%s" (%s)', v_pol.tablename, v_pol.policyname, v_pol.cmd)
    );
    IF NOT (v_pol.tablename = ANY(v_permissive_tables)) THEN
      v_permissive_tables := array_append(v_permissive_tables, v_pol.tablename);
    END IF;
  END LOOP;

  IF array_length(v_permissive_policies, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'permissive_rls_policies'::TEXT,
      'Règles RLS permissives (public / anon USING true)'::TEXT,
      'ERREUR'::TEXT,
      format(
        'Table(s) exposée(s) [%s] via : %s — ré-exécutez 02_rls_hardening.sql et 05_rpc_admin_users.sql',
        array_to_string(v_permissive_tables, ', '),
        array_to_string(v_permissive_policies, ', ')
      )::TEXT;
  ELSE
    RETURN QUERY SELECT
      'permissive_rls_policies'::TEXT,
      'Règles RLS permissives (public / anon USING true)'::TEXT,
      'OK'::TEXT,
      format(
        'Aucune règle RLS permissive (public/anon USING true) hors lecture publique explicite (%s)',
        array_to_string(v_explicit_public_select_tables, ', ')
      )::TEXT;
  END IF;

  SELECT COUNT(*) INTO v_super_admin_count
  FROM public.users
  WHERE role_id = 0
    AND auth_user_id IS NOT NULL
    AND COALESCE(is_blocked, false) = false;

  IF v_super_admin_count >= 1 THEN
    RETURN QUERY SELECT
      'super_admin_linked'::TEXT,
      'Super Administrateur (rôle 0) lié à Supabase Auth'::TEXT,
      'OK'::TEXT,
      format('%s compte(s) Super Administrateur actif(s) et lié(s)', v_super_admin_count)::TEXT;
  ELSE
    RETURN QUERY SELECT
      'super_admin_linked'::TEXT,
      'Super Administrateur (rôle 0) lié à Supabase Auth'::TEXT,
      'ERREUR'::TEXT,
      'Aucun Super Administrateur actif (role_id = 0) n''est lié à un compte Auth (auth_user_id IS NOT NULL)'::TEXT;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'pin'
  ) INTO v_has_pin_col;

  IF v_has_pin_col THEN
    EXECUTE 'SELECT COUNT(*) FROM public.users WHERE pin IS NOT NULL AND TRIM(pin) <> '''''
      INTO v_plain_pin_count;
  END IF;

  IF v_plain_pin_count > 0 THEN
    RETURN QUERY SELECT
      'no_plaintext_pin'::TEXT,
      'Absence de code PIN en clair dans public.users'::TEXT,
      'ATTENTION'::TEXT,
      format('%s profil(s) contiennent encore une valeur dans la colonne pin', v_plain_pin_count)::TEXT;
  ELSE
    RETURN QUERY SELECT
      'no_plaintext_pin'::TEXT,
      'Absence de code PIN en clair dans public.users'::TEXT,
      'OK'::TEXT,
      'Aucun code PIN en clair stocké dans public.users'::TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'app_compat'
  ) THEN
    SELECT schema_version, min_schema_version, min_app_version, maintenance
    INTO v_schema_ver, v_min_schema_ver, v_min_app_ver, v_maint
    FROM public.app_compat
    WHERE id = 1
    LIMIT 1;

    IF v_schema_ver IS NOT NULL AND TRIM(v_schema_ver) <> '' AND v_min_app_ver IS NOT NULL AND TRIM(v_min_app_ver) <> '' THEN
      RETURN QUERY SELECT
        'app_compat'::TEXT,
        'Table app_compat (schema_version & min_app_version)'::TEXT,
        CASE WHEN COALESCE(v_maint, false) THEN 'ATTENTION' ELSE 'OK' END::TEXT,
        format('schema_version=%s, min_schema_version=%s, min_app_version=%s, maintenance=%s',
          v_schema_ver, COALESCE(v_min_schema_ver, '1.0.0'), v_min_app_ver, COALESCE(v_maint, false))::TEXT;
    ELSE
      RETURN QUERY SELECT
        'app_compat'::TEXT,
        'Table app_compat (schema_version & min_app_version)'::TEXT,
        'ERREUR'::TEXT,
        'Ligne singleton id=1 absente ou versions non renseignées dans public.app_compat'::TEXT;
    END IF;
  ELSE
    RETURN QUERY SELECT
      'app_compat'::TEXT,
      'Table app_compat (schema_version & min_app_version)'::TEXT,
      'ERREUR'::TEXT,
      'Table public.app_compat absente'::TEXT;
  END IF;

  BEGIN
    EXECUTE 'SELECT LOWER(COALESCE(plan_type, ''free'')), COALESCE(modules, ARRAY[''stock'']::TEXT[]), COALESCE(max_depots, 1) FROM public.license_config LIMIT 1'
      INTO v_lic_plan, v_lic_modules, v_lic_max_depots;
  EXCEPTION WHEN OTHERS THEN
    v_lic_plan := 'free';
    v_lic_modules := ARRAY['stock']::TEXT[];
    v_lic_max_depots := 1;
  END;

  v_limits := public.plan_limits(COALESCE(v_lic_plan, 'free'));
  v_lic_plan := COALESCE(v_limits->>'plan', 'free');
  IF v_lic_max_depots IS NULL OR v_lic_max_depots <= 0 THEN
    v_lic_max_depots := COALESCE((v_limits->>'max_depots')::int, 1);
  END IF;

  SELECT COUNT(*) INTO v_active_depots
  FROM public.depots
  WHERE COALESCE(is_active, true) = true;

  IF v_active_depots > v_lic_max_depots AND v_lic_max_depots < 99999 THEN
    RETURN QUERY SELECT
      'license_status'::TEXT,
      'Licence & quota de dépôts actifs'::TEXT,
      'ATTENTION'::TEXT,
      format('Formule=%s | Modules=[%s] | Dépôts actifs=%s/%s (dépassement du plafond)',
        v_lic_plan, array_to_string(v_lic_modules, ', '), v_active_depots, v_lic_max_depots)::TEXT;
  ELSE
    RETURN QUERY SELECT
      'license_status'::TEXT,
      'Licence & quota de dépôts actifs'::TEXT,
      'OK'::TEXT,
      format('Formule=%s | Modules=[%s] | Dépôts actifs=%s/%s',
        v_lic_plan, array_to_string(v_lic_modules, ', '), v_active_depots,
        CASE WHEN v_lic_max_depots >= 99999 THEN 'illimité' ELSE v_lic_max_depots::text END)::TEXT;
  END IF;

  FOREACH v_fn IN ARRAY v_sensitive_funcs LOOP
    FOR v_fn_oid IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
        v_exposed_funcs := array_append(v_exposed_funcs, v_fn);
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(v_exposed_funcs, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'sensitive_functions'::TEXT,
      'Fonctions sensibles non exécutables par anon'::TEXT,
      'ERREUR'::TEXT,
      format('Exécutable(s) par anon : %s', array_to_string(v_exposed_funcs, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'sensitive_functions'::TEXT,
      'Fonctions sensibles non exécutables par anon'::TEXT,
      'OK'::TEXT,
      'Toutes les fonctions sensibles sont interdites au rôle anon'::TEXT;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_email_secret'
  ) INTO v_has_email_secret_fn;

  BEGIN
    SELECT value INTO v_edge_meta
    FROM public.app_settings
    WHERE key = 'edge_functions_deployed'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_edge_meta := NULL;
  END;

  IF v_edge_meta IS NOT NULL AND TRIM(v_edge_meta) <> '' THEN
    RETURN QUERY SELECT
      'edge_functions_deployed'::TEXT,
      'Fonctions Edge déployées'::TEXT,
      'OK'::TEXT,
      format('Fonctions déployées (admin-users, sync-license, send-report-email) — %s', v_edge_meta)::TEXT;
  ELSIF v_has_email_secret_fn THEN
    RETURN QUERY SELECT
      'edge_functions_deployed'::TEXT,
      'Fonctions Edge déployées'::TEXT,
      'ATTENTION'::TEXT,
      'Prérequis SQL (get_email_secret, app_settings) prêts ; déploiement Edge Functions à vérifier via tot-install ou sonde HTTP'::TEXT;
  ELSE
    RETURN QUERY SELECT
      'edge_functions_deployed'::TEXT,
      'Fonctions Edge déployées'::TEXT,
      'ERREUR'::TEXT,
      'Fonction public.get_email_secret() absente (exécutez 02_rls_hardening.sql et déployez les fonctions Edge)'::TEXT;
  END IF;

  FOREACH v_fn IN ARRAY v_print_rpc_funcs LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    ) THEN
      v_missing_print_funcs := array_append(v_missing_print_funcs, v_fn);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'print_stations'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'print_jobs'
  ) THEN
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (print_stations, print_jobs & RPC)'::TEXT,
      'ERREUR'::TEXT,
      'Tables print_stations ou print_jobs absentes (exécutez 08_print_jobs.sql)'::TEXT;
  ELSIF array_length(v_missing_print_funcs, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (print_stations, print_jobs & RPC)'::TEXT,
      'ERREUR'::TEXT,
      format('Fonctions RPC absentes : %s', array_to_string(v_missing_print_funcs, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (print_stations, print_jobs & RPC)'::TEXT,
      'OK'::TEXT,
      format('Tables print_stations & print_jobs et %s/%s fonctions RPC présentes', array_length(v_print_rpc_funcs, 1), array_length(v_print_rpc_funcs, 1))::TEXT;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.diagnostic_installation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diagnostic_installation() TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 7. DURCISSEMENT FINAL : aucune fonction SECURITY DEFINER exécutable par anon
-- -------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF r.proname NOT IN ('get_email_secret', 'sync_verified_license_token') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
