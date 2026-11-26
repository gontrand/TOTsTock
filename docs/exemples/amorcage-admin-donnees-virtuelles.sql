-- ============================================================
--  EXEMPLE D'AMORÇAGE : compte admin + données VIRTUELLES (démo)
--  Prérequis : l'utilisateur admin@exemple.test existe déjà dans
--  Supabase > Authentication > Users (remplacez l'e-mail par le vôtre).
--  Rejouable sans risque (idempotent). Plan Free : 1 dépôt, 50 réf. max.
-- ============================================================

-- 1) Profil administrateur (rôle 0 = super administrateur) lié au compte Auth
INSERT INTO public.core_users (id, auth_user_id, name, trigram, email, department, role_id, is_blocked)
SELECT '0', u.id, 'Admin Démo', 'ADM', u.email, 'Direction', 0, false
  FROM auth.users u
 WHERE lower(u.email) = lower('admin@exemple.test')
 LIMIT 1
ON CONFLICT (id) DO UPDATE
   SET auth_user_id = EXCLUDED.auth_user_id,
       email        = EXCLUDED.email,
       role_id      = 0,
       is_blocked   = false;

-- 2) Département, dépôt et catégories fictifs
INSERT INTO public.core_departments (name) VALUES ('Direction')
ON CONFLICT (name) DO NOTHING;

-- (NOT EXISTS : le quota de dépôts de la licence est vérifié avant ON CONFLICT)
INSERT INTO public.stk_depots (name, code, address, description)
SELECT 'Dépôt Démo', 'DEMO', '1 rue de l''Exemple, 1000 Bruxelles', 'Données virtuelles de démonstration'
 WHERE NOT EXISTS (SELECT 1 FROM public.stk_depots WHERE name = 'Dépôt Démo');

INSERT INTO public.stk_sub_categories (name)
VALUES ('Outillage (démo)'), ('Consommables (démo)')
ON CONFLICT (name) DO NOTHING;

-- 3) Trois articles fictifs avec stock initial et seuil d'alerte
INSERT INTO public.stk_products
  (id, reference, brand, model, sub_category_id, unit_price, description,
   store_name, room_name, shelf_name, quantity, min_stock_alert)
VALUES
  ('demo-001', 'DEMO-001', 'Marque A', 'Perceuse 18V',
   (SELECT id FROM public.stk_sub_categories WHERE name = 'Outillage (démo)'),
   89.90, 'Article fictif', 'Dépôt Démo', 'Salle 1', 'A1', 12, 3),
  ('demo-002', 'DEMO-002', 'Marque B', 'Gants de protection (paire)',
   (SELECT id FROM public.stk_sub_categories WHERE name = 'Consommables (démo)'),
   4.50, 'Article fictif', 'Dépôt Démo', 'Salle 1', 'B2', 40, 10),
  ('demo-003', 'DEMO-003', 'Marque C', 'Vis 4x40 (boîte de 200)',
   (SELECT id FROM public.stk_sub_categories WHERE name = 'Consommables (démo)'),
   7.20, 'Article fictif', 'Dépôt Démo', 'Salle 2', 'C3', 5, 8)
ON CONFLICT (id) DO NOTHING;

-- 4) Contrôle
SELECT (SELECT count(*) FROM public.core_users  WHERE id = '0')           AS admin,
       (SELECT count(*) FROM public.stk_depots   WHERE code = 'DEMO')     AS depots,
       (SELECT count(*) FROM public.stk_products WHERE id LIKE 'demo-%')  AS articles;
