# Fonction Obsolète (`generate-license`)

> **Statut : OBSOLÈTE — Ne pas déployer.**

La fonction Edge réellement appelée par l'application cliente (`src/services/licenseService.ts`) et par la fonction de synchronisation serveur (`supabase/functions/_shared/syncLicenseHandler.ts`) est :

```text
supabase-master/functions/APP_TOT-Stock_licenses/index.ts
```

Les fonctions partagées (notamment la validation anti-SSRF et la preuve d'appartenance pour l'action `discover`) se trouvent dans :

```text
supabase-master/functions/_shared/discover.ts
```

Ce dossier `generate-license/` est conservé uniquement à titre d'archive historique. Tout déploiement sur le projet Supabase Maître doit cibler la fonction **`APP_TOT-Stock_licenses`**.
