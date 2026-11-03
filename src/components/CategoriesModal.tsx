import React, { useState, useMemo, useRef } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { X, FolderTree, Plus, Trash2, Tag, Search, Edit2, Check } from 'lucide-react';

export const CategoriesModal: React.FC = () => {
  const {
    categoriesModalOpen,
    setCategoriesModalOpen,
    subCategories,
    products,
    saveSubCategory,
    deleteSubCategory,
    userHasPermission,
    language,
    t,
  } = useApp();

  const [newCatName, setNewCatName] = useState('');
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const catInputRef = useRef<HTMLInputElement>(null);

  const canManageCategories = userHasPermission('perm_manage_categories');

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && categoriesModalOpen) {
        setCategoriesModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [categoriesModalOpen, setCategoriesModalOpen]);

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return subCategories;
    const q = searchQuery.toLowerCase().trim();
    return subCategories.filter((c) => c.name.toLowerCase().includes(q));
  }, [subCategories, searchQuery]);

  if (!categoriesModalOpen) return null;

  const handleStartEdit = (cat: { id: number; name: string }) => {
    setEditingCatId(cat.id);
    setNewCatName(cat.name);
    setTimeout(() => {
      catInputRef.current?.focus();
      catInputRef.current?.select();
    }, 50);
  };

  const handleCancelEdit = () => {
    setEditingCatId(null);
    setNewCatName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    if (editingCatId !== null) {
      await saveSubCategory(newCatName.trim(), editingCatId);
      setEditingCatId(null);
    } else {
      await saveSubCategory(newCatName.trim());
    }
    setNewCatName('');
  };

  const handleDelete = async (id: number, name: string) => {
    const count = products.filter((p) => p.sub_category_id === id).length;
    if (count > 0) {
      const confirmMsg = t('cat_delete_confirm_products')
        .replace('{count}', String(count))
        .replace('{name}', name);
      if (!window.confirm(confirmMsg)) {
        return;
      }
    } else {
      const confirmMsg = t('cat_delete_confirm').replace('{name}', name);
      if (!window.confirm(confirmMsg)) return;
    }
    await deleteSubCategory(id);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setCategoriesModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[88dvh] sm:max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 relative overflow-hidden">
          <div className="flex items-center gap-2 min-w-0 flex-1 relative z-10 overflow-hidden">
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center font-bold shrink-0 relative z-20">
              <FolderTree className="w-4 h-4 shrink-0 relative z-20" />
            </div>
            <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
              <h2 className="text-base font-black text-slate-900 dark:text-white leading-tight">
                {t('cat_title')}
              </h2>
              <span className="text-[10px] text-slate-400 font-medium">
                {subCategories.length} {t('cat_total')}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCategoriesModalOpen(false);
            }}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0 relative z-20"
            title={t('common_close')}
            aria-label="Fermer"
          >
            <X className="w-4 h-4 stroke-[2.5] shrink-0 relative z-20" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="pt-3">
          <div className="relative overflow-hidden">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-20 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('cat_search_placeholder')}
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-medium transition relative z-10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 z-20 shrink-0"
                title={t('cat_clear_search')}
              >
                <X className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}
          </div>
        </div>

        {/* Add / Edit Category Form */}
        {canManageCategories && (
          <div className="pt-2">
            {editingCatId !== null && (
              <div className="mb-2 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2 relative overflow-hidden">
                <span className="flex items-center gap-1.5 min-w-0 flex-1 relative z-10">
                  <Edit2 className="w-3.5 h-3.5 text-amber-600 shrink-0 relative z-20" />
                  <span>{tr(language, 'Modification de la catégorie', 'Editing category')}</span>
                </span>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline shrink-0 relative z-20"
                >
                  {tr(language, 'Annuler', 'Cancel')}
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={catInputRef}
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder={editingCatId !== null ? (tr(language, 'Nouveau nom de la catégorie...', 'New category name...')) : t('cat_new_placeholder')}
                required
                className={`flex-1 min-w-0 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl outline-none font-medium transition ${
                  editingCatId !== null
                    ? 'border-amber-500 ring-2 ring-amber-500/30'
                    : 'border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500'
                }`}
              />
              <button
                type="submit"
                className={`px-4 py-2 rounded-xl text-white font-bold text-xs flex items-center gap-1 shrink-0 relative z-20 shadow-sm transition active:scale-95 ${
                  editingCatId !== null
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {editingCatId !== null ? (
                  <>
                    <Check className="w-3.5 h-3.5 shrink-0 relative z-20" />
                    <span>{tr(language, 'Enregistrer', 'Save')}</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5 shrink-0 relative z-20" />
                    <span>{t('cat_create_btn')}</span>
                  </>
                )}
              </button>
              {editingCatId !== null && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0 relative z-20"
                >
                  {tr(language, 'Annuler', 'Cancel')}
                </button>
              )}
            </form>
          </div>
        )}

        {/* Categories List */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1 text-xs">
          {filteredCategories.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <FolderTree className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-700 shrink-0" />
              {searchQuery ? (
                <div>
                  <p className="font-semibold text-slate-600 dark:text-slate-300">
                    {t('cat_no_match').replace('{query}', searchQuery)}
                  </p>
                  {canManageCategories && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewCatName(searchQuery);
                        setSearchQuery('');
                      }}
                      className="mt-2 text-xs text-orange-600 dark:text-orange-400 font-bold hover:underline"
                    >
                      {t('cat_create_suggestion').replace('{query}', searchQuery)}
                    </button>
                  )}
                </div>
              ) : (
                t('cat_empty')
              )}
            </div>
          ) : (
            filteredCategories.map((c) => {
              const count = products.filter((p) => p.sub_category_id === c.id).length;
              const isBeingEdited = editingCatId === c.id;
              return (
                <div
                  key={c.id}
                  className={`p-3 bg-white dark:bg-slate-900 border rounded-xl flex items-center justify-between gap-2 shadow-sm transition relative overflow-hidden ${
                    isBeingEdited
                      ? 'border-amber-500 bg-amber-50/20 dark:bg-amber-950/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-800'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 relative z-10 overflow-hidden">
                    <Tag className="w-3.5 h-3.5 text-orange-500 shrink-0 relative z-20" />
                    <span className="font-extrabold text-slate-800 dark:text-slate-200 truncate relative z-0">
                      {c.name}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-400 shrink-0 relative z-20">
                      {count} {t('cat_prod_badge')}
                    </span>
                  </div>

                  {canManageCategories && (
                    <div className="flex items-center gap-1.5 shrink-0 relative z-20 bg-white dark:bg-slate-900 pl-1.5">
                      <button
                        onClick={() => handleStartEdit(c)}
                        className={`p-1.5 rounded-lg transition shrink-0 relative z-20 ${
                          isBeingEdited
                            ? 'bg-amber-600 text-white'
                            : 'bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 text-amber-600 dark:text-amber-400'
                        }`}
                        title={tr(language, 'Éditer / Modifier la catégorie', 'Edit category')}
                      >
                        <Edit2 className="w-3.5 h-3.5 shrink-0 relative z-20" />
                      </button>
                      <button
                        onClick={() => handleDelete(c.id, c.name)}
                        className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600 transition shrink-0 relative z-20"
                        title={t('cat_delete_title')}
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0 relative z-20" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-400">
            {t('cat_footer_count')
              .replace('{filtered}', String(filteredCategories.length))
              .replace('{total}', String(subCategories.length))}
          </span>
          <button
            onClick={() => setCategoriesModalOpen(false)}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {t('common_close')}
          </button>
        </div>
      </div>
    </div>
  );
};
