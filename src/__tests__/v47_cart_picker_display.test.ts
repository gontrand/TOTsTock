import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('v47 — Affichage du sélecteur "Ajouter des Articles au Panier"', () => {
  const modalPath = path.resolve(__dirname, '../components/MaterialOrdersModal.tsx');
  const content = fs.readFileSync(modalPath, 'utf-8');

  it('filtre availablePickerCategories selon les produits disponibles dans le dépôt actif', () => {
    expect(content).toContain('const availablePickerCategories = useMemo(() => {');
    expect(content).toContain('const productInPickerDepot');
    expect(content).toContain('currentCartDepot || orderPickDepot');
    expect(content).toContain('const effectivePickerCategory = useMemo(() => {');
  });

  it('empêche les pastilles de catégories de déborder sur plusieurs lignes et préserve la hauteur de la liste d’articles', () => {
    const pickerStart = content.indexOf('{isAddProductPickerOpen && (');
    expect(pickerStart).toBeGreaterThan(-1);
    const pickerSection = content.slice(pickerStart, pickerStart + 12000);

    // Le conteneur de filtres de catégories utilise un défilement horizontal sur une seule ligne (overflow-x-auto whitespace-nowrap) et non flex-wrap
    expect(pickerSection).toContain('overflow-x-auto no-scrollbar pb-0.5 text-[10px] font-bold whitespace-nowrap');
    expect(pickerSection).not.toContain('flex flex-wrap items-center gap-1.5 pb-1 text-[10px] font-bold');

    // Sélecteur déroulant compact de catégorie présent
    expect(pickerSection).toContain("Filtrer par catégorie");

    // La liste des articles dispose de flex-1 min-h-0 overflow-y-auto pour occuper tout l'espace vertical restant
    expect(pickerSection).toContain('flex-1 min-h-0 overflow-y-auto p-3 space-y-2');
  });
});
