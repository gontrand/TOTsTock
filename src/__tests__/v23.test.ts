import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { plan_limits } from '../types';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import { compareSemver } from '../services/clientSupabase';
import { EDGE_FUNCTIONS } from '../constants/edgeFunctions';

const rootDir = process.cwd();

describe('TOT Stock – Vérifications automatisées', () => {
  describe('Point 1 – Sécurité APK', () => {
    it('capacitor.config.ts désactive cleartext, allowMixedContent et webContentsDebuggingEnabled par défaut', () => {
      const capFile = fs.readFileSync(path.join(rootDir, 'capacitor.config.ts'), 'utf-8');
      expect(capFile).toContain("process.env.TOT_DEV_BUILD === '1'");
      expect(capFile).toContain('cleartext: isDevBuild');
      expect(capFile).toContain('allowMixedContent: isDevBuild');
      expect(capFile).toContain('webContentsDebuggingEnabled: isDevBuild');
    });

    it('AndroidManifest.xml définit android:allowBackup="false"', () => {
      const manifest = fs.readFileSync(
        path.join(rootDir, 'android/app/src/main/AndroidManifest.xml'),
        'utf-8'
      );
      expect(manifest).toContain('android:allowBackup="false"');
      expect(manifest).not.toContain('android:allowBackup="true"');
    });

    it('build.gradle ne contient plus les mots de passe en clair et exige les variables ANDROID_KEY*', () => {
      const gradle = fs.readFileSync(path.join(rootDir, 'android/app/build.gradle'), 'utf-8');
      expect(gradle).not.toContain('totstock_release_keystore');
      expect(gradle).not.toContain('totstock_release_key');
      expect(gradle).toContain('ANDROID_KEYSTORE_PATH');
      expect(gradle).toContain('ANDROID_KEYSTORE_PASSWORD');
      expect(gradle).toContain('ANDROID_KEY_ALIAS');
      expect(gradle).toContain('ANDROID_KEY_PASSWORD');
      expect(gradle).toContain('GradleException');
    });

    it('MainActivity.java refuse la permission caméra dans le bloc catch (request.deny())', () => {
      const mainActivity = fs.readFileSync(
        path.join(rootDir, 'android/app/src/main/java/com/tot/stock/MainActivity.java'),
        'utf-8'
      );
      expect(mainActivity).toContain('request.deny();');
      expect(mainActivity).toMatch(
        /catch\s*\(\s*Exception\s+e\s*\)\s*\{\s*try\s*\{\s*request\.deny\(\);/
      );
    });
  });

  describe('Point 2 – Source unique pour plan_limits (free, sta, pro, ent)', () => {
    it('retourne les plafonds commerciaux exacts côté TypeScript avec les codes canoniques free, sta, pro, ent', () => {
      expect(plan_limits('free')).toEqual({
        plan: 'free',
        max_references: 50,
        max_depots: 1,
        max_users: 99999,
        default_modules: ['stock'],
      });
      expect(plan_limits('sta')).toEqual({
        plan: 'sta',
        max_references: 300,
        max_depots: 3,
        max_users: 99999,
        default_modules: ['stock'],
      });
      expect(plan_limits('pro')).toEqual({
        plan: 'pro',
        max_references: 1000,
        max_depots: 10,
        max_users: 99999,
        default_modules: ['stock', 'outils', 'rapports'],
      });
      expect(plan_limits('ent')).toEqual({
        plan: 'ent',
        max_references: 99999,
        max_depots: 99999,
        max_users: 99999,
        default_modules: ['stock', 'outils', 'formation', 'rapports'],
      });
    });

    it('normalise les alias en lecture (artisan/starter/standard -> sta, pme/professionnel -> pro, enterprise/entreprise -> ent)', () => {
      expect(plan_limits('artisan').plan).toBe('sta');
      expect(plan_limits('starter').plan).toBe('sta');
      expect(plan_limits('standard').plan).toBe('sta');
      expect(plan_limits('pme').plan).toBe('pro');
      expect(plan_limits('professionnel').plan).toBe('pro');
      expect(plan_limits('enterprise').plan).toBe('ent');
      expect(plan_limits('entreprise').plan).toBe('ent');
    });

    it('synchronise exactement la définition SQL de plan_limits entre schema_master_licenses.sql et 02_rls_hardening.sql', () => {
      const masterSql = fs.readFileSync(
        path.join(rootDir, 'supabase-master/schema_master_licenses.sql'),
        'utf-8'
      );
      const client02Sql = fs.readFileSync(
        path.join(rootDir, 'supabase-client/02_rls_hardening.sql'),
        'utf-8'
      );

      const extractPlanLimitsSql = (sql: string) => {
        const match = sql.match(
          /CREATE OR REPLACE FUNCTION public\.plan_limits\(p_plan TEXT\)[\s\S]*?\$\$;/
        );
        return match ? match[0].trim() : null;
      };

      const masterFn = extractPlanLimitsSql(masterSql);
      const clientFn = extractPlanLimitsSql(client02Sql);

      expect(masterFn).toBeTruthy();
      expect(clientFn).toBe(masterFn);
      expect(masterFn).toContain("'plan', 'sta'");
      expect(masterFn).toContain("'plan', 'pro'");
      expect(masterFn).toContain("'plan', 'ent'");
      expect(masterFn).toContain("'max_references', 300");
      expect(masterFn).toContain("'max_depots', 3");
      expect(masterFn).toContain("'max_references', 1000");
      expect(masterFn).toContain("'max_depots', 10");
    });
  });

  describe('Point 3 – Ordre d’installation SQL et types d’identifiants', () => {
    it('01b_migrate_users_id_to_text.sql échoue proprement si public.core_users n’existe pas', () => {
      const sql01b = fs.readFileSync(
        path.join(rootDir, 'supabase-client/01b_migrate_users_id_to_text.sql'),
        'utf-8'
      );
      expect(sql01b).toContain("table_name = 'core_users'");
      expect(sql01b).toContain('RAISE EXCEPTION');
    });

    it('02_rls_hardening.sql vérifie les prérequis 01_auth_link.sql et utilise TEXT pour les identifiants utilisateurs', () => {
      const sql02 = fs.readFileSync(
        path.join(rootDir, 'supabase-client/02_rls_hardening.sql'),
        'utf-8'
      );
      expect(sql02).toContain('handle_auth_user_created');
      expect(sql02).toContain('RAISE EXCEPTION');
      expect(sql02).toContain('manager_id TEXT');
      expect(sql02).not.toContain('manager_id UUID');
    });
  });

  describe('Point 4 – Edge Functions avec code partagé', () => {
    it('les 3 Edge Functions clientes utilisent _shared et corsHeaders', () => {
      const corsShared = fs.readFileSync(
        path.join(rootDir, 'supabase/functions/_shared/cors.ts'),
        'utf-8'
      );
      expect(corsShared).toContain("'Access-Control-Allow-Origin'");

      for (const fnName of Object.values(EDGE_FUNCTIONS)) {
        const fnEntry = fs.readFileSync(
          path.join(rootDir, `supabase/functions/${fnName}/index.ts`),
          'utf-8'
        );
        expect(fnEntry).toContain('../_shared/');
      }
    });
  });

  describe('Point 5 – Version unique et table core_app_compat', () => {
    it('synchronise APP_VERSION avec package.json', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
      expect(APP_VERSION).toBe(pkg.version);
      expect(EXPECTED_SCHEMA_VERSION).toBeTruthy();
      expect(MIN_SUPPORTED_SCHEMA_VERSION).toBeTruthy();
    });

    it('compare correctement les versions semver pour le blocage min_app_version', () => {
      expect(compareSemver('5.4.9', '5.5.0')).toBe(-1);
      expect(compareSemver('5.5.0', '5.5.0')).toBe(0);
      expect(compareSemver('5.6.0', '5.5.0')).toBe(1);
    });

    it('07_app_compat.sql crée la table singleton public.core_app_compat avec RLS en lecture', () => {
      const sql07 = fs.readFileSync(
        path.join(rootDir, 'supabase-client/07_app_compat.sql'),
        'utf-8'
      );
      expect(sql07).toContain('CREATE TABLE IF NOT EXISTS public.core_app_compat');
      expect(sql07).toContain('ENABLE ROW LEVEL SECURITY');
      expect(sql07).toContain('FOR SELECT');
    });
  });
});
