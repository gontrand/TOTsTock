import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useId,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, X, Clock } from 'lucide-react';
import { tr } from '../i18n/dutchTranslator';
import { Language } from '../i18n/translations';

export interface SearchableSelectOption {
  value: string | number;
  label: string;
  hint?: string;
  disabled?: boolean;
  group?: string;
}

export interface SearchableSelectProps {
  value?: string | number | null;
  onChange: (value: string) => void;
  options?: SearchableSelectOption[];
  children?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  searchThreshold?: number;
  alwaysSearch?: boolean;
  emptyLabel?: string;
  'aria-label'?: string;
  id?: string;
  name?: string;
  title?: string;
  'data-testid'?: string;
  recentKey?: string;
  language?: Language;
  maxRenderedOptions?: number;
  longListThreshold?: number;
}

export const RECENT_STORAGE_PREFIX = 'tot_searchable_select_recent_v1_';
export const DEFAULT_RECENT_DEPOTS_KEY = 'depots';

/**
 * Normalise une chaîne pour la recherche insensible à la casse et aux accents.
 */
export function normalizeSearchText(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Indique si une option représente le choix global « Tous / Toutes / Vide ».
 */
export function isAllOrEmptyOption(opt: SearchableSelectOption): boolean {
  const val = String(opt.value ?? '').trim();
  const lbl = normalizeSearchText(opt.label);
  if (val === '' || val.toUpperCase() === 'ALL') return true;
  if (
    lbl === 'tous' ||
    lbl === 'toutes' ||
    lbl === 'all' ||
    lbl === 'alle' ||
    lbl.startsWith('tous ') ||
    lbl.startsWith('toutes ') ||
    lbl.startsWith('all ') ||
    lbl.startsWith('alle ')
  ) {
    return val === '' || val.toUpperCase() === 'ALL';
  }
  return false;
}

/**
 * Lit les 3 derniers choix récents depuis localStorage (avec try/catch).
 */
export function loadRecentSelectValues(recentKey?: string): string[] {
  if (!recentKey) return [];
  try {
    const raw = localStorage.getItem(`${RECENT_STORAGE_PREFIX}${recentKey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => String(v ?? ''))
      .filter((v) => v.length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * Enregistre un choix dans les 3 derniers choix récents dans localStorage (avec try/catch).
 */
export function saveRecentSelectValue(recentKey: string | undefined, value: string): string[] {
  if (!recentKey) return [];
  const clean = String(value ?? '').trim();
  if (!clean || clean.toUpperCase() === 'ALL') return loadRecentSelectValues(recentKey);
  try {
    const prev = loadRecentSelectValues(recentKey);
    const next = [clean, ...prev.filter((v) => v !== clean)].slice(0, 3);
    localStorage.setItem(`${RECENT_STORAGE_PREFIX}${recentKey}`, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export interface FilteredSearchableOptionsResult {
  visibleOptions: SearchableSelectOption[];
  recentOptions: SearchableSelectOption[];
  totalMatched: number;
  hiddenCount: number;
}

/**
 * Filtre et ordonne les options selon la requête :
 * - Insensible à la casse et aux accents sur `label`, `hint`, `group` et `value`.
 * - Multi-mots : tous les mots doivent correspondre.
 * - Conserve l'option « Tous » en tête.
 * - Remonte les 3 derniers choix récents quand la recherche est vide.
 * - Limite l'affichage aux `maxRendered` (défaut 100) premiers résultats lorsque la liste dépasse `longListThreshold` (défaut 200).
 */
export function filterAndSortSearchableOptions(
  options: SearchableSelectOption[],
  query: string,
  config?: {
    recentValues?: string[];
    longListThreshold?: number;
    maxRendered?: number;
  }
): FilteredSearchableOptionsResult {
  const words = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean);
  const longListThreshold = config?.longListThreshold ?? 200;
  const maxRendered = config?.maxRendered ?? 100;
  const recentSet = new Set((config?.recentValues || []).map((v) => String(v)));

  const matched =
    words.length === 0
      ? options
      : options.filter((opt) => {
          const haystack = normalizeSearchText(
            `${opt.label} ${opt.hint || ''} ${opt.group || ''} ${opt.value}`
          );
          return words.every((w) => haystack.includes(w));
        });

  // Séparer l'option « Tous » (quand elle existe en première position) pour la conserver en haut
  const pinnedAll: SearchableSelectOption[] = [];
  const rest: SearchableSelectOption[] = [];
  for (let i = 0; i < matched.length; i++) {
    const opt = matched[i];
    if (i === 0 && isAllOrEmptyOption(opt)) {
      pinnedAll.push(opt);
    } else {
      rest.push(opt);
    }
  }

  const ordered = [...pinnedAll, ...rest];

  // Récents (uniquement lorsque la requête est vide)
  const recentOptions: SearchableSelectOption[] = [];
  if (words.length === 0 && recentSet.size > 0) {
    for (const rv of config?.recentValues || []) {
      const found = rest.find(
        (o) => String(o.value) === String(rv) && !o.disabled && !isAllOrEmptyOption(o)
      );
      if (found && !recentOptions.some((r) => String(r.value) === String(found.value))) {
        recentOptions.push(found);
      }
      if (recentOptions.length >= 3) break;
    }
  }

  const shouldTruncate = options.length > longListThreshold && ordered.length > maxRendered;
  const visibleOptions = shouldTruncate ? ordered.slice(0, maxRendered) : ordered;
  const hiddenCount = shouldTruncate ? ordered.length - visibleOptions.length : 0;

  return {
    visibleOptions,
    recentOptions,
    totalMatched: ordered.length,
    hiddenCount,
  };
}

/**
 * Extrait des `SearchableSelectOption[]` à partir d'enfants JSX `<option>` et `<optgroup>` si `options` n'est pas fourni.
 */
export function extractOptionsFromChildren(children: React.ReactNode): SearchableSelectOption[] {
  const result: SearchableSelectOption[] = [];

  const visit = (nodes: React.ReactNode, groupName?: string) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      const type = child.type;
      const props = (child.props || {}) as Record<string, any>;

      if (type === React.Fragment) {
        visit(props.children, groupName);
        return;
      }

      if (type === 'optgroup') {
        const grp = String(props.label ?? groupName ?? '');
        visit(props.children, grp);
        return;
      }

      if (type === 'option') {
        const rawText = flattenReactText(props.children);
        const val = props.value !== undefined ? props.value : rawText;
        result.push({
          value: val ?? '',
          label: rawText || String(val ?? ''),
          hint: props['data-hint'] ? String(props['data-hint']) : undefined,
          disabled: Boolean(props.disabled),
          group: groupName,
        });
      }
    });
  };

  visit(children);
  return result;
}

function flattenReactText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenReactText).join('');
  if (React.isValidElement(node)) {
    return flattenReactText((node.props as any)?.children);
  }
  return '';
}

function detectStoredLanguage(): Language {
  try {
    const raw = localStorage.getItem('tot_inv_language');
    if (raw === 'en' || raw === 'nl' || raw === 'fr') return raw;
  } catch {
    // ignore
  }
  return 'fr';
}

export function shouldShowSearchInput(
  optionsCount: number,
  searchThreshold = 0,
  alwaysSearch = false
): boolean {
  return Boolean(alwaysSearch || optionsCount >= searchThreshold);
}

export function computeNextKeyboardIndex(
  options: SearchableSelectOption[],
  currentIndex: number,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
): number {
  const len = options.length;
  if (len === 0) return -1;
  if (key === 'Home') {
    return options.findIndex((o) => !o.disabled);
  }
  if (key === 'End') {
    for (let i = len - 1; i >= 0; i--) {
      if (!options[i]?.disabled) return i;
    }
    return -1;
  }
  const delta = key === 'ArrowDown' ? 1 : -1;
  let idx = currentIndex < 0 ? (delta === 1 ? -1 : len) : currentIndex;
  for (let step = 0; step < len; step++) {
    idx = (idx + delta + len) % len;
    if (!options[idx]?.disabled) return idx;
  }
  return -1;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options: propOptions,
  children,
  placeholder,
  disabled = false,
  required = false,
  clearable = false,
  className = '',
  size = 'md',
  searchThreshold = 0,
  alwaysSearch = false,
  emptyLabel,
  'aria-label': ariaLabel,
  id,
  name,
  title,
  'data-testid': dataTestId,
  recentKey,
  language: propLanguage,
  maxRenderedOptions = 100,
  longListThreshold = 200,
}) => {
  const language: Language = propLanguage || detectStoredLanguage();
  const baseId = useId();
  const listboxId = `${id || baseId}-listbox`;

  const options = useMemo<SearchableSelectOption[]>(() => {
    if (Array.isArray(propOptions)) return propOptions;
    return extractOptionsFromChildren(children);
  }, [propOptions, children]);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [recentValues, setRecentValues] = useState<string[]>(() =>
    loadRecentSelectValues(recentKey)
  );
  const [isMobileSheet, setIsMobileSheet] = useState<boolean>(false);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placeAbove: boolean;
  }>({
    top: 0,
    left: 0,
    width: 240,
    maxHeight: 320,
    placeAbove: false,
  });

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  const normalizedValue = value === null || value === undefined ? '' : String(value);

  const selectedOption = useMemo(
    () => options.find((o) => String(o.value) === normalizedValue),
    [options, normalizedValue]
  );

  const showSearchInput = alwaysSearch || options.length >= searchThreshold;

  const { visibleOptions, recentOptions, hiddenCount } = useMemo(
    () =>
      filterAndSortSearchableOptions(options, showSearchInput ? searchQuery : '', {
        recentValues,
        longListThreshold,
        maxRendered: maxRenderedOptions,
      }),
    [options, showSearchInput, searchQuery, recentValues, longListThreshold, maxRenderedOptions]
  );

  const updatePosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const mobile = window.innerWidth < 640;
    setIsMobileSheet(mobile);
    if (mobile || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(180, Math.min(360, placeAbove ? spaceAbove : spaceBelow));
    const width = Math.min(Math.max(rect.width, 220), viewportWidth - 16);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    const top = placeAbove ? Math.max(8, rect.top - 4) : rect.bottom + 4;

    setDropdownRect({
      top,
      left,
      width,
      maxHeight,
      placeAbove,
    });
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setRecentValues(loadRecentSelectValues(recentKey));
    setSearchQuery('');
    updatePosition();
    setIsOpen(true);

    const currentIdx = options.findIndex(
      (o) => String(o.value) === normalizedValue && !o.disabled
    );
    if (currentIdx >= 0) {
      setActiveIndex(currentIdx);
    } else {
      const firstEnabled = options.findIndex((o) => !o.disabled);
      setActiveIndex(firstEnabled >= 0 ? firstEnabled : 0);
    }
  }, [disabled, recentKey, updatePosition, options, normalizedValue]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setSearchQuery('');
    if (restoreFocus) {
      setTimeout(() => {
        triggerRef.current?.focus();
      }, 0);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (showSearchInput) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [isOpen, showSearchInput]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const handleWindowChange = () => updatePosition();

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    window.addEventListener('resize', handleWindowChange);
    window.addEventListener('scroll', handleWindowChange, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
    };
  }, [isOpen, closeMenu, updatePosition]);

  // Maintenir un activeIndex valide lorsque la liste filtrée change
  useEffect(() => {
    if (!isOpen) return;
    if (visibleOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    if (
      activeIndex < 0 ||
      activeIndex >= visibleOptions.length ||
      visibleOptions[activeIndex]?.disabled
    ) {
      const firstEnabled = visibleOptions.findIndex((o) => !o.disabled);
      setActiveIndex(firstEnabled);
    }
  }, [isOpen, visibleOptions, activeIndex]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const el = optionRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, activeIndex]);

  const handleSelectOption = useCallback(
    (opt: SearchableSelectOption) => {
      if (opt.disabled) return;
      const nextVal = String(opt.value ?? '');
      if (recentKey) {
        setRecentValues(saveRecentSelectValue(recentKey, nextVal));
      }
      onChange(nextVal);
      closeMenu(true);
    },
    [onChange, recentKey, closeMenu]
  );

  const findNextEnabledIndex = (start: number, delta: 1 | -1): number => {
    const len = visibleOptions.length;
    if (len === 0) return -1;
    let idx = start;
    for (let step = 0; step < len; step++) {
      idx = (idx + delta + len) % len;
      if (!visibleOptions[idx]?.disabled) return idx;
    }
    return -1;
  };

  const findFirstEnabledIndex = (): number => visibleOptions.findIndex((o) => !o.disabled);

  const findLastEnabledIndex = (): number => {
    for (let i = visibleOptions.length - 1; i >= 0; i--) {
      if (!visibleOptions[i]?.disabled) return i;
    }
    return -1;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        openMenu();
        if (showSearchInput) {
          setSearchQuery(e.key);
        } else {
          const matchIdx = options.findIndex(
            (o) =>
              !o.disabled &&
              normalizeSearchText(o.label).startsWith(normalizeSearchText(e.key))
          );
          if (matchIdx >= 0) setActiveIndex(matchIdx);
        }
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      return;
    }

    if (e.key === 'Tab') {
      closeMenu(false);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => findNextEnabledIndex(prev < 0 ? -1 : prev, 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        findNextEnabledIndex(prev < 0 ? visibleOptions.length : prev, -1)
      );
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(findFirstEnabledIndex());
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(findLastEnabledIndex());
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < visibleOptions.length) {
        const opt = visibleOptions[activeIndex];
        if (opt && !opt.disabled) {
          handleSelectOption(opt);
        }
      }
    }
  };

  const activeOptionId =
    isOpen && activeIndex >= 0 && visibleOptions[activeIndex]
      ? `${listboxId}-opt-${activeIndex}`
      : undefined;

  const displayLabel = selectedOption
    ? selectedOption.label
    : placeholder ||
      tr(language, 'Sélectionner…', 'Select…', 'Selecteren…');

  const sizeClasses =
    size === 'sm'
      ? 'px-2.5 py-1.5 text-xs min-h-[34px]'
      : 'px-3 py-2 text-xs sm:text-sm min-h-[40px]';

  // Rendu d'une ligne d'option
  const renderOptionRow = (opt: SearchableSelectOption, idx: number, isRecent = false) => {
    const isSelected = String(opt.value) === normalizedValue;
    const isActive = !isRecent && idx === activeIndex;
    const optId = isRecent ? `${listboxId}-recent-${opt.value}` : `${listboxId}-opt-${idx}`;

    return (
      <div
        key={isRecent ? `recent-${opt.value}` : `opt-${idx}-${opt.value}`}
        id={optId}
        ref={(el) => {
          if (!isRecent) {
            optionRefs.current[idx] = el;
          }
        }}
        role="option"
        aria-selected={isSelected}
        aria-disabled={Boolean(opt.disabled)}
        data-value={String(opt.value)}
        onMouseEnter={() => {
          if (!opt.disabled && !isRecent) setActiveIndex(idx);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!opt.disabled) handleSelectOption(opt);
        }}
        className={`px-3 py-2 min-h-[44px] sm:min-h-[36px] flex items-center justify-between gap-2 text-left rounded-lg transition select-none ${
          opt.disabled
            ? 'opacity-45 cursor-not-allowed text-slate-400 dark:text-slate-600'
            : isActive
            ? 'bg-orange-50 dark:bg-orange-950/50 text-orange-900 dark:text-orange-200 cursor-pointer'
            : isSelected
            ? 'bg-slate-100 dark:bg-slate-800/90 text-slate-900 dark:text-white font-bold cursor-pointer'
            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate">{opt.label}</div>
          {opt.hint && (
            <div className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
              {opt.hint}
            </div>
          )}
        </div>
        {isSelected && (
          <Check className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
        )}
      </div>
    );
  };

  // Rendu groupé ou plat des options visibles
  const renderOptionsList = () => {
    if (visibleOptions.length === 0) {
      return (
        <div
          data-testid="searchable-select-empty"
          className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500 italic"
        >
          {emptyLabel || tr(language, 'Aucun résultat', 'No results', 'Geen resultaten')}
        </div>
      );
    }

    const elements: React.ReactNode[] = [];

    if (recentOptions.length > 0 && !searchQuery.trim()) {
      elements.push(
        <div
          key="recent-section"
          data-testid="searchable-select-recent-section"
          className="mb-1.5 pb-1.5 border-b border-slate-200 dark:border-slate-800"
        >
          <div className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{tr(language, 'Récents', 'Recent', 'Recent')}</span>
          </div>
          {recentOptions.map((ro, rIdx) => renderOptionRow(ro, rIdx, true))}
        </div>
      );
    }

    let lastGroup: string | undefined = undefined;
    visibleOptions.forEach((opt, idx) => {
      if (opt.group && opt.group !== lastGroup) {
        lastGroup = opt.group;
        elements.push(
          <div
            key={`grp-${opt.group}-${idx}`}
            className="px-2.5 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500"
          >
            {opt.group}
          </div>
        );
      }
      elements.push(renderOptionRow(opt, idx, false));
    });

    if (hiddenCount > 0) {
      elements.push(
        <div
          key="truncated-footer"
          data-testid="searchable-select-more-banner"
          className="px-3 py-2 mt-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 text-center"
        >
          {tr(
            language,
            `${hiddenCount} autres résultats… affinez la recherche`,
            `${hiddenCount} more results… refine search`,
            `${hiddenCount} andere resultaten… verfijn zoekopdracht`
          )}
        </div>
      );
    }

    return elements;
  };

  const popoverContent = isOpen ? (
    isMobileSheet ? (
      <div
        className="fixed inset-0 z-[9999] bg-slate-950/60 backdrop-blur-xs flex flex-col justify-end"
        onClick={() => closeMenu(true)}
      >
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
          className="w-full max-h-[82vh] rounded-t-2xl bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <span className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
              {ariaLabel || placeholder || tr(language, 'Choisir une option', 'Choose an option', 'Kies een optie')}
            </span>
            <button
              type="button"
              onClick={() => closeMenu(true)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              aria-label={tr(language, 'Fermer', 'Close', 'Sluiten')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {showSearchInput && (
            <div className="p-2.5 border-b border-slate-200 dark:border-slate-800">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  data-testid="searchable-select-input"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  placeholder={tr(language, 'Rechercher…', 'Search…', 'Zoeken…')}
                  aria-label={tr(language, 'Rechercher…', 'Search…', 'Zoeken…')}
                  className="w-full pl-8 pr-8 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="p-1 text-slate-400 hover:text-slate-600 absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          <div
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel || placeholder || 'Options'}
            className="p-2 overflow-y-auto flex-1 space-y-0.5"
          >
            {renderOptionsList()}
          </div>
        </div>
      </div>
    ) : (
      <div
        ref={popoverRef}
        onKeyDown={handleKeyDown}
        style={{
          position: 'fixed',
          top: dropdownRect.placeAbove ? undefined : dropdownRect.top,
          bottom: dropdownRect.placeAbove
            ? window.innerHeight - dropdownRect.top
            : undefined,
          left: dropdownRect.left,
          width: dropdownRect.width,
          maxHeight: dropdownRect.maxHeight,
          zIndex: 9999,
        }}
        className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-hidden"
      >
        {showSearchInput && (
          <div className="p-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                data-testid="searchable-select-input"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder={tr(language, 'Rechercher…', 'Search…', 'Zoeken…')}
                aria-label={tr(language, 'Rechercher…', 'Search…', 'Zoeken…')}
                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-0.5 text-slate-400 hover:text-slate-600 absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel || placeholder || 'Options'}
          className="p-1.5 overflow-y-auto flex-1 space-y-0.5"
        >
          {renderOptionsList()}
        </div>
      </div>
    )
  ) : null;

  return (
    <div className={`relative inline-block w-full ${className}`}>
      {(required || name) && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required={required}
          name={name}
          value={normalizedValue}
          onChange={() => {}}
          className="sr-only pointer-events-none"
        />
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel || title || placeholder || displayLabel}
        title={title}
        data-testid={dataTestId || 'searchable-select-trigger'}
        disabled={disabled}
        onClick={() => (isOpen ? closeMenu(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold text-left transition outline-none focus:ring-2 focus:ring-orange-500 ${sizeClasses} ${
          disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600'
        }`}
      >
        <span
          className={`truncate flex-1 ${
            !selectedOption ? 'text-slate-400 dark:text-slate-500' : ''
          }`}
        >
          {displayLabel}
        </span>

        <span className="flex items-center gap-1 shrink-0">
          {clearable && normalizedValue !== '' && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              data-testid="searchable-select-clear"
              aria-label={tr(language, 'Effacer', 'Clear', 'Wissen')}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </span>
      </button>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(popoverContent, document.body)
        : null}
    </div>
  );
};

export default SearchableSelect;
