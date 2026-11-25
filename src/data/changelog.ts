export interface ChangelogEntry {
  version: string;
  schemaVersion: string;
  date: string;
  title: {
    fr: string;
    en: string;
    nl: string;
  };
  highlights: {
    fr: string[];
    en: string[];
    nl: string[];
  };
}

/**
 * Nouveautés des 5 dernières versions de TOT Stock (affichées dans la page « À propos »).
 */
export const RECENT_CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '5.23.3',
    schemaVersion: '2.10.0',
    date: '2026-11-25',
    title: {
      fr: 'Correctif : erreur de syntaxe SQL à l\'installation (étape 24)',
      en: 'Fix: SQL syntax error during installation (step 24)',
      nl: 'Fix: SQL-syntaxfout tijdens installatie (stap 24)',
    },
    highlights: {
      fr: [
        'Étape 24 : ALTER DEFAULT PRIVILEGES séparé par type d\'objet (tables, séquences, fonctions) ; la syntaxe groupée provoquait l\'erreur 42601 et bloquait install.sql.',
        'Procédure 2 (base client) alignée sur le même bloc SQL corrigé.',
      ],
      en: [
        'Step 24: ALTER DEFAULT PRIVILEGES split per object type (tables, sequences, functions); the grouped syntax raised error 42601 and blocked install.sql.',
        'Procedure 2 (client base) aligned with the same corrected SQL block.',
      ],
      nl: [
        'Stap 24: ALTER DEFAULT PRIVILEGES gesplitst per objecttype (tabellen, sequenties, functies); de gegroepeerde syntaxis gaf fout 42601 en blokkeerde install.sql.',
        'Procedure 2 (klantdatabase) afgestemd op hetzelfde gecorrigeerde SQL-blok.',
      ],
    },
  },
  {
    version: '5.23.2',
    schemaVersion: '2.10.0',
    date: '2026-11-25',
    title: {
      fr: 'Correctif : tests e-mail et scanner alignés sur les permissions',
      en: 'Fix: email and scanner tests aligned with permissions',
      nl: 'Fix: e-mail- en scannertests afgestemd op permissies',
    },
    highlights: {
      fr: [
        'Tests e-mail/SMTP et verrouillage de commande alignés : le rôle 1 n\'a plus de bypass, seules les permissions (perm_mail_admin, perm_admin_level) comptent.',
        'Aucun changement fonctionnel : correctif de la suite de tests uniquement.',
      ],
      en: [
        'Email/SMTP and order-lock tests aligned: role 1 no longer bypasses, only permissions (perm_mail_admin, perm_admin_level) count.',
        'No functional change: test suite fix only.',
      ],
      nl: [
        'E-mail/SMTP- en ordervergrendelingstests afgestemd: rol 1 heeft geen bypass meer, alleen permissies (perm_mail_admin, perm_admin_level) tellen.',
        'Geen functionele wijziging: enkel een fix van de testsuite.',
      ],
    },
  },
  {
    version: '5.23.1',
    schemaVersion: '2.10.0',
    date: '2026-11-25',
    title: {
      fr: 'Correctif : imports manquants et tests alignés sur le modèle 100 % permissions',
      en: 'Fix: missing imports and tests aligned with the permissions-only model',
      nl: 'Fix: ontbrekende imports en tests afgestemd op het 100 % permissiesmodel',
    },
    highlights: {
      fr: [
        'Correction d\'imports manquants (isAdminLevel) dans AppContext et orderPickingLogic qui provoquaient une ReferenceError au runtime (mode scanner, préparation de commandes).',
        'Traductions néerlandaises ajoutées pour les nouvelles permissions (niveau administration, diagnostic, tous les dépôts, administration e-mail, préparation tous départements) ; tests v50, v59 et v60 alignés sur le modèle par permissions.',
      ],
      en: [
        'Fixed missing isAdminLevel imports in AppContext and orderPickingLogic that caused a runtime ReferenceError (scanner mode, order preparation).',
        'Dutch translations added for the new permissions (administration level, diagnostic, all depots, email administration, prepare all departments); v50, v59 and v60 tests aligned with the permissions model.',
      ],
      nl: [
        'Ontbrekende isAdminLevel-imports hersteld in AppContext en orderPickingLogic die een ReferenceError tijdens runtime veroorzaakten (scannermodus, orderbereiding).',
        'Nederlandse vertalingen toegevoegd voor de nieuwe permissies (beheerdersniveau, diagnose, alle depots, e-mailbeheer, alle afdelingen voorbereiden); tests v50, v59 en v60 afgestemd op het permissiesmodel.',
      ],
    },
  },
  {
    version: '5.23.0',
    schemaVersion: '2.10.0',
    date: '2026-11-25',
    title: {
      fr: 'Autorisations 100 % par permissions : plus aucun role_id codé en dur',
      en: 'Permissions-only authorization: no more hardcoded role_id checks',
      nl: 'Autorisatie 100 % op permissies: geen hardcoded role_id meer',
    },
    highlights: {
      fr: [
        'Pivot complet « 100 % permissions » : plus aucune comparaison role_id === 0/1 (ou IN (0,1,5,8)) dans le code applicatif. Seul le super admin (rôle 0) est bypassé, à un unique endroit dans userHasPermission().',
        'Nouveau script SQL d\'étape 24 : GRANT standards étendus (service_role + authenticated + anon), ALTER DEFAULT PRIVILEGES et seeding automatique de perm_admin_level + perm_diagnostic + perm_mail_admin + perm_depot_view_all aux rôles concernés (0, 1, 2, 5, 6, 8).',
        'Nouvelles permissions perm_admin_level, perm_diagnostic, perm_depot_view_all, perm_mail_admin, perm_orders_prepare_any_dept déclarées dans la matrice ; attribuables depuis l\'UI « Gestion des rôles ».',
        'Policies RLS stk_depots et core_app_settings réécrites 100 % permissions, policy d\'INSERT core_user_preferences ajoutée pour que l\'admin puisse seeder les préférences d\'un nouvel utilisateur.',
      ],
      en: [
        'Complete "permissions-only" pivot: no more role_id === 0/1 (or IN (0,1,5,8)) comparisons in application code. Only the super admin (role 0) is bypassed, in a single place in userHasPermission().',
        'New SQL step 24: extended standard GRANTs (service_role + authenticated + anon), ALTER DEFAULT PRIVILEGES and automatic seeding of perm_admin_level + perm_diagnostic + perm_mail_admin + perm_depot_view_all on the relevant roles (0, 1, 2, 5, 6, 8).',
        'New permissions perm_admin_level, perm_diagnostic, perm_depot_view_all, perm_mail_admin, perm_orders_prepare_any_dept declared in the matrix; assignable from the Roles management UI.',
        'stk_depots and core_app_settings RLS policies rewritten 100 % permissions; INSERT policy on core_user_preferences added so the admin can seed a new user\'s preferences.',
      ],
      nl: [
        'Volledige "100 % permissies" overgang: geen role_id === 0/1 (of IN (0,1,5,8)) vergelijkingen meer in de applicatiecode. Alleen de super admin (rol 0) wordt omzeild, op één enkele plaats in userHasPermission().',
        'Nieuw SQL-stap 24 script: uitgebreide standaard GRANTs (service_role + authenticated + anon), ALTER DEFAULT PRIVILEGES en automatische seeding van perm_admin_level + perm_diagnostic + perm_mail_admin + perm_depot_view_all op de betrokken rollen (0, 1, 2, 5, 6, 8).',
        'Nieuwe permissies perm_admin_level, perm_diagnostic, perm_depot_view_all, perm_mail_admin, perm_orders_prepare_any_dept toegevoegd aan de matrix; toewijsbaar via het Rollenbeheer scherm.',
        'RLS-policies stk_depots en core_app_settings herschreven op 100 % permissies; INSERT-policy op core_user_preferences toegevoegd zodat de admin voorkeuren van een nieuwe gebruiker kan seeden.',
      ],
    },
  },
  {
    version: '5.22.2',
    schemaVersion: '2.10.0',
    date: '2026-11-21',
    title: {
      fr: 'Site vitrine : nouveau slogan de positionnement',
      en: 'Landing page: new positioning slogan',
      nl: 'Landingspagina: nieuwe positioneringsslogan',
    },
    highlights: {
      fr: [
        'Ajout du slogan de positionnement en page d’accueil : « Une action métier doit être plus rapide à réaliser dans TOT qu’avec Excel, WhatsApp et un registre papier réunis. »',
        'Le message est mis en avant dans le bandeau d’accueil, sous l’accroche principale, pour affirmer la promesse de rapidité de l’application.',
      ],
      en: [
        'Added the positioning slogan on the landing page: “A business action must be faster to perform in TOT than with Excel, WhatsApp and a paper logbook combined.”',
        'The message is highlighted in the hero banner, under the main headline, to assert the app’s promise of speed.',
      ],
      nl: [
        'Positioneringsslogan toegevoegd op de landingspagina: “Een zakelijke handeling moet sneller uit te voeren zijn in TOT dan met Excel, WhatsApp en een papieren register samen.”',
        'De boodschap wordt uitgelicht in de herobanner, onder de hoofdtitel, om de snelheidsbelofte van de app te benadrukken.',
      ],
    },
  },
  {
    version: '5.22.1',
    schemaVersion: '2.10.0',
    date: '2026-11-21',
    title: {
      fr: 'Attribution automatique d’une licence Free à chaque nouvelle organisation',
      en: 'Automatic Free license assignment for each new organization',
      nl: 'Automatische toewijzing van een Free-licentie aan elke nieuwe organisatie',
    },
    highlights: {
      fr: [
        'Quand une organisation relie l’app à son projet et n’a pas encore de licence, la base maître lui crée automatiquement une ligne Free (liée à son projet, après preuve d’appartenance) au lieu de refuser.',
        'Chaque organisation possède donc désormais une ligne de licence, Free comprise : suivi et changements de forfait plus simples. La vue de synthèse compte toujours correctement Free et payantes.',
      ],
      en: [
        'When an organization links the app to its project and has no license yet, the master database automatically creates a Free row for it (bound to its project, after ownership proof) instead of refusing.',
        'Every organization now has a license row, including Free: easier tracking and plan changes. The summary view still counts Free and paid correctly.',
      ],
      nl: [
        'Wanneer een organisatie de app aan haar project koppelt en nog geen licentie heeft, maakt de masterdatabase automatisch een Free-rij aan (gekoppeld aan haar project, na eigendomsbewijs) in plaats van te weigeren.',
        'Elke organisatie heeft nu een licentierij, inclusief Free: eenvoudiger opvolgen en wijzigen van formule. De overzichtsweergave telt Free en betalend nog steeds correct.',
      ],
    },
  },
  {
    version: '5.22.0',
    schemaVersion: '2.10.0',
    date: '2026-11-21',
    title: {
      fr: 'Registre des installations : compter les organisations, même en Free',
      en: 'Installations registry: count organizations, even on Free',
      nl: 'Installatieregister: organisaties tellen, zelfs op Free',
    },
    highlights: {
      fr: [
        'La base maître enregistre désormais chaque organisation qui relie l’app à son projet Supabase, Free comprise, lors de la découverte de licence (après preuve d’appartenance). Vous connaissez enfin le nombre d’organisations utilisatrices.',
        'Aucun appel répété ni code ajouté côté application : on réutilise la vérification déjà effectuée à la configuration (limitée à une fois par 24 h). Aucune donnée personnelle n’est stockée (référence de projet et version seulement).',
      ],
      en: [
        'The master database now records each organization that links the app to its Supabase project, including Free, during license discovery (after ownership proof). You finally know how many organizations use the app.',
        'No repeated calls and no added app code: it reuses the check already performed at setup (limited to once per 24h). No personal data is stored (project reference and version only).',
      ],
      nl: [
        'De masterdatabase registreert nu elke organisatie die de app aan haar Supabase-project koppelt, inclusief Free, tijdens de licentieontdekking (na eigendomsbewijs). U weet eindelijk hoeveel organisaties de app gebruiken.',
        'Geen herhaalde oproepen en geen extra app-code: de controle die al bij de configuratie gebeurt, wordt hergebruikt (max. eenmaal per 24 u). Er worden geen persoonsgegevens opgeslagen (enkel projectreferentie en versie).',
      ],
    },
  },
  {
    version: '5.21.1',
    schemaVersion: '2.10.0',
    date: '2026-11-19',
    title: {
      fr: 'Sécurité : suppression des comptes et codes d’accès figés (portes dérobées)',
      en: 'Security: removal of hardcoded accounts and access codes (backdoors)',
      nl: 'Beveiliging: verwijdering van vaste accounts en toegangscodes (achterdeurtjes)',
    },
    highlights: {
      fr: [
        'Le compte d’amorçage (bootstrap) ne dépend plus d’un mot de passe figé dans le code : il utilise la variable VITE_BOOTSTRAP_ADMIN_PASSWORD, et se désactive automatiquement dès qu’un vrai administrateur (relié à un compte Supabase Auth) existe.',
        'Suppression de la porte dérobée qui acceptait deux codes figés lors de la ré-authentification pour remplacer la clé Supabase.',
      ],
      en: [
        'The bootstrap account no longer relies on a password hardcoded in the source: it uses the VITE_BOOTSTRAP_ADMIN_PASSWORD variable and disables itself automatically once a real administrator (linked to a Supabase Auth account) exists.',
        'Removed the backdoor that accepted two hardcoded codes during the re-authentication to replace the Supabase key.',
      ],
      nl: [
        'Het bootstrap-account steunt niet langer op een in de code vastgelegd wachtwoord: het gebruikt de variabele VITE_BOOTSTRAP_ADMIN_PASSWORD en schakelt zichzelf automatisch uit zodra er een echte beheerder (gekoppeld aan een Supabase Auth-account) bestaat.',
        'Het achterdeurtje dat twee vaste codes accepteerde bij de herauthenticatie om de Supabase-sleutel te vervangen, is verwijderd.',
      ],
    },
  },
  {
    version: '5.21.0',
    schemaVersion: '2.10.0',
    date: '2026-11-19',
    title: {
      fr: 'Sécurité : le mot de passe est désormais toujours vérifié à la connexion',
      en: 'Security: the password is now always verified at login',
      nl: 'Beveiliging: het wachtwoord wordt nu altijd gecontroleerd bij het inloggen',
    },
    highlights: {
      fr: [
        'Correction d’une faille majeure : la connexion acceptait n’importe quel mot de passe pour un profil non relié à un compte Supabase Auth. Désormais, un échec d’authentification refuse l’accès, sans exception.',
        'Suppression de l’auto-création de compte au login et du profil « super administrateur » attribué automatiquement.',
        'Conséquence : les comptes doivent être créés par un administrateur (fonction admin-users, qui crée le compte Auth et le profil). Les utilisateurs de test créés sans compte Auth devront être recréés ainsi.',
      ],
      en: [
        'Fixed a major flaw: login accepted any password for a profile not linked to a Supabase Auth account. Now an authentication failure denies access, without exception.',
        'Removed login-time account auto-creation and the automatically granted “super administrator” profile.',
        'Consequence: accounts must be created by an administrator (admin-users function, which creates both the Auth account and the profile). Test users created without an Auth account must be recreated this way.',
      ],
      nl: [
        'Een ernstig lek verholpen: bij het inloggen werd elk wachtwoord geaccepteerd voor een profiel zonder gekoppeld Supabase Auth-account. Een authenticatiefout weigert nu de toegang, zonder uitzondering.',
        'Verwijderd: het automatisch aanmaken van een account bij het inloggen en het automatisch toegekende “superbeheerder”-profiel.',
        'Gevolg: accounts moeten door een beheerder worden aangemaakt (admin-users-functie, die zowel het Auth-account als het profiel aanmaakt). Testgebruikers zonder Auth-account moeten zo opnieuw worden aangemaakt.',
      ],
    },
  },
  {
    version: '5.20.2',
    schemaVersion: '2.10.0',
    date: '2026-11-19',
    title: {
      fr: 'Correctif interne : tests alignés sur le nouveau script SQL 23',
      en: 'Internal fix: tests aligned with the new SQL script 23',
      nl: 'Interne correctie: tests afgestemd op het nieuwe SQL-script 23',
    },
    highlights: {
      fr: [
        'Correction d’un test d’intégration continue qui attendait encore 22 étapes SQL : l’ajout du script 23 (triggers updated_at) est désormais pris en compte.',
        'Aucun changement fonctionnel ni de base de données : si le script 23 a déjà été exécuté avec la 5.20.0, rien à refaire.',
      ],
      en: [
        'Fixed a CI test still expecting 22 SQL steps: the new script 23 (updated_at triggers) is now accounted for.',
        'No functional or database change: if script 23 was already run with 5.20.0, nothing to redo.',
      ],
      nl: [
        'Een CI-test die nog 22 SQL-stappen verwachtte, is gecorrigeerd: het nieuwe script 23 (updated_at-triggers) wordt nu meegeteld.',
        'Geen functionele of databasewijziging: als script 23 al met 5.20.0 is uitgevoerd, hoeft er niets opnieuw.',
      ],
    },
  },
  {
    version: '5.20.1',
    schemaVersion: '2.10.0',
    date: '2026-11-19',
    title: {
      fr: 'Conditions d’utilisation : interdiction explicite de contournement et de désobfuscation',
      en: 'Terms of use: explicit ban on circumvention and de-obfuscation',
      nl: 'Gebruiksvoorwaarden: uitdrukkelijk verbod op omzeiling en de-obfuscatie',
    },
    highlights: {
      fr: [
        'L’article 4 des conditions d’utilisation (et le texte de l’installateur) interdit désormais explicitement de contourner les protections techniques, de désobfusquer ou de reconstituer le code protégé.',
        'Les conditions mises à jour sont présentées à nouveau au premier lancement (acceptation redemandée).',
      ],
      en: [
        'Article 4 of the terms of use (and the installer text) now explicitly prohibits circumventing the technical protections, de-obfuscating or reconstructing the protected code.',
        'The updated terms are shown again at first launch (acceptance requested anew).',
      ],
      nl: [
        'Artikel 4 van de gebruiksvoorwaarden (en de tekst van het installatieprogramma) verbiedt nu uitdrukkelijk het omzeilen van de technische beveiligingen, het de-obfusceren of het reconstrueren van de beschermde code.',
        'De bijgewerkte voorwaarden worden opnieuw getoond bij de eerste start (aanvaarding opnieuw gevraagd).',
      ],
    },
  },
  {
    version: '5.20.0',
    schemaVersion: '2.10.0',
    date: '2026-11-19',
    title: {
      fr: 'Synchronisation incrémentale (delta) : égress Supabase réduit, viable à plusieurs dizaines d’utilisateurs',
      en: 'Incremental (delta) sync: reduced Supabase egress, viable for dozens of users',
      nl: 'Incrementele (delta) synchronisatie: minder Supabase-egress, haalbaar voor tientallen gebruikers',
    },
    highlights: {
      fr: [
        'La synchronisation ne retélécharge plus tout le catalogue et tous les niveaux de stock à chaque fois : elle ne récupère que les lignes modifiées depuis la dernière synchro (filtre updated_at). Une synchro sans changement ne transfère quasiment rien.',
        'Réconciliation complète automatique toutes les 5 minutes et au retour sur l’onglet, pour rattraper les suppressions (que le delta ne voit pas).',
        'IMPORTANT — base de données : exécutez le script SQL mis à jour (dist/install.sql, qui inclut l’étape 23) dans Supabase. Il ajoute les déclencheurs updated_at sur les produits et les niveaux de stock, indispensables au delta. Sans cette étape, l’app bascule automatiquement sur la synchro complète (sûre, mais sans l’économie).',
      ],
      en: [
        'Sync no longer re-downloads the whole catalogue and all stock levels every time: it only fetches rows changed since the last sync (updated_at filter). A sync with no change transfers almost nothing.',
        'Automatic full reconciliation every 5 minutes and when returning to the tab, to catch deletions (which delta cannot see).',
        'IMPORTANT — database: run the updated SQL script (dist/install.sql, which includes step 23) in Supabase. It adds the updated_at triggers on products and stock levels, required by delta. Without this step the app falls back to full sync (safe, but without the saving).',
      ],
      nl: [
        'Synchronisatie downloadt niet langer elke keer de volledige catalogus en alle voorraadniveaus: alleen de rijen die sinds de laatste synchronisatie zijn gewijzigd (updated_at-filter). Een synchronisatie zonder wijziging verstuurt vrijwel niets.',
        'Automatische volledige reconciliatie elke 5 minuten en bij terugkeer naar het tabblad, om verwijderingen op te vangen (die delta niet ziet).',
        'BELANGRIJK — database: voer het bijgewerkte SQL-script (dist/install.sql, met stap 23) uit in Supabase. Het voegt de updated_at-triggers toe op producten en voorraadniveaus, vereist voor delta. Zonder deze stap valt de app terug op volledige synchronisatie (veilig, maar zonder de besparing).',
      ],
    },
  },
  {
    version: '5.19.0',
    schemaVersion: '2.10.0',
    date: '2026-11-18',
    title: {
      fr: 'Synchronisation multi-appareils optimisée : forte baisse du trafic Supabase (egress)',
      en: 'Optimised multi-device sync: large drop in Supabase traffic (egress)',
      nl: 'Geoptimaliseerde multi-apparaatsynchronisatie: sterke daling van Supabase-verkeer (egress)',
    },
    highlights: {
      fr: [
        'Le sondage périodique de synchronisation passe de 6 à 60 secondes : le temps réel assure toujours les mises à jour instantanées entre appareils, le sondage n’est qu’un filet de secours.',
        'Les modifications en rafale (import de produits, panier multi-articles, validations en lot) ne déclenchent plus qu’un seul rechargement regroupé au lieu d’un par ligne.',
        'Objectif : éviter de dépasser les quotas du plan Supabase (egress, journaux) observés lors des tests intensifs, sans changer le fonctionnement visible de l’application.',
      ],
      en: [
        'The periodic sync poll goes from 6 to 60 seconds: realtime still delivers instant cross-device updates, the poll is only a fallback.',
        'Burst changes (product import, multi-item cart, batch approvals) now trigger a single grouped refresh instead of one per row.',
        'Goal: avoid exceeding the Supabase plan quotas (egress, logs) seen during intensive testing, without changing the app’s visible behaviour.',
      ],
      nl: [
        'De periodieke synchronisatiepeiling gaat van 6 naar 60 seconden: realtime levert nog steeds directe updates tussen apparaten, de peiling is enkel een vangnet.',
        'Wijzigingen in bursts (productimport, winkelmand met meerdere artikelen, batchgoedkeuringen) activeren nu één gegroepeerde verversing in plaats van één per rij.',
        'Doel: de Supabase-quota (egress, logs) die tijdens intensief testen werden overschreden vermijden, zonder het zichtbare gedrag van de app te wijzigen.',
      ],
    },
  },
  {
    version: '5.18.0',
    schemaVersion: '2.10.0',
    date: '2026-11-18',
    title: {
      fr: 'Build testeurs : JavaScript obfusqué (protection renforcée, notamment pour l’APK)',
      en: 'Tester build: obfuscated JavaScript (stronger protection, especially for the APK)',
      nl: 'Testersbuild: geobfusceerde JavaScript (sterkere bescherming, vooral voor de APK)',
    },
    highlights: {
      fr: [
        'Le build « testeurs » (VITE_DISTRIBUTION=tester) obfusque désormais tout le JavaScript livré (noms de variables/fonctions et chaînes de caractères rendus illisibles), en plus du retrait des scripts SQL déjà en place.',
        'S’applique automatiquement aux trois cibles construites depuis dist/ : PWA, application de bureau et APK Android — l’APK étant un simple fichier .zip, c’était la cible la plus facile à ouvrir pour un curieux.',
        'Vérification automatique (npm run check:tester-dist) : échoue si l’obfuscation n’a pas tourné ou si javascript-obfuscator n’est pas installé, pour ne jamais livrer un build testeurs non protégé par erreur.',
      ],
      en: [
        'The “tester” build (VITE_DISTRIBUTION=tester) now obfuscates all shipped JavaScript (variable/function names and strings made unreadable), on top of the existing SQL script removal.',
        'Applies automatically to all three targets built from dist/: PWA, desktop app and Android APK — the APK being a plain .zip file, it was the easiest target for a curious person to open.',
        'Automatic check (npm run check:tester-dist): fails if obfuscation did not run or javascript-obfuscator is not installed, so an unprotected tester build is never shipped by mistake.',
      ],
      nl: [
        'De “testers”-build (VITE_DISTRIBUTION=tester) obfusceert nu alle geleverde JavaScript (variabele-/functienamen en tekststrings onleesbaar gemaakt), naast het al bestaande verwijderen van SQL-scripts.',
        'Geldt automatisch voor de drie doelen die uit dist/ worden gebouwd: PWA, desktoptoepassing en Android-APK — de APK is een eenvoudig .zip-bestand en was het makkelijkste doel om te openen voor een nieuwsgierige.',
        'Automatische controle (npm run check:tester-dist): mislukt als de obfuscatie niet is uitgevoerd of javascript-obfuscator niet is geïnstalleerd, zodat er nooit per ongeluk een onbeschermde testersbuild wordt uitgeleverd.',
      ],
    },
  },
  {
    version: '5.17.0',
    schemaVersion: '2.10.0',
    date: '2026-11-18',
    title: {
      fr: 'Version bêta : conditions d’utilisation, protection de l’œuvre et build testeurs sans scripts SQL',
      en: 'Beta version: terms of use, work protection and tester build without SQL scripts',
      nl: 'Bètaversie: gebruiksvoorwaarden, bescherming van het werk en testersbuild zonder SQL-scripts',
    },
    highlights: {
      fr: [
        'Nouvel écran d’acceptation des conditions d’utilisation au premier lancement (propriété intellectuelle, interdiction de distribution, limitation de responsabilité, mention du « Contrat de mise en test – Partenariat TOT Stock »), aussi affiché dans l’installateur Windows et relisible depuis « À propos ».',
        'Pastille « BETA » dans l’en-tête, le menu bureau, l’écran de connexion et « À propos » ; mention © Gontrand NYUNG.',
        'Build « testeurs » (variable VITE_DISTRIBUTION=tester, commande npm run build:tester) : scripts SQL, fonctions Edge et schéma retirés de l’application, de l’installateur et de l’APK ; panneaux « Scripts SQL » et « Fonctions Edge » masqués.',
      ],
      en: [
        'New terms-of-use acceptance screen at first launch (intellectual property, no distribution, limitation of liability, reference to the “Contrat de mise en test – Partenariat TOT Stock”), also shown in the Windows installer and readable from “About”.',
        '“BETA” badge in the header, desktop menu, login screen and “About”; © Gontrand NYUNG notice.',
        '“Tester” build (VITE_DISTRIBUTION=tester, npm run build:tester): SQL scripts, Edge functions and schema removed from the app, installer and APK; “SQL scripts” and “Edge functions” panels hidden.',
      ],
      nl: [
        'Nieuw scherm voor het aanvaarden van de gebruiksvoorwaarden bij de eerste start (intellectuele eigendom, verbod op verspreiding, beperking van aansprakelijkheid, verwijzing naar het “Contrat de mise en test – Partenariat TOT Stock”), ook getoond in het Windows-installatieprogramma en te herlezen onder “Over”.',
        '“BETA”-label in de koptekst, het desktopmenu, het inlogscherm en “Over”; vermelding © Gontrand NYUNG.',
        'Testersbuild (VITE_DISTRIBUTION=tester, npm run build:tester): SQL-scripts, Edge-functies en schema verwijderd uit de app, het installatieprogramma en de APK; panelen “SQL-scripts” en “Edge-functies” verborgen.',
      ],
    },
  },
  {
    version: '5.16.3',
    schemaVersion: '2.10.0',
    date: '2026-11-10',
    title: {
      fr: 'Manuels mis à jour : sorties de stock, commandes, rôles, poste d’impression et application bureau',
      en: 'Updated manuals: stock exits, orders, roles, print station and desktop app',
      nl: 'Bijgewerkte handleidingen: voorraaduitgang, bestellingen, rollen, afdrukstation en desktop-app',
    },
    highlights: {
      fr: [
        'Manuel intégré : nouveaux chapitres sur le magasin de sortie, la règle Logistique, la validation des commandes par seuil et par permission, la duplication de rôle, le poste d’impression et le cadre de fenêtre bureau.',
        'Guide d’exploitation et fiche du poste d’impression mis à jour (scripts 21 et 22, suppression d’un poste, état des postes).',
      ],
      en: [
        'Built-in manual: new chapters on the exit depot, the Logistics rule, order approval by threshold and permission, role duplication, the print station and the desktop window frame.',
        'Operations guide and print station sheet updated (scripts 21 and 22, station deletion, station status).',
      ],
      nl: [
        'Ingebouwde handleiding: nieuwe hoofdstukken over het uitgangsdepot, de Logistiek-regel, bestelgoedkeuring op drempel en recht, rol dupliceren, het afdrukstation en het desktopvenster.',
        'Beheerhandleiding en fiche van het afdrukstation bijgewerkt (scripts 21 en 22, station verwijderen, stationstatus).',
      ],
    },
  },
  {
    version: '5.16.2',
    schemaVersion: '2.10.0',
    date: '2026-11-10',
    title: {
      fr: 'Postes d’impression : état réel, motif d’échec et suppression d’un poste',
      en: 'Print stations: real status, failure reason and station deletion',
      nl: 'Afdrukstations: echte status, foutreden en station verwijderen',
    },
    highlights: {
      fr: [
        'Nouveau panneau « Postes d’impression » : tous les postes avec leur état réel (en ligne / hors ligne), dernière activité et demandes en attente.',
        'Bouton « Supprimer ce poste » (propriétaire ou administrateur) avec la fonction SQL delete_print_station (script 08).',
        'Le motif de l’échec s’affiche sur les demandes en échec et le badge du poste reflète l’état réel du serveur.',
      ],
      en: [
        'New "Print stations" panel: every station with its real status (online / offline), last activity and pending jobs.',
        '"Delete this station" button (owner or administrator) backed by the delete_print_station SQL function (script 08).',
        'The failure reason is shown on failed jobs and the station badge reflects the real server status.',
      ],
      nl: [
        'Nieuw paneel "Afdrukstations": alle stations met echte status (online / offline), laatste activiteit en openstaande opdrachten.',
        'Knop "Dit station verwijderen" (eigenaar of beheerder) met de SQL-functie delete_print_station (script 08).',
        'De foutreden wordt getoond bij mislukte opdrachten en de statusbadge weerspiegelt de echte serverstatus.',
      ],
    },
  },
  {
    version: '5.16.1',
    schemaVersion: '2.10.0',
    date: '2026-11-10',
    title: {
      fr: 'Validation des commandes par permission, duplication de rôle, cadre de fenêtre moderne & poste d’impression permanent',
      en: 'Permission-based order approval, role duplication, modern window frame & always-on print station',
      nl: 'Bestelgoedkeuring op basis van rechten, rol dupliceren, modern venster & permanent afdrukstation',
    },
    highlights: {
      fr: [
        'La validation des commandes ne dépend plus d’un numéro de rôle : seules la permission « Valider ou Refuser une Commande » (et les responsables de département ou de chantier) comptent, avec contrôle du seuil côté serveur.',
        'Bouton « Dupliquer » pour créer un rôle à partir d’un rôle existant sans repartir de zéro.',
        'Cadre de fenêtre desktop moderne (barre de titre intégrée, menu ☰), panneau latéral de l’inventaire sans fiche modale superposée et poste d’impression actif en arrière-plan.',
      ],
      en: [
        'Order approval no longer depends on a role number: only the "Approve or reject an order" permission (and department or project managers) counts, with server-side threshold enforcement.',
        '"Duplicate" button to create a role from an existing one without starting from scratch.',
        'Modern desktop window frame (integrated title bar, ☰ menu), inventory side panel without a stacked modal, and print station running in the background.',
      ],
      nl: [
        'Bestelgoedkeuring hangt niet meer af van een rolnummer: alleen het recht "Bestelling goedkeuren of weigeren" (en afdelings- of projectverantwoordelijken) telt, met drempelcontrole aan serverzijde.',
        'Knop "Dupliceren" om een rol te maken op basis van een bestaande rol.',
        'Modern desktopvenster (geïntegreerde titelbalk, ☰-menu), zijpaneel van de voorraad zonder gestapelde modal en afdrukstation dat op de achtergrond actief blijft.',
      ],
    },
  },
  {
    version: '5.16.0',
    schemaVersion: '2.10.0',
    date: '2026-11-14',
    title: {
      fr: 'Notifications lues par utilisateur, cartes commandes annulées/refusées & préparateurs limités à leurs dépôts',
      en: 'Per-user read notifications, cancelled/rejected order cards & preparers restricted to their depots',
      nl: 'Gelezen meldingen per gebruiker, kaarten voor geannuleerde/geweigerde bestellingen & orderpickers beperkt tot hun depots',
    },
    highlights: {
      fr: [
        'Notifications « lues » synchronisées par utilisateur (table core_notification_dismissals, RPC dismiss_notifications et clear_my_dismissals) avec repli hors-ligne local par compte et réapparition automatique si le statut de la commande évolue.',
        'Bouton « ✕ Marquer comme lue » sur chaque carte, « Tout marquer comme lu » dans l’en-tête et « Réinitialiser ma cloche » en pied de panneau.',
        'Cartes distinctes par type de notification (icône XCircle rose/ambre, numéro, motif et auteur pour les commandes annulées ou refusées, avec expiration automatique au-delà de 7 jours).',
        'Règle stricte des dépôts d’un préparateur (union allowed_depots ∪ stk_depot_holders, aucun dépôt si vide hors rôles 0/1) et alerte orange « Aucun dépôt attribué » sur la fiche utilisateur.',
      ],
      en: [
        'Per-user synchronized read notifications (core_notification_dismissals table, dismiss_notifications and clear_my_dismissals RPCs) with per-user offline fallback and automatic reappearance when order status changes.',
        '"✕ Mark as read" button on every card, "Mark all as read" in the header, and "Reset my bell" in the footer.',
        'Distinct cards per notification type (rose/amber XCircle icon, order number, reason, and author for cancelled or rejected orders, with automatic 7-day expiry).',
        'Strict preparer depot rule (union allowed_depots ∪ stk_depot_holders, no depots when empty for non-admin roles) and orange "No depot assigned" warning on user profiles.',
      ],
      nl: [
        'Per gebruiker gesynchroniseerde gelezen meldingen (tabel core_notification_dismissals, RPC’s dismiss_notifications en clear_my_dismissals) met lokale offline terugval per account en automatische terugkeer bij statuswijziging.',
        'Knop "✕ Markeren als gelezen" op elke kaart, "Alles markeren als gelezen" in de koptekst en "Mijn bel herstellen" in de voettekst.',
        'Onderscheidende kaarten per meldingstype (roze/amber XCircle-icoon, bestelnummer, reden en auteur voor geannuleerde of geweigerde bestellingen, met automatische vervaldatum na 7 dagen).',
        'Strikte depotregel voor orderpickers (vereniging allowed_depots ∪ stk_depot_holders, geen depots indien leeg voor niet-beheerders) en oranje waarschuwing "Geen depot toegewezen" op het gebruikersprofiel.',
      ],
    },
  },
  {
    version: '5.15.0',
    schemaVersion: '2.9.0',
    date: '2026-11-13',
    title: {
      fr: 'Sécurité clé Supabase, déconnexion automatique garantie, notifications ciblées & traçabilité des commandes',
      en: 'Supabase key security, guaranteed auto-logout, targeted notifications & order traceability',
      nl: 'Supabase-sleutelbeveiliging, gegarandeerde auto-uitlog, gerichte meldingen & besteltraceerbaarheid',
    },
    highlights: {
      fr: [
        'Lien « Mot de passe oublié ? » repositionné sous le champ mot de passe (zone tactile ≥ 44 px) et masquage définitif de la clé anon/publishable une fois la base connectée (remplacement protégé par PIN/mot de passe, rôle 0/1 et QR auto-masqué après 60 s).',
        'Déconnexion automatique obligatoire par horodatage (plafond société security_max_idle_minutes, immunisée contre la mise en veille, la caméra QR et le WakeLock, avec arrêt automatique des flux caméra).',
        'Notifications ciblées par identifiant utilisateur (préparateurs du dépôt, demandeur, enleveur désigné, destinataires de transfert) et préférences individuelles par type.',
        'Traçabilité complète du cycle de vie des commandes (création, prise en charge, lignes préparées, retrait, délégation/transfert d’enlèvement, annulation) dans les fiches commandes, le journal d’audit et les rapports.',
      ],
      en: [
        '"Forgot password?" link moved below the password field (≥ 44 px touch target) and permanent masking of the anon/publishable key once connected (replacement gated by PIN/password, role 0/1, and 60s auto-hidden config QR).',
        'Mandatory timestamp-based inactivity auto-logout (company ceiling security_max_idle_minutes, immune to sleep/background tabs, QR camera, and WakeLock, with automatic camera stream shutdown).',
        'Targeted notifications by user ID (depot preparers, requester, designated collector, transfer recipients) and per-type user preferences.',
        'Full order lifecycle traceability (creation, claim, prepared lines, pickup, pickup delegation/transfer, cancellation) across order details, audit log, and reports.',
      ],
      nl: [
        'Link "Wachtwoord vergeten?" verplaatst onder het wachtwoordveld (aanraakzone ≥ 44 px) en permanente maskering van de anon/publishable-sleutel na verbinding (vervanging beveiligd met PIN/wachtwoord, rol 0/1 en QR automatisch verborgen na 60 s).',
        'Verplichte automatische uitlog op basis van tijdstempel (bedrijfsplafond security_max_idle_minutes, ongevoelig voor slaapstand, QR-camera en WakeLock, met automatische uitschakeling van camerastreams).',
        'Gerichte meldingen op gebruikers-ID (depotvoorbereiders, aanvrager, aangewezen afhaler, overdrachtontvangers) en individuele voorkeuren per type.',
        'Volledige traceerbaarheid van de bestelcyclus (aanmaak, toewijzing, gepickte regels, afhaling, overdracht van afhaling, annulering) in bestelfiches, auditlogboek en rapporten.',
      ],
    },
  },
  {
    version: '5.14.0',
    schemaVersion: '2.8.0',
    date: '2026-11-12',
    title: {
      fr: 'Réinitialisation du mot de passe par code à 6 chiffres & correctifs Desktop / Licence',
      en: '6-digit code password reset & Desktop / License fixes',
      nl: 'Wachtwoordherstel via 6-cijferige code & Desktop / Licentie-correcties',
    },
    highlights: {
      fr: [
        'Fonction Edge dédiée APP_TOT-Stock_password-reset avec code à usage unique à 6 chiffres (valable 15 min, anti-bruteforce, révocation des sessions actives et journal d’audit immuable).',
        'Envoi d’un code de réinitialisation par e-mail depuis l’écran Utilisateurs & Rôles (rôles 0/1 ou perm_manage_users).',
        'Pont IPC presse-papiers Desktop (clipboard-sanitized-write) et utilitaire unifié copyToClipboard avec repli automatique.',
        'Validation stricte de la saisie de clé de licence et préservation des quotas signés en cas d’indisponibilité réseau du serveur de synchronisation.',
      ],
      en: [
        'Dedicated APP_TOT-Stock_password-reset Edge Function with 6-digit one-time code (15-min validity, anti-bruteforce, active session revocation, and immutable audit trail).',
        'Admin-initiated password reset code email from Users & Roles (roles 0/1 or perm_manage_users).',
        'Desktop clipboard IPC bridge (clipboard-sanitized-write) and unified copyToClipboard helper with automatic fallback.',
        'Strict license key input validation and preservation of signed license quotas when synchronization is temporarily unreachable.',
      ],
      nl: [
        'Speciale APP_TOT-Stock_password-reset Edge-functie met 6-cijferige eenmalige code (15 min geldig, anti-bruteforce, intrekken van actieve sessies en onveranderlijk auditlogboek).',
        'Verzenden van een herstelcode per e-mail door beheerders vanuit Gebruikers & Rollen (rollen 0/1 of perm_manage_users).',
        'Desktop klembord IPC-brug (clipboard-sanitized-write) en uniforme copyToClipboard-hulpfunctie met automatische terugval.',
        'Strikte validatie van licentiesleutelinvoer en behoud van ondertekende licentiequota bij tijdelijke onbereikbaarheid van de synchronisatieserver.',
      ],
    },
  },
  {
    version: '5.13.0',
    schemaVersion: '2.7.0',
    date: '2026-11-11',
    title: {
      fr: 'Listes déroulantes avec recherche instantanée (SearchableSelect) & correctifs v54b',
      en: 'Searchable Dropdowns (SearchableSelect) & v54b Fixes',
      nl: 'Keuzelijsten met directe zoekfunctie (SearchableSelect) & v54b-correcties',
    },
    highlights: {
      fr: [
        'Composant unique SearchableSelect remplaçant toutes les listes déroulantes de l’application (Desktop & Mobile) avec filtrage instantané insensible à la casse et aux accents, multi-mots, navigation clavier (↑/↓, Entrée, Échap) et mémorisation des 3 derniers dépôts.',
        'Correction de l’affichage de la licence dans « À propos » via getSavedLicense() et enforceSignedLicenseQuotasSync() (suppression de tot_stock_license_status_v1).',
        'Message explicite « Script SQL non à jour — exécutez install_v54.sql » lorsque search_login_logs est absent du cache de schéma.',
        'Normalisation systématique String(depot.id) entre stk_depots.id (bigint) et stk_depot_holders / stk_transfers.',
      ],
      en: [
        'Unified SearchableSelect component replacing all dropdowns across Desktop & Mobile with instant case- and accent-insensitive multi-word filtering, keyboard navigation (↑/↓, Enter, Escape), and 3-recent-depots memory.',
        'Fixed license display in the "About" panel using getSavedLicense() and enforceSignedLicenseQuotasSync() (removed tot_stock_license_status_v1).',
        'Clear message "SQL script outdated — run install_v54.sql" when search_login_logs is missing from schema cache.',
        'Consistent String(depot.id) normalization between stk_depots.id (bigint) and stk_depot_holders / stk_transfers.',
      ],
      nl: [
        'Uniform SearchableSelect-component dat alle keuzelijsten op Desktop & Mobiel vervangt met directe hoofdletter- en accentongevoelige zoekfunctie, toetsenbordnavigatie en onthouden van de 3 laatst gebruikte depots.',
        'Correcte weergave van de licentie in "Over" via getSavedLicense() en enforceSignedLicenseQuotasSync() (tot_stock_license_status_v1 verwijderd).',
        'Duidelijke melding "SQL-script verouderd — voer install_v54.sql uit" wanneer search_login_logs ontbreekt in de schemacache.',
        'Consistente String(depot.id)-normalisatie tussen stk_depots.id (bigint) en stk_depot_holders / stk_transfers.',
      ],
    },
  },
  {
    version: '5.12.0',
    schemaVersion: '2.7.0',
    date: '2026-11-10',
    title: {
      fr: 'Transferts validés à la réception, responsables de dépôt & droits fins',
      en: 'Validated Stock Transfers on Receipt, Depot Holders & Granular Permissions',
      nl: 'Gevalideerde overdrachten bij ontvangst, depotverantwoordelijken & fijne rechten',
    },
    highlights: {
      fr: [
        'Responsables multiples par dépôt (stk_depot_holders : envoi can_send et réception can_receive séparés) configurables dans la fiche dépôt.',
        'Workflow de transfert en 2 étapes avec séparation des tâches : send_stock_transfer (IN_TRANSIT), receive_stock_transfer ligne par ligne (RECEIVED, PARTIALLY_RECEIVED, REJECTED, AWAITING_SENDER), confirmation/contestation expéditeur et arbitrage des litiges (DISPUTED).',
        'Suivi « En transit : N » sur la fiche article, alerte visuelle > 48 h (list_overdue_transfers) et badge temps réel.',
        '3 nouvelles permissions fines (perm_stock_transfer_store, perm_stock_receive_all, perm_report_stock_levels) et RPC get_stock_levels_report.',
      ],
      en: [
        'Multiple holders per depot (stk_depot_holders: separate can_send and can_receive rights) configurable in the depot form.',
        'Two-step transfer workflow with segregation of duties: send_stock_transfer (IN_TRANSIT), line-by-line receive_stock_transfer (RECEIVED, PARTIALLY_RECEIVED, REJECTED, AWAITING_SENDER), sender confirmation/dispute, and dispute resolution (DISPUTED).',
        '"In transit: N" indicator on product details, > 48h overdue highlight (list_overdue_transfers), and real-time badge.',
        '3 new granular permissions (perm_stock_transfer_store, perm_stock_receive_all, perm_report_stock_levels) and get_stock_levels_report RPC.',
      ],
      nl: [
        'Meerdere verantwoordelijken per depot (stk_depot_holders: gescheiden verzend- en ontvangstrechten) instelbaar in het depotformulier.',
        'Overdrachtsworkflow in 2 stappen met functiescheiding: send_stock_transfer (IN_TRANSIT), regel-voor-regel receive_stock_transfer (RECEIVED, PARTIALLY_RECEIVED, REJECTED, AWAITING_SENDER), bevestiging/betwisting door verzender en geschillenbeslechting (DISPUTED).',
        '"In transit: N"-indicator op de productfiche, > 48u vertragingsmarkering (list_overdue_transfers) en realtime badge.',
        '3 nieuwe fijne machtigingen (perm_stock_transfer_store, perm_stock_receive_all, perm_report_stock_levels) en get_stock_levels_report RPC.',
      ],
    },
  },
  {
    version: '5.11.0',
    schemaVersion: '2.6.0',
    date: '2026-11-09',
    title: {
      fr: 'Journal d’audit serveur complet, immuabilité & suivi des connexions',
      en: 'Complete Server Audit Trail, Immutability & Login Monitoring',
      nl: 'Volledig Serverauditlogboek, Onveranderlijkheid & Aanmeldingsbewaking',
    },
    highlights: {
      fr: [
        'Triggers PostgreSQL automatiques sur 13 tables sensibles (diff ancienne -> nouvelle valeur dans meta.changes et masquage systématique des secrets en ***).',
        'Immuabilité stricte côté serveur (UPDATE et DELETE directs bloqués sur core_audit_logs et core_login_logs ; purge >= 90 jours réservée au Super Administrateur rôle 0).',
        'Suivi complet des connexions (LOGIN_SUCCESS, LOGOUT, SESSION_RESTORED limité à 1/h par appareil, LOGIN_FAILED sans secret) et alerte sur échecs répétés (>= 5).',
        'Nouvel écran « Journal d’audit » (Desktop + Mobile) avec filtres, panneau de différences avant/après, export CSV journalisé et double confirmation de purge.',
      ],
      en: [
        'Automatic PostgreSQL triggers on 13 sensitive tables (old -> new value diff in meta.changes and automatic secret masking as ***).',
        'Strict server-side immutability (direct UPDATE and DELETE blocked on core_audit_logs and core_login_logs; >= 90-day purge restricted to Super Admin role 0).',
        'Comprehensive login tracking (LOGIN_SUCCESS, LOGOUT, SESSION_RESTORED throttled to 1/hr per device, secret-free LOGIN_FAILED) and repeated failure alerts (>= 5).',
        'New "Audit Log" screen (Desktop + Mobile) with filters, before/after diff panel, audited CSV export, and double-confirmation purge.',
      ],
      nl: [
        'Automatische PostgreSQL-triggers op 13 gevoelige tabellen (oud -> nieuw verschil in meta.changes en automatische geheimmaskering als ***).',
        'Strikte server-side onveranderlijkheid (directe UPDATE en DELETE geblokkeerd op core_audit_logs en core_login_logs; >= 90 dagen wissen alleen voor Super Admin rol 0).',
        'Volledige aanmeldingsregistratie (LOGIN_SUCCESS, LOGOUT, SESSION_RESTORED max 1/uur per apparaat, LOGIN_FAILED zonder geheim) en melding bij herhaalde fouten (>= 5).',
        'Nieuw scherm "Auditlogboek" (Desktop + Mobiel) met filters, voor/na-verschilpaneel, gelogde CSV-export en dubbele bevestiging voor wissen.',
      ],
    },
  },
  {
    version: '5.10.0',
    schemaVersion: '2.5.0',
    date: '2026-11-08',
    title: {
      fr: 'Rapports Desktop (CSV / PDF / E-mail) & Recherche serveur Commandes / Mouvements',
      en: 'Desktop Reports (CSV / PDF / Email) & Server Search for Orders / Movements',
      nl: 'Desktop Rapporten (CSV / PDF / E-mail) & Serverzoekopdracht Bestellingen / Bewegingen',
    },
    highlights: {
      fr: [
        'Fenêtre locale par défaut de 7 jours (+ commandes actives) et recherche serveur paginée sur toute la base (search_material_orders & search_stock_movements).',
        'Nouvelle page Desktop « Rapports » avec générateurs partagés, Rapport Commandes et Rapport Mouvements.',
        'Exports CSV (UTF-8 avec BOM, séparateur ;) et PDF client (jsPDF + autoTable) avec en-tête société, filtres et totaux.',
        'Envoi de rapports par e-mail avec pièces jointes CSV/PDF en base64 (application rpt, validation serveur stricte et limite 3 Mo).',
      ],
      en: [
        'Default 7-day local window (+ active orders) and paginated full-database server search (search_material_orders & search_stock_movements).',
        'New Desktop "Reports" page with shared generators, Orders Report, and Movements Report.',
        'CSV (UTF-8 with BOM, ; separator) and client-side PDF (jsPDF + autoTable) exports with company header, filters, and totals.',
        'Email report dispatch with base64 CSV/PDF attachments (app rpt, strict server validation, and 3 MB limit).',
      ],
      nl: [
        'Standaard lokaal venster van 7 dagen (+ actieve bestellingen) en gepagineerde serverzoekopdracht (search_material_orders & search_stock_movements).',
        'Nieuwe Desktop-pagina "Rapporten" met gedeelde generatoren, Bestellingenrapport en Bewegingenrapport.',
        'CSV- (UTF-8 met BOM, ;-scheidingsteken) en client-side PDF-exports (jsPDF + autoTable) met bedrijfsnaam, filters en totalen.',
        'Rapportverzending per e-mail met base64 CSV/PDF-bijlagen (app rpt, strikte servervalidatie en 3 MB limiet).',
      ],
    },
  },
  {
    version: '5.9.1',
    schemaVersion: '2.4.1',
    date: '2026-11-07',
    title: {
      fr: 'Fournisseur Microsoft 365 (Graph OAuth2), mailing multi-fournisseurs & À propos complet',
      en: 'Microsoft 365 (Graph OAuth2) provider, multi-provider mailing & complete About page',
      nl: 'Microsoft 365 (Graph OAuth2) provider, multi-provider e-mail & volledige Over-pagina',
    },
    highlights: {
      fr: [
        'Nouveau fournisseur « Microsoft 365 (Graph) — recommandé pour Outlook » (OAuth2 client_credentials, Mail.Send, alerte d’expiration du secret 30 j avant).',
        'Comptes d’envoi multi-fournisseurs (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph et SMTP) et expéditeur dédié par application (stk, hab, rpt, tools).',
        'Journal des envois (core_mail_log) fiabilisé (sender_email, user_id, limite 30/h), Vault obligatoire sans table en clair et erreurs Edge détaillées avec code HTTP.',
        'Page « À propos » complète (versions app/schéma attendu/réel, licence, fonctions Edge, chiffrement local, diagnostic copiable sans secret).',
      ],
      en: [
        'New "Microsoft 365 (Graph) — recommended for Outlook" provider (OAuth2 client_credentials, Mail.Send, 30-day secret expiration warning).',
        'Multi-provider mail accounts (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph, and SMTP) and per-app sender (stk, hab, rpt, tools).',
        'Reliable mail dispatch log (core_mail_log: sender_email, user_id, 30/hr rate limit), mandatory Vault encryption, and detailed Edge errors with HTTP status.',
        'Complete "About" page (app/expected/actual schema versions, license, Edge functions, local encryption, secret-free diagnostic copy).',
      ],
      nl: [
        'Nieuwe provider "Microsoft 365 (Graph) — aanbevolen voor Outlook" (OAuth2 client_credentials, Mail.Send, waarschuwing 30 dagen vóór vervaldatum geheim).',
        'Multi-provider verzendaccounts (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph en SMTP) en afzender per applicatie (stk, hab, rpt, tools).',
        'Betrouwbaar verzendlogboek (core_mail_log: sender_email, user_id, 30/uur limiet), verplichte Vault-versleuteling en gedetailleerde Edge-foutmeldingen met HTTP-code.',
        'Volledige pagina "Over" (app-/verwachte/werkelijke schemaversies, licentie, Edge-functies, lokale versleuteling, diagnostiek zonder geheimen).',
      ],
    },
  },
  {
    version: '5.8.0',
    schemaVersion: '2.3.0',
    date: '2026-11-06',
    title: {
      fr: 'Transfert de matériel entre dépôts par lot (multi-articles)',
      en: 'Multi-item batch stock transfer between depots',
      nl: 'Batch-materiaaloverdracht tussen depots (meerdere artikelen)',
    },
    highlights: {
      fr: [
        'RPC transactionnelle tout-ou-rien transfer_stock_batch (1 à 200 lignes, idempotente sur batch_id).',
        'Fenêtre de transfert multi-articles avec échange rapide ⇄, scan code-barres et import depuis le panier.',
        'File d’attente hors-ligne RPC_STOCK_TRANSFER_BATCH et regroupement visuel des lots dans les mouvements.',
      ],
      en: [
        'All-or-nothing transactional RPC transfer_stock_batch (1 to 200 lines, idempotent on batch_id).',
        'Multi-item transfer modal with quick depot swap ⇄, barcode scan, and cart import.',
        'Offline queue RPC_STOCK_TRANSFER_BATCH and visual batch grouping in movement history.',
      ],
      nl: [
        'Transactionele alles-of-niets RPC transfer_stock_batch (1 tot 200 regels, idempotent op batch_id).',
        'Overdrachtsvenster voor meerdere artikelen met snelle depotwissel ⇄, barcodescan en winkelwagenimport.',
        'Offline wachtrij RPC_STOCK_TRANSFER_BATCH en visuele groepering van batches in bewegingen.',
      ],
    },
  },
  {
    version: '5.7.0',
    schemaVersion: '2.2.0',
    date: '2026-11-06',
    title: {
      fr: 'Préférences utilisateur en base & sécurité des données locales',
      en: 'Database user preferences & local data security',
      nl: 'Gebruikersvoorkeuren in database & lokale gegevensbeveiliging',
    },
    highlights: {
      fr: [
        'Synchronisation des préférences d’interface entre appareils via core_user_preferences.',
        'Chiffrement local AES-GCM 256 (WebCrypto PBKDF2 / coffre natif) des données hors-ligne sensibles.',
        'Rejet strict des clés secrètes service_role côté navigateur et durcissement CSP.',
      ],
      en: [
        'Cross-device UI preferences synchronization via core_user_preferences.',
        'AES-GCM 256 local encryption (WebCrypto PBKDF2 / native vault) for sensitive offline data.',
        'Strict browser-side rejection of service_role secret keys and CSP hardening.',
      ],
      nl: [
        'Synchronisatie van UI-voorkeuren tussen apparaten via core_user_preferences.',
        'Lokale AES-GCM 256-versleuteling (WebCrypto PBKDF2 / native kluis) voor gevoelige offline gegevens.',
        'Strikte weigering van service_role-geheime sleutels in de browser en CSP-versterking.',
      ],
    },
  },
] as const;
