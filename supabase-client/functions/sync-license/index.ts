// Point d'entrée de compatibilité référençant le dossier de déploiement officiel supabase/functions/
export {
  CURRENT_KEY_ID,
  LEGACY_KEY_RETIRED_AT,
  normalizePlan,
  plan_limits,
  normalizeModules,
  handleSyncLicenseRequest,
} from "../../../supabase/functions/_shared/syncLicenseHandler.ts";
import "../../../supabase/functions/sync-license/index.ts";
