import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION } from '../appVersion';
import { computeAboutLicenseSnapshot } from '../components/AboutAppPanel';
import { LICENSE_STORAGE_KEY } from '../services/licenseService';
import {
  isSchemaCacheMissingRpcError,
  formatAuditRpcErrorMessage,
  buildSearchLoginLogsRpcParams,
} from '../services/auditService';
import {
  doesHolderMatchDepot,
  getDepotHoldersForDepot,
  getEligibleSourceDepots,
  getEligibleDestDepots,
} from '../services/transferService';
import {
  SearchableSelect,
  SearchableSelectOption,
  normalizeSearchText,
  filterAndSortSearchableOptions,
  loadRecentSelectValues,
  saveRecentSelectValue,
  extractOptionsFromChildren,
  shouldShowSearchInput,
  computeNextKeyboardIndex,
} from '../components/SearchableSelect';
import { Depot, DepotHolder, Role, User } from '../types';

const ROOT_DIR = path.resolve(__dirname, '../..');

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function setupTestLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

setupTestLocalStorage();

function collectTsFiles(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

describe('Prompt v54b — Correctifs app + listes déroulantes avec recherche (SearchableSelect)', () => {
  beforeEach(() => {
    setupTestLocalStorage();
  });

  // =========================================================================
  // 1. « À propos » : licence PRO vs Free via getSavedLicense + enforceSignedLicenseQuotasSync
  // =========================================================================
  describe('1. Panneau « À propos » : lecture de la licence via getSavedLicense() & enforceSignedLicenseQuotasSync()', () => {
    it('affiche Free (1 dépôt, 50 références, signedTokenPresent=false) sans licence enregistrée', () => {
      const snap = computeAboutLicenseSnapshot();
      expect(snap.canonicalPlan).toBe('free');
      expect(snap.planLabel).toContain('Free');
      expect(snap.maxDepots).toBe(1);
      expect(snap.maxRefs).toBe(50);
      expect(snap.signedTokenPresent).toBe(false);
    });

    it('affiche PRO (10 dépôts, 1000 références, jeton signé Présent) lorsque tot_inv_license_info contient PRO + jeton signé valide', () => {
      const futureIso = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
      const proLicense = {
        license_key: 'TOT-STOCK-PRO-2026-TEST',
        plan: 'pro',
        plan_type: 'pro',
        status: 'ACTIVE',
        max_depots: 10,
        expires_at: futureIso,
        signed_token: {
          version: 1,
          license_key: 'TOT-STOCK-PRO-2026-TEST',
          plan: 'pro',
          plan_type: 'pro',
          max_depots: 10,
          expires_at: futureIso,
          issued_at: new Date().toISOString(),
          signature: 'ed25519_sig_test_value',
        },
      };
      localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(proLicense));

      const snap = computeAboutLicenseSnapshot();
      expect(snap.canonicalPlan).toBe('pro');
      expect(snap.planLabel).toContain('PRO');
      expect(snap.maxDepots).toBe(10);
      expect(snap.maxRefs).toBe(1000);
      expect(snap.signedTokenPresent).toBe(true);
      expect(snap.expiresAt).toBe(futureIso);
    });

    it('supprime toute référence à tot_stock_license_status_v1 dans src/components/AboutAppPanel.tsx', () => {
      const aboutSource = fs.readFileSync(
        path.join(ROOT_DIR, 'src/components/AboutAppPanel.tsx'),
        'utf-8'
      );
      expect(aboutSource).not.toContain('tot_stock_license_status_v1');
      expect(aboutSource).toContain('getSavedLicense');
      expect(aboutSource).toContain('enforceSignedLicenseQuotasSync');
    });
  });

  // =========================================================================
  // 2. Journal d'audit, onglet Connexions (search_login_logs)
  // =========================================================================
  describe('2. Journal d’audit, onglet Connexions : paramètres search_login_logs et message clair si schéma non à jour', () => {
    it('conserve exactement les paramètres { p_from, p_to, p_user, p_action, p_text, p_limit, p_offset } sur search_login_logs', () => {
      const rpcParams = buildSearchLoginLogsRpcParams({
        period: 'custom',
        dateFrom: '2026-11-01',
        dateTo: '2026-11-10',
        user: 'USR-1',
        action: 'LOGIN_FAILED',
        text: 'jean',
        limit: 50,
        offset: 0,
      });

      expect(Object.keys(rpcParams).sort()).toEqual(
        ['p_action', 'p_from', 'p_limit', 'p_offset', 'p_text', 'p_to', 'p_user'].sort()
      );
      expect(rpcParams.p_user).toBe('USR-1');
      expect(rpcParams.p_action).toBe('LOGIN_FAILED');
      expect(rpcParams.p_text).toBe('jean');
      expect(rpcParams.p_limit).toBe(50);
      expect(rpcParams.p_offset).toBe(0);
    });

    it('affiche « Script SQL non à jour — exécutez install_v54.sql » lorsque la RPC renvoie Could not find the function ... in the schema cache', () => {
      const rawErr =
        'Could not find the function public.search_login_logs(p_action, p_from, p_limit, p_offset, p_text, p_to, p_user) in the schema cache';
      expect(isSchemaCacheMissingRpcError(rawErr)).toBe(true);
      expect(formatAuditRpcErrorMessage(rawErr, 'fr')).toBe(
        'Script SQL non à jour — exécutez install_v54.sql'
      );
      expect(formatAuditRpcErrorMessage({ code: 'PGRST202', message: 'Function not found' }, 'fr')).toBe(
        'Script SQL non à jour — exécutez install_v54.sql'
      );
      expect(formatAuditRpcErrorMessage('Autre erreur réseau', 'fr')).toBe('Autre erreur réseau');
    });
  });

  // =========================================================================
  // 3. Identifiants de dépôt numériques (bigint -> String(depot.id))
  // =========================================================================
  describe('3. Identifiants de dépôt : conversion String(depot.id) entre stk_depots.id numérique et stk_depot_holders.depot_id texte', () => {
    it('reconnaît un responsable de dépôt lorsque depot.id est le nombre 101 et stk_depot_holders.depot_id vaut "101"', () => {
      const numericDepot: Depot = {
        id: 101 as unknown as number,
        name: 'Camionnette 101',
        type: 'VEHICLE',
        is_active: true,
      };
      const holderUser: User = {
        id: 'USR-101',
        name: 'Marc Chauffeur',
        trigram: 'MCH',
        role_id: 4,
        is_blocked: false,
      };
      const holders: DepotHolder[] = [
        {
          depot_id: '101',
          user_id: 'USR-101',
          can_send: true,
          can_receive: true,
        },
      ];

      expect(doesHolderMatchDepot(holders[0], numericDepot)).toBe(true);
      expect(getDepotHoldersForDepot(numericDepot, holders, [holderUser])).toHaveLength(1);
      expect(getEligibleSourceDepots(holderUser, [numericDepot], holders, false)).toHaveLength(1);
      expect(getEligibleDestDepots([numericDepot], holders, [holderUser])).toHaveLength(1);
    });
  });

  // =========================================================================
  // 4. Composant unique SearchableSelect + Zéro <select> natif restant
  // =========================================================================
  describe('4. SearchableSelect : filtrage sans accent/casse, multi-mots, seuil 8, limite 100 (>200), clavier, clearable, disabled et récents', () => {
    const sampleOptions: SearchableSelectOption[] = [
      { value: 'ALL', label: 'Tous les dépôts' },
      { value: '1', label: 'Dépôt Général Électricité', hint: 'DEP-ELEC', group: 'Magasins fixes' },
      { value: '2', label: 'Entrepôt Béton & Maçonnerie', hint: 'DEP-MAC', group: 'Magasins fixes' },
      { value: '3', label: 'Camionnette Véhicule Marc (MCH)', hint: 'AB-123-CD', group: 'Véhicules' },
      { value: '4', label: 'Fourgon Réseau Étanchéité', hint: 'FG-04', group: 'Véhicules', disabled: true },
    ];

    it('normalise la casse et les accents (é, è, ê, ç) et filtre en multi-mots sur label + hint + group + value', () => {
      expect(normalizeSearchText('Électricité & Maçonnerie')).toBe('electricite & maconnerie');

      // Recherche insensible aux accents et à la casse
      const resAccent = filterAndSortSearchableOptions(sampleOptions, 'electricite');
      expect(resAccent.visibleOptions.map((o) => o.value)).toEqual(['1']);

      // Recherche multi-mots (tous les mots doivent matcher entre label, hint et group)
      const resMulti = filterAndSortSearchableOptions(sampleOptions, 'vehicule mch ab-123');
      expect(resMulti.visibleOptions.map((o) => o.value)).toEqual(['3']);
    });

    it('remonte les 3 derniers choix récents (recentKey) tout en gardant « Tous » en tête lorsque la recherche est vide', () => {
      saveRecentSelectValue('depots_test', '2');
      saveRecentSelectValue('depots_test', '3');
      const recents = loadRecentSelectValues('depots_test');
      expect(recents).toEqual(['3', '2']);

      const ordered = filterAndSortSearchableOptions(sampleOptions, '', {
        recentValues: recents,
      });
      expect(ordered.recentOptions.map((o) => o.value)).toEqual(['3', '2']);
      expect(ordered.visibleOptions[0].value).toBe('ALL');
    });

    it('affiche par défaut le champ de recherche sur toutes les listes', () => {
      expect(shouldShowSearchInput(2)).toBe(true);
      expect(shouldShowSearchInput(5, 8, false)).toBe(false);
      expect(shouldShowSearchInput(8, 8, false)).toBe(true);
      expect(shouldShowSearchInput(3, 8, true)).toBe(true);

      // Navigation clavier : saute l'option disabled (index 4)
      expect(computeNextKeyboardIndex(sampleOptions, 0, 'ArrowDown')).toBe(1);
      expect(computeNextKeyboardIndex(sampleOptions, 3, 'ArrowDown')).toBe(0); // index 4 est disabled -> revient à 0
      expect(computeNextKeyboardIndex(sampleOptions, 0, 'End')).toBe(3);
      expect(computeNextKeyboardIndex(sampleOptions, 2, 'Home')).toBe(0);

      // Extraction d'options depuis des enfants <optgroup> / <option>
      const extracted = extractOptionsFromChildren(
        React.createElement(
          React.Fragment,
          null,
          React.createElement('option', { value: 'ALL' }, 'Tous'),
          React.createElement(
            'optgroup',
            { label: 'Véhicules' },
            React.createElement('option', { value: 'V1', disabled: true }, 'Fourgon 1')
          )
        )
      );
      expect(extracted).toEqual([
        { value: 'ALL', label: 'Tous', hint: undefined, disabled: false, group: undefined },
        { value: 'V1', label: 'Fourgon 1', hint: undefined, disabled: true, group: 'Véhicules' },
      ]);

      // Rendu HTML statique avec clearable=true et role="combobox"
      const html = renderToStaticMarkup(
        React.createElement(SearchableSelect, {
          value: '1',
          onChange: () => {},
          options: sampleOptions,
          clearable: true,
          'aria-label': 'Sélecteur dépôt test',
        })
      );
      expect(html).toContain('role="combobox"');
      expect(html).toContain('Dépôt Général Électricité');
      expect(html).toContain('searchable-select-clear');
    });

    it('limite le résultat aux 100 premiers éléments lorsque la liste dépasse 200 options et calcule hiddenCount (ex: 150 autres résultats)', () => {
      const manyOptions: SearchableSelectOption[] = Array.from({ length: 250 }, (_, i) => ({
        value: `REF-${i + 1}`,
        label: `Article Électrique ${i + 1}`,
      }));

      const res = filterAndSortSearchableOptions(manyOptions, '');
      expect(res.visibleOptions).toHaveLength(100);
      expect(res.totalMatched).toBe(250);
      expect(res.hiddenCount).toBe(150);
    });

    it('vérifie qu’aucun élément <select> natif ne subsiste dans src/ en dehors de SearchableSelect.tsx et aligne la version 5.16.0 / schéma 2.10.0', () => {
      expect(APP_VERSION).toBe('5.16.1');
      expect(EXPECTED_SCHEMA_VERSION).toBe('2.10.0');

      const allSrcFiles = collectTsFiles(path.join(ROOT_DIR, 'src'));
      const filesWithNativeSelect: string[] = [];

      for (const filePath of allSrcFiles) {
        const rel = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
        if (rel === 'src/components/SearchableSelect.tsx') continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        if (/<select[\s>]/i.test(content)) {
          filesWithNativeSelect.push(rel);
        }
      }

      expect(filesWithNativeSelect).toEqual([]);
    });
  });
});
