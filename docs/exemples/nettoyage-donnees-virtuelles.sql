-- Nettoyage des données virtuelles (garde le compte admin)
DELETE FROM public.stk_movements WHERE product_id LIKE 'demo-%';
DELETE FROM public.stk_products  WHERE id LIKE 'demo-%';
DELETE FROM public.stk_sub_categories WHERE name IN ('Outillage (démo)', 'Consommables (démo)');
DELETE FROM public.stk_depots WHERE code = 'DEMO';
