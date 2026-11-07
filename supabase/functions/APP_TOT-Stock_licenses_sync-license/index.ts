import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  handleSyncLicenseRequest,
  CURRENT_KEY_ID,
  LEGACY_KEY_RETIRED_AT,
  normalizePlan,
  plan_limits,
  normalizeModules,
} from "../_shared/syncLicenseHandler.ts";

export {
  CURRENT_KEY_ID,
  LEGACY_KEY_RETIRED_AT,
  normalizePlan,
  plan_limits,
  normalizeModules,
};

serve(handleSyncLicenseRequest);
