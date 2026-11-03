import { useEffect } from 'react';
import type { Language } from './translations';

/**
 * Complete Dutch (nl) exact-match dictionary for inline English & French UI strings
 * across all components, modals, context messages, roles, departments, and permissions.
 */
export const EXACT_NL_DICTIONARY: Record<string, string> = {
  // Locale codes
  'fr-FR': 'nl-NL',
  'en-US': 'nl-NL',
  'en-GB': 'nl-NL',

  // App.tsx & Compatibility / Maintenance
  'incomplete installation, please contact your administrator':
    'onvolledige installatie, neem contact op met uw beheerder',
  'installation incomplète, contactez votre administrateur':
    'onvolledige installatie, neem contact op met uw beheerder',
  'Maintenance mode active (access granted for admin role 0/1).':
    'Onderhoudsmodus actief (toegang verleend voor beheerdersrol 0/1).',
  'Mode maintenance actif (accès autorisé pour votre rôle administrateur 0/1).':
    'Onderhoudsmodus actief (toegang verleend voor beheerdersrol 0/1).',
  'Close': 'Sluiten',
  'Fermer': 'Sluiten',
  'Update': 'Bijwerken',
  'Mettre à jour': 'Bijwerken',
  'Database Maintenance in Progress': 'Database-onderhoud bezig',
  'Maintenance de la base en cours': 'Database-onderhoud bezig',
  "Mettez l'application à jour": 'Werk de applicatie bij',
  'La base de données doit être mise à jour': 'De database moet worden bijgewerkt',
  'A database maintenance or SQL migration is currently in progress. Please wait a moment.':
    'Er wordt momenteel database-onderhoud of een SQL-migratie uitgevoerd. Een ogenblik geduld.',
  'Une opération de maintenance ou de migration SQL est en cours sur la base de données. Veuillez patienter quelques instants.':
    'Er wordt momenteel database-onderhoud of een SQL-migratie uitgevoerd. Een ogenblik geduld.',
  'Installed version:': 'Geïnstalleerde versie (APP_VERSION):',
  'Version installée (APP_VERSION) :': 'Geïnstalleerde versie (APP_VERSION):',
  'Minimum required:': 'Minimaal vereiste versie:',
  'Version minimale requise :': 'Minimaal vereiste versie:',
  'SQL Schema (DB / expected):': 'SQL-schema (database / verwacht):',
  'Schéma SQL (base / attendu) :': 'SQL-schema (database / verwacht):',
  'Check Again / Refresh': 'Opnieuw controleren / Vernieuwen',
  'Vérifier à nouveau / Actualiser': 'Opnieuw controleren / Vernieuwen',
  'Admin Sign In (roles 0 and 1)': 'Beheerderslogin (rollen 0 en 1)',
  'Connexion Administrateur (rôles 0 et 1)': 'Beheerderslogin (rollen 0 en 1)',
  'Admin: Configure Supabase Database': 'Beheer: Supabase-database configureren',
  'Administration : Configurer la base Supabase': 'Beheer: Supabase-database configureren',

  // ActionSheet & Quick Actions
  'Order Fulfillment': 'Orderpick & Voorbereiding',
  'Préparation des Commandes': 'Orderpick & Voorbereiding',
  'pending': 'in behandeling',
  'en attente': 'in behandeling',
  'Pick, pack & ready orders': 'Toewijzen, bakken vullen & klaarmaken',
  'Assignation, pointage bac & mise en prête': 'Toewijzen, bakken vullen & klaarmaken',
  'Open': 'Openen',
  'Ouvrir': 'Openen',
  'My Orders & Cart': 'Mijn Mandje & Bestellingen',
  'Mon Panier & Suivi Commandes': 'Mijn Mandje & Bestellingen',
  'Ready for pickup!': 'Klaar om af te halen!',
  'Prête au retrait !': 'Klaar om af te halen!',
  'items': 'art.',
  'art.': 'art.',
  'Order ready for QR pickup': 'Bestelling klaar voor QR-afhaling',
  'Commande prête à retirer avec QR code': 'Bestelling klaar voor QR-afhaling',
  'Request materials & track status': 'Materiaal bestellen & status volgen',
  'Commander du matériel & suivre mes demandes': 'Materiaal bestellen & status volgen',
  'Go': 'Openen',
  'Accéder': 'Openen',
  'Vehicle Stock Entry': 'Voorraadinname Bestelwagen',
  'Entrée Stock Camionnette': 'Voorraadinname Bestelwagen',

  // AppInfoModal
  'DB Compatibility (app_compat)': 'Databasecompatibiliteit (app_compat)',
  'Compatibilité Base (app_compat)': 'Databasecompatibiliteit (app_compat)',
  'Check public.app_compat': 'Controleer public.app_compat',
  'Vérifier public.app_compat': 'Controleer public.app_compat',
  'Status:': 'Status:',
  'Statut :': 'Status:',
  'Incomplete installation': 'Onvolledige installatie',
  'Installation incomplète': 'Onvolledige installatie',
  'Compatible': 'Compatibel',
  'Maintenance active': 'Onderhoud actief',
  'Update required': 'Update vereist',
  'Mise à jour requise': 'Update vereist',
  'APP_VERSION / Expected Schema:': 'APP_VERSION / Verwacht schema:',
  'APP_VERSION / Schéma attendu :': 'APP_VERSION / Verwacht schema:',
  'DB values (schema / min_app):': 'Databasewaarden (schema / min_app):',
  'Valeurs en base (schema / min_app) :': 'Databasewaarden (schema / min_app):',
  'Table missing': 'Tabel ontbreekt',
  'Table absente': 'Tabel ontbreekt',
  'Install TOT icon on Home Screen': 'TOT-icoon op startscherm installeren',
  "Installer l'icône TOT sur l'écran d'accueil": 'TOT-icoon op startscherm installeren',
  'Install on Home Screen (iOS / Web)': 'Op startscherm zetten (iOS / Web)',
  "Installer sur l'écran d'accueil (iOS / Web)": 'Op startscherm zetten (iOS / Web)',

  // BatchCartModal
  'Please select a destination job-site or project.':
    'Selecteer een bestemmingswerf of project.',
  'Veuillez sélectionner un chantier ou projet de destination.':
    'Selecteer een bestemmingswerf of project.',
  'Withdrawal not allowed.': 'Uitgifte niet toegestaan op dit magazijn.',
  'Sortie interdite sur ce dépôt.': 'Uitgifte niet toegestaan op dit magazijn.',
  'Stock entry not allowed.': 'Voorraadinname niet toegestaan op dit magazijn.',
  'Entrée interdite sur ce dépôt.': 'Voorraadinname niet toegestaan op dit magazijn.',
  'An error occurred while confirming cart.':
    'Er is een fout opgetreden bij het bevestigen van het mandje.',
  'Une erreur est survenue lors de la validation du panier.':
    'Er is een fout opgetreden bij het bevestigen van het mandje.',
  'Items hidden (↓)': 'Artikelen verborgen (↓)',
  'Articles masqués (↓)': 'Artikelen verborgen (↓)',
  'Items visible (↑)': 'Artikelen zichtbaar (↑)',
  'Articles affichés (↑)': 'Artikelen zichtbaar (↑)',
  'Expand / Show items (↑)': 'Uitklappen / Artikelen tonen (↑)',
  'Agrandir / Afficher la liste des articles (↑)': 'Uitklappen / Artikelen tonen (↑)',
  'Expand': 'Uitklappen',
  'Agrandir': 'Uitklappen',
  'Reduce / Hide items (↓)': 'Inklappen / Artikelen verbergen (↓)',
  'Diminuer / Masquer la liste des articles (↓)': 'Inklappen / Artikelen verbergen (↓)',
  'Reduce': 'Inklappen',
  'Diminuer': 'Inklappen',
  'No project recorded': 'Geen project geregistreerd',
  'Aucun projet enregistré': 'Geen project geregistreerd',
  'Items hidden (↓). Click Expand (↑) to view and edit items.':
    'Artikelen verborgen (↓). Klik op Uitklappen (↑) om aantallen te wijzigen.',
  'Articles masqués (↓). Cliquez sur Agrandir (↑) pour modifier les quantités.':
    'Artikelen verborgen (↓). Klik op Uitklappen (↑) om aantallen te wijzigen.',
  'Expand (↑)': 'Uitklappen (↑)',
  'Agrandir (↑)': 'Uitklappen (↑)',
  'Ref': 'Ref.',
  'Réf': 'Ref.',
  'Available stock': 'Beschikbare voorraad',
  'Stock disponible': 'Beschikbare voorraad',
  'Main Depot': 'Hoofdmagazijn',
  'Dépôt Principal': 'Hoofdmagazijn',
  'Dépôt Général': 'Hoofdmagazijn',
  'Quantity removed:': 'Uitgenomen aantal:',
  'Quantité retirée :': 'Uitgenomen aantal:',
  'Quantity added:': 'Toegevoegd aantal:',
  'Quantité ajoutée :': 'Toegevoegd aantal:',

  // CategoriesModal
  'Editing category': 'Categorie bewerken',
  'Modification de la catégorie': 'Categorie bewerken',
  'Cancel': 'Annuleren',
  'Annuler': 'Annuleren',
  'New category name...': 'Nieuwe categorienaam...',
  'Nouveau nom de la catégorie...': 'Nieuwe categorienaam...',
  'Save': 'Opslaan',
  'Enregistrer': 'Opslaan',
  'Edit category': 'Categorie bewerken',
  'Éditer / Modifier la catégorie': 'Categorie bewerken',

  // DashboardView
  'No Department': 'Geen afdeling',
  'Sans Département': 'Geen afdeling',
  'Hello': 'Hallo',
  'Bonjour': 'Hallo',
  'User': 'Gebruiker',
  'Utilisateur': 'Gebruiker',
  'Operator': 'Operator',
  'Opérateur': 'Operator',
  'KPI Analysis Scope': 'Analysebereik van KPI’s',
  "Périmètre d'Analyse des KPI": 'Analysebereik van KPI’s',
  'Server RPC (can_view_movement)': 'Server-RPC (can_view_movement)',
  'Fonction Serveur RPC (can_view_movement)': 'Server-RPC (can_view_movement)',
  'can_view_movement Scope': 'Bereik can_view_movement',
  'Périmètre can_view_movement': 'Bereik can_view_movement',
  'Logistics & Management Access': 'Toegang Logistiek & Directie',
  'Accès Logistique & Direction': 'Toegang Logistiek & Directie',
  'Staff (Individual View)': 'Medewerker (Individuele weergave)',
  'Collaborateur (Vue Individuelle)': 'Medewerker (Individuele weergave)',
  'Open departments management': 'Afdelingsbeheer openen',
  'Ouvrir la gestion des départements': 'Afdelingsbeheer openen',
  'All Company': 'Volledig bedrijf',
  'Tous les flux': 'Alle stromen',
  'My Dept': 'Mijn Afd.',
  'Mon Dép.': 'Mijn Afd.',
  'Other Dept': 'Andere Afd.',
  'Autre Dép.': 'Andere Afd.',
  'My KPIs': 'Mijn KPI’s',
  'Mes KPI': 'Mijn KPI’s',
  'My Individual KPIs': 'Mijn Individuele KPI’s',
  'Mes KPI Individuels': 'Mijn Individuele KPI’s',
  'Individual KPI Mode': 'Individuele KPI-modus',
  'Mode KPI Individuel': 'Individuele KPI-modus',
  'Displaying your personal entries, exits and stock operations.':
    'Weergave van uw persoonlijke innames, uitgiftes en voorraadverrichtingen.',
  'Affichage de vos entrées, sorties et manipulations personnelles.':
    'Weergave van uw persoonlijke innames, uitgiftes en voorraadverrichtingen.',
  'Choose department:': 'Kies afdeling:',
  'Choisir le département :': 'Kies afdeling:',
  'Manage departments': 'Afdelingen beheren',
  'Gérer les départements': 'Afdelingen beheren',
  'Depot Filter (Active Option)': 'Magazijnfilter (Actieve optie)',
  'Filtre des Dépôts (Option Active)': 'Magazijnfilter (Actieve optie)',
  '🏢 All depots combined': '🏢 Alle magazijnen samen',
  '🏢 Tous les dépôts réunis': '🏢 Alle magazijnen samen',
  '🏢 All Depots': '🏢 Alle magazijnen',
  '🏢 Tous les dépôts': '🏢 Alle magazijnen',
  'All': 'Alles',
  'Toutes': 'Alles',
  'Tous': 'Alles',
  'Your Material Exits (Value HT)': 'Uw Materiaaluitgiftes (Waarde excl. btw)',
  'Vos Sorties Matériel (Valeur HT)': 'Uw Materiaaluitgiftes (Waarde excl. btw)',
  'Today': 'Vandaag',
  "Aujourd'hui": 'Vandaag',
  'Items handled': 'Verwerkte ref.',
  'Réf. manipulées': 'Verwerkte ref.',
  'Units handled': 'Verwerkte eenheden',
  'Unités manipulées': 'Verwerkte eenheden',
  'Units moved': 'Verplaatste eenheden',
  'Unités mouvementées': 'Verplaatste eenheden',
  'Your Exits': 'Uw Uitgiftes',
  'Vos Sorties': 'Uw Uitgiftes',
  'Team Exits': 'Teamuitgiftes',
  'Sorties Équipe': 'Teamuitgiftes',
  'Your Entries': 'Uw Innames',
  'Vos Entrées': 'Uw Innames',
  'Team Entries': 'Teaminnames',
  'Entrées Équipe': 'Teaminnames',
  'Most Active Departments': 'Meest actieve afdelingen',
  'Départements les plus actifs': 'Meest actieve afdelingen',
  'Orders': 'Bestellingen',
  'Commandes': 'Bestellingen',
  'Exits': 'Uitgiftes',
  'Sorties': 'Uitgiftes',
  'Entries': 'Innames',
  'Entrées': 'Innames',
  'No activity recorded yet': 'Nog geen activiteit geregistreerd',
  'Aucune activité enregistrée': 'Nog geen activiteit geregistreerd',
  'Warehouse Prep SLA & Cycle Times': 'Magazijn-SLA & Voorbereidingstijden',
  'SLA Magasin & Délais de Préparation': 'Magazijn-SLA & Voorbereidingstijden',
  'Audit & SLA': 'Logistieke Audit & SLA',
  'Audit Logistique': 'Logistieke Audit & SLA',
  'Intake time': 'Opnametijd',
  'Prise en charge': 'Opnametijd',
  'Order claim': 'Reactietijd magazijn',
  'Réactivité magasin': 'Reactietijd magazijn',
  'Picking time': 'Picktijd & Bak',
  'Picking & Bac': 'Picktijd & Bak',
  'Bin prep': 'Zuivere voorbereiding',
  'Préparation pure': 'Zuivere voorbereiding',
  'Ready cycle': 'Klaarzetcyclus',
  'Mise à dispo.': 'Klaarzetcyclus',
  'Total wait': 'Totale wachttijd aanvrager',
  'Délai total demandeur': 'Totale wachttijd aanvrager',
  'SLA Rate (< 1h)': 'SLA-percentage (< 1u)',
  'Taux SLA (< 1h)': 'SLA-percentage (< 1u)',
  'On-time delivery': 'Bestellingen op tijd',
  "Commandes à l'heure": 'Bestellingen op tijd',
  'audited': 'gecontroleerde bestellingen',
  'commandes auditées': 'gecontroleerde bestellingen',
  'Your individual activity': 'Uw individuele activiteiten',
  'Vos activités individuelles': 'Uw individuele activiteiten',

  // DepartmentsProjectsModal
  'Manage departments, sites, managers & deputies (+)':
    'Beheer van afdelingen, werven, verantwoordelijken & plaatsvervangers (+)',
  'Gestion des départements, chantiers, responsables & suppléants (+)':
    'Beheer van afdelingen, werven, verantwoordelijken & plaatsvervangers (+)',
  'Department Deputy Manager(s)': 'Plaatsvervangend(e) Afdelingsverantwoordelijke(n)',
  'Suppléant(s) Responsable de Département': 'Plaatsvervangend(e) Afdelingsverantwoordelijke(n)',
  'assigned': 'toegewezen',
  'assigné(s)': 'toegewezen',
  '-- Choose a deputy to add --': '-- Kies een plaatsvervanger om toe te voegen --',
  '-- Choisir un suppléant à ajouter --': '-- Kies een plaatsvervanger om toe te voegen --',
  'Add': 'Toevoegen',
  'Ajouter': 'Toevoegen',
  'Full Company KPIs & Multi-Depot Scope':
    'Volledige toegang tot bedrijfs-KPI’s & multi-magazijnfilters',
  'Accès complet aux KPIs de toute la société & filtres multi-dépôts':
    'Volledige toegang tot bedrijfs-KPI’s & multi-magazijnfilters',
  'Preparers Option (Warehouse & Fulfillment)':
    'Optie « Orderpickers » (Magazijn & Bestellingenbeheer)',
  'Option « Préparateurs » (Magasin & Gestion des Commandes)':
    'Optie « Orderpickers » (Magazijn & Bestellingenbeheer)',
  'Require Approval for Material Orders':
    'Verplichte goedkeuring van bestellingen (Projectleider / Afdeling)',
  'Validation des commandes obligatoire (Chef de projet / Département)':
    'Verplichte goedkeuring van bestellingen (Projectleider / Afdeling)',
  'Threshold amount (€):': 'Optionele drempelwaarde (€):',
  'Seuil optionnel de déclenchement (€) :': 'Optionele drempelwaarde (€):',
  'All orders require approval (threshold = 0 €).':
    'Alle bestellingen zonder uitzondering vereisen goedkeuring (drempel = 0 €).',
  'Toutes les commandes sans exception nécessitent validation (seuil = 0 €).':
    'Alle bestellingen zonder uitzondering vereisen goedkeuring (drempel = 0 €).',
  'Clear': 'Wissen',
  'Effacer': 'Wissen',
  'Global KPIs': 'Globale KPI’s & Magazijnen',
  'KPI Global & Dépôts': 'Globale KPI’s & Magazijnen',
  'Preparers': 'Orderpickers',
  'Préparateurs': 'Orderpickers',
  'Unassigned': 'Niet toegewezen',
  'Non assigné': 'Niet toegewezen',

  // LoginModal & ProfileModal
  'If your email contains a 6-digit recovery code, you can also enter it directly below:':
    'Als uw e-mail een herstelcode (6 cijfers / token) bevat, kunt u deze ook direct hieronder invoeren:',
  'Si votre e-mail contient un code de récupération (6 chiffres / jeton), vous pouvez également le saisir directement ci-dessous :':
    'Als uw e-mail een herstelcode (6 cijfers / token) bevat, kunt u deze ook direct hieronder invoeren:',
  'Recovery Code': 'Ontvangen herstelcode',
  'Code de récupération reçu': 'Ontvangen herstelcode',
  'New Password (min. 6 chars)': 'Nieuw wachtwoord (min. 6 tekens)',
  'Nouveau mot de passe (min. 6 caractères)': 'Nieuw wachtwoord (min. 6 tekens)',
  'Confirm New Password': 'Nieuw wachtwoord bevestigen',
  'Confirmer le nouveau mot de passe': 'Nieuw wachtwoord bevestigen',
  'Password': 'Wachtwoord',
  'Mot de passe': 'Wachtwoord',
  'Forgot password?': 'Wachtwoord vergeten?',
  'Mot de passe oublié ?': 'Wachtwoord vergeten?',
  'Continue as': 'Doorgaan als',
  'Continuer en tant que': 'Doorgaan als',

  // MaterialOrdersModal & OrdersPreparationModal
  'Please select a colleague.': 'Selecteer een collega van de afdeling.',
  'Veuillez sélectionner un collègue du département.': 'Selecteer een collega van de afdeling.',
  'Cannot delete order: already collected.':
    'Kan deze bestelling niet verwijderen: ze is al afgehaald.',
  'Impossible de supprimer cette commande : elle a déjà été retirée.':
    'Kan deze bestelling niet verwijderen: ze is al afgehaald.',
  'Delete order?': 'Bestelling verwijderen?',
  'Supprimer la commande ?': 'Bestelling verwijderen?',
  'Delete': 'Verwijderen',
  'Suppression': 'Verwijderen',
  'Supprimer': 'Verwijderen',
  'Error approving order.': 'Fout bij het goedkeuren van de bestelling.',
  "Erreur lors de l'approbation de la commande.": 'Fout bij het goedkeuren van de bestelling.',
  'Error rejecting order.': 'Fout bij het weigeren van de bestelling.',
  'Erreur lors du refus de la commande.': 'Fout bij het weigeren van de bestelling.',
  'Cart is empty.': 'Het bestelmandje is leeg.',
  'Le panier de commande est vide.': 'Het bestelmandje is leeg.',
  'Please select or enter a site code.': 'Selecteer of voer een werfcode in.',
  'Veuillez sélectionner ou renseigner un code chantier.': 'Selecteer of voer een werfcode in.',
  'Active basket': 'Actief mandje',
  'Panier en cours': 'Actief mandje',
  'Transmit order to warehouse?': 'Bestelling doorsturen naar het magazijn?',
  'Transmettre la commande au magasin ?': 'Bestelling doorsturen naar het magazijn?',
  'Confirm & Transmit': 'Bevestigen & Doorsturen',
  'Confirmer la transmission': 'Bevestigen & Doorsturen',
  'An error occurred while submitting order.':
    'Er is een fout opgetreden bij het doorsturen van de bestelling.',
  'Une erreur est survenue lors de la transmission de la commande.':
    'Er is een fout opgetreden bij het doorsturen van de bestelling.',
  'This basket is empty.': 'Dit mandje is leeg. Voeg artikelen toe voordat u het doorstuurt.',
  'Ce panier est vide. Ajoutez des articles avant de le transmettre.':
    'Dit mandje is leeg. Voeg artikelen toe voordat u het doorstuurt.',
  'Error while transmitting order.': 'Fout bij het doorsturen van de bestelling.',
  'Erreur lors de la transmission.': 'Fout bij het doorsturen van de bestelling.',
  'Camera access unavailable. Please enter code manually.':
    'Cameratoegang niet beschikbaar. Geef toestemming voor de camera of voer de code hieronder in.',
  "Impossible d'accéder à la caméra. Veuillez autoriser la caméra ou saisir le code ci-dessous.":
    'Cameratoegang niet beschikbaar. Geef toestemming voor de camera of voer de code hieronder in.',
  'Depot change needed': 'Magazijnwissel vereist',
  'Changement de dépôt nécessaire': 'Magazijnwissel vereist',
  'Switch & Add': 'Wisselen & Toevoegen',
  'Basculer & Ajouter': 'Wisselen & Toevoegen',
  'Order must contain at least 1 item.': 'De bestelling moet minstens 1 artikel bevatten.',
  'La commande doit comporter au moins 1 article.': 'De bestelling moet minstens 1 artikel bevatten.',
  'Error finalizing pickup.': 'Fout bij het afronden van de afhaling.',
  'Erreur lors du retrait de la commande.': 'Fout bij het afronden van de afhaling.',
  'Material Cart & Site Orders': 'Materiaalpedaal & Werfbestellingen',
  'Panier & Commandes Matériel': 'Materiaalpedaal & Werfbestellingen',
  'Ready!': 'Klaar!',
  'Prête(s) !': 'Klaar!',
  'Site Drive: request items, warehouse prepares and notifies you':
    'Werf-Drive: bestel uw artikelen, het magazijn zet ze klaar en verwittigt u',
  'Drive Chantier : commandez vos articles, le magasin prépare et vous alerte':
    'Werf-Drive: bestel uw artikelen, het magazijn zet ze klaar en verwittigt u',
  'My Order Basket': 'Mijn Bestelmandje',
  'Mon Panier de Demande': 'Mijn Bestelmandje',
  'Active Orders & Tracking': 'Mijn Lopende Bestellingen',
  'Mes Commandes en Cours': 'Mijn Lopende Bestellingen',
  'My Active Baskets': 'Mijn Actieve Mandjes',
  'Mes Paniers Actifs': 'Mijn Actieve Mandjes',
  'Switch, expand (↑) or reduce (↓) your active carts.':
    'Schakel tussen, klap uit (↑) of klap in (↓) uw gelijktijdige mandjes.',
  'Basculez, agrandissez (↑) ou réduisez (↓) vos différents paniers simultanés.':
    'Schakel tussen, klap uit (↑) of klap in (↓) uw gelijktijdige mandjes.',
  'Expand all carts (↑)': 'Alle mandjes uitklappen (↑)',
  'Agrandir tous les paniers (↑)': 'Alle mandjes uitklappen (↑)',
  'Reduce / Compact (↓)': 'Inklappen / Compacte weergave (↓)',
  'Diminuer / Vue compacte (↓)': 'Inklappen / Compacte weergave (↓)',
  'New basket': 'Nieuw mandje',
  'Nouveau panier': 'Nieuw mandje',
  'No active untransmitted basket. Click "+ New basket" or add an item from the catalog.':
    'Geen actief onverzonden mandje. Klik op « + Nieuw mandje » of voeg een artikel toe vanuit de catalogus.',
  'Aucun panier ou commande non transmise en cours. Cliquez sur « + Nouveau panier » ou ajoutez un article depuis le catalogue.':
    'Geen actief onverzonden mandje. Klik op « + Nieuw mandje » of voeg een artikel toe vanuit de catalogus.',
  'Move basket up (↑)': 'Mandje omhoog verplaatsen (↑)',
  'Déplacer ce panier vers le haut (↑)': 'Mandje omhoog verplaatsen (↑)',
  'Move basket down (↓)': 'Mandje omlaag verplaatsen (↓)',
  'Déplacer ce panier vers le bas (↓)': 'Mandje omlaag verplaatsen (↓)',
  'Site:': 'Werf:',
  'Chantier :': 'Werf:',
  'Assign site:': 'Werf toewijzen:',
  'Affecter chantier :': 'Werf toewijzen:',
  'Empty basket': 'Mandje momenteel leeg',
  'Panier vide pour le moment': 'Mandje momenteel leeg',
  'Select basket': 'Dit mandje gebruiken',
  'Utiliser ce panier': 'Dit mandje gebruiken',
  'Transmit order to warehouse': 'Mandje valideren en doorsturen naar magazijn',
  'Valider et transmettre ce panier au magasin': 'Mandje valideren en doorsturen naar magazijn',
  'Transmit': 'Doorsturen naar magazijn',
  'Transmettre au magasin': 'Doorsturen naar magazijn',
  'Clear basket?': 'Dit mandje legen?',
  'Vider ce panier ?': 'Dit mandje legen?',
  'Clear basket': 'Artikelen uit dit mandje wissen',
  'Vider les articles de ce panier': 'Artikelen uit dit mandje wissen',
  'Duplicate': 'Dupliceren',
  'Dupliquer': 'Dupliceren',
  'Delete basket?': 'Dit mandje verwijderen?',
  'Supprimer ce panier ?': 'Dit mandje verwijderen?',
  'Site: None': 'Werf: Te bepalen',
  'Chantier : À définir': 'Werf: Te bepalen',
  'Assign or change site for this basket': 'Werf voor dit mandje toewijzen of wijzigen',
  'Affecter ou changer le chantier de ce panier': 'Werf voor dit mandje toewijzen of wijzigen',
  'Validate and transmit basket to warehouse': 'Mandje valideren en doorsturen naar magazijn',
  'Send': 'Doorsturen',
  'Transmettre': 'Doorsturen',
  'Delete basket': 'Mandje verwijderen',
  'Supprimer le panier': 'Mandje verwijderen',
  'Move up (↑)': 'Omhoog (↑)',
  'Monter (↑)': 'Omhoog (↑)',
  'Move down (↓)': 'Omlaag (↓)',
  'Descendre (↓)': 'Omlaag (↓)',
  'Rename basket': 'Mandje hernoemen',
  'Renommer ce panier': 'Mandje hernoemen',
  'Depot:': 'Gereserveerd magazijn:',
  'Dépôt réservé :': 'Gereserveerd magazijn:',
  'Duplicate basket': 'Mandje dupliceren',
  'Dupliquer ce panier': 'Mandje dupliceren',
  'Your cart is empty': 'Uw materiaalmandje is leeg',
  'Votre panier de matériel est vide': 'Uw materiaalmandje is leeg',
  'Browse the catalog or scan barcodes to add items needed for your job site.':
    'Blader door de catalogus of scan streepjescodes om de artikelen toe te voegen die u nodig hebt op de werf.',
  'Parcourez le catalogue ou scannez des références pour ajouter les articles dont vous avez besoin sur chantier.':
    'Blader door de catalogus of scan streepjescodes om de artikelen toe te voegen die u nodig hebt op de werf.',
  'Browse catalog': 'Materiaalcatalogus bekijken',
  'Consulter le catalogue matériel': 'Materiaalcatalogus bekijken',
  'item(s) in cart': 'artikel(en) in mandje',
  'article(s) au panier': 'artikel(en) in mandje',
  'Expand (Show)': 'Uitklappen (Tonen)',
  'Agrandir (Afficher)': 'Uitklappen (Tonen)',
  'Reduce (Hide)': 'Inklappen (Verbergen)',
  'Diminuer (Masquer)': 'Inklappen (Verbergen)',
  'Clear all items in basket': 'Alle artikelen uit dit mandje wissen',
  'Vider tous les articles de ce panier': 'Alle artikelen uit dit mandje wissen',
  'Clear cart': 'Mandje legen',
  'Vider le panier': 'Mandje legen',
  'Items hidden (↓). Click Expand (↑) to show details.':
    'Artikelen verborgen (↓). Klik op Uitklappen (↑) om details te bekijken.',
  'Articles masqués (↓) pour accéder directement au chantier et au retrait. Cliquez sur Agrandir (↑).':
    'Artikelen verborgen (↓). Klik op Uitklappen (↑) om details te bekijken.',
  'Decrease quantity (↓ / -)': 'Aantal verlagen (↓ / -)',
  'Diminuer la quantité (↓ / -)': 'Aantal verlagen (↓ / -)',
  'Increase quantity (↑ / +)': 'Aantal verhogen (↑ / +)',
  'Augmenter la quantité (↑ / +)': 'Aantal verhogen (↑ / +)',
  'Estimated total:': 'Geschat materiaalbedrag:',
  'Total estimé du matériel :': 'Geschat materiaalbedrag:',
  '+ Add an item to this order': '+ Artikel toevoegen aan deze bestelling',
  '+ Ajouter un article à la commande': '+ Artikel toevoegen aan deze bestelling',
  'Site & Pickup Depot': 'Toewijzing & Afhaallocatie',
  'Affectation & Lieu de Retrait': 'Toewijzing & Afhaallocatie',
  'Offline Order #:': 'Offlinenummer (OFF):',
  'N° Hors-Ligne (OFF) :': 'Offlinenummer (OFF):',
  'Server Unique #:': 'Uniek servernummer:',
  'N° Serveur Unique :': 'Uniek servernummer:',
  'Select from my dept': 'Kiezen uit mijn afdeling',
  'Choisir dans mon département': 'Kiezen uit mijn afdeling',
  'Manual code (+)': 'Handmatige code (+)',
  'Saisie manuelle (+)': 'Handmatige code (+)',
  'No site for your department': 'Geen werf voor uw afdeling',
  'Aucun chantier pour votre département': 'Geen werf voor uw afdeling',
  'Warehouse / Pickup Location:': 'Magazijn / Afhaallocatie:',
  'Dépôt / Magasin de retrait :': 'Magazijn / Afhaallocatie:',
  'Notes for storekeeper (optional):': 'Instructies voor de magazijnier (optioneel):',
  'Instructions pour le préparateur (optionnel) :': 'Instructies voor de magazijnier (optioneel):',
  'Ex: Urgent for afternoon crew...': 'Bijv. Dringend nodig voor de middagploeg...',
  "Ex: Besoin urgent pour l'équipe de 13h30, cage d'escalier B...":
    'Bijv. Dringend nodig voor de middagploeg...',
  'Submitting...': 'Verzenden...',
  'Envoi en cours...': 'Verzenden...',
  'Submit Order to Warehouse': 'Bestelling Doorsturen naar Magazijn',
  'Transmettre la Commande au Magasin': 'Bestelling Doorsturen naar Magazijn',
  'Warehouse Shelf Pickup': 'Afhaling aan magazijnstelling',
  'Retrait sur étagère de magasin': 'Afhaling aan magazijnstelling',
  'Scan QR code on shelf to verify and confirm pickup':
    'Scan de QR-code op de stelling om uw bestelling te bevestigen',
  "Scannez le QR code sur l'étagère pour valider votre commande":
    'Scan de QR-code op de stelling om uw bestelling te bevestigen',
  'Scan to Collect': 'Afhaling Scannen',
  'Scanner Retrait': 'Afhaling Scannen',
  'No pending orders': 'Geen bestellingen in afwachting van afhaling',
  'Aucune commande en attente de retrait': 'Geen bestellingen in afwachting van afhaling',
  'Once you confirm collection, orders automatically disappear from this active view.':
    'Zodra u de afhaling bevestigt, verdwijnt de bestelling automatisch uit deze actieve lijst.',
  "Dès que vous confirmez le retrait d'une commande, elle disparaît automatiquement de cette liste active.":
    'Zodra u de afhaling bevestigt, verdwijnt de bestelling automatisch uit deze actieve lijst.',
  'Create new order': 'Nieuwe bestelling aanmaken',
  'Créer une nouvelle commande': 'Nieuwe bestelling aanmaken',
  '← Back to orders list': '← Terug naar bestellingenlijst',
  '← Revenir à la liste des commandes': '← Terug naar bestellingenlijst',
  'Approval Required': 'Goedkeuring vereist (Afdelingshoofd / Werfleider)',
  'À Valider par Chef de Service / Chantier': 'Goedkeuring vereist (Afdelingshoofd / Werfleider)',
  'Pending pick': 'Klaar te zetten',
  'À préparer': 'Klaar te zetten',
  'READY FOR PICKUP': 'KLAAR VOOR AFHALING',
  'PRÊTE AU RETRAIT': 'KLAAR VOOR AFHALING',
  'Rejected': 'Geweigerd',
  'Refusée': 'Geweigerd',
  'Collected': 'Afgehaald',
  'Retirée': 'Afgehaald',
  'Your material is ready!': 'Uw materiaal staat klaar in het magazijn!',
  'Matériel prêt au magasin !': 'Uw materiaal staat klaar in het magazijn!',
  'Print Slip': 'Bon afdrukken',
  'Imprimer Bon': 'Bon afdrukken',
  'Scan Shelf': 'Stelling scannen',
  'Scanner Étagère': 'Stelling scannen',
  'Confirm Pickup': 'Afhaling bevestigen',
  'Valider le Retrait': 'Afhaling bevestigen',
  '← Back to list': '← Terug naar lijst',
  '← Revenir à la liste': '← Terug naar lijst',
  'Approve Order': 'Bestelling goedkeuren',
  'Valider la commande': 'Bestelling goedkeuren',
  'Reject Order': 'Bestelling weigeren',
  'Refuser la commande': 'Bestelling weigeren',
  'Approval restricted to Managers': 'Goedkeuring voorbehouden aan verantwoordelijken & plaatsvervangers',
  'Validation réservée aux Chefs & Suppléants': 'Goedkeuring voorbehouden aan verantwoordelijken & plaatsvervangers',
  'Edit': 'Bewerken',
  'Modifier': 'Bewerken',
  'Delete Order': 'Bestelling verwijderen',
  'Supprimer la commande': 'Bestelling verwijderen',
  'active order(s)': 'lopende bestelling(en)',
  'commande(s) en cours': 'lopende bestelling(en)',
  'Expand all orders (↑)': 'Alle bestellingen uitklappen (↑)',
  'Agrandir / Déplier toutes les commandes (↑)': 'Alle bestellingen uitklappen (↑)',
  'Expand all (↑)': 'Alles uitklappen (↑)',
  'Agrandir tout (↑)': 'Alles uitklappen (↑)',
  'Reduce all orders (↓)': 'Alle bestellingen inklappen (↓)',
  'Diminuer / Réduire toutes les commandes (↓)': 'Alle bestellingen inklappen (↓)',
  'Reduce all (↓)': 'Alles inklappen (↓)',
  'Diminuer tout (↓)': 'Alles inklappen (↓)',
  'Approval Req.': 'Goed te keuren',
  'À Valider': 'Goed te keuren',
  'Preparing': 'In voorbereiding',
  'En préparation': 'In voorbereiding',
  'READY': 'KLAAR',
  'PRÊTE': 'KLAAR',
  'Reduce order (↓)': 'Bestelling inklappen (↓)',
  'Diminuer la commande (↓)': 'Bestelling inklappen (↓)',
  'Expand order (↑)': 'Bestelling uitklappen (↑)',
  'Agrandir la commande (↑)': 'Bestelling uitklappen (↑)',
  'Ordered items breakdown:': 'Detail van bestelde artikelen:',
  'Détail des articles commandés :': 'Detail van bestelde artikelen:',
  'Approve': 'Goedkeuren',
  'Valider': 'Goedkeuren',
  'Reject': 'Weigeren',
  'Refuser': 'Weigeren',
  'Approval req.': 'Goed te keuren (Leiding)',
  'À valider (Chefs)': 'Goed te keuren (Leiding)',
  'Delegated': 'Gedelegeerd',
  'Délégué': 'Gedelegeerd',
  'Transfer': 'Overdragen',
  'Transférer': 'Overdragen',
  'View details →': 'Volledige details →',
  'Voir détail complet →': 'Volledige details →',
  'Proof / Signature': 'Bewijs / Handtekening',
  'Preuve / Signature': 'Bewijs / Handtekening',
  'Scan Shelf Pickup QR Code': 'Afhaal-QR-code scannen',
  'Scanner le QR Code Retrait': 'Afhaal-QR-code scannen',
  'Point camera at shelf / bin': 'Richt de camera op de stelling of bak',
  "Pointez la caméra sur l'étagère ou le bac": 'Richt de camera op de stelling of bak',
  'Or enter order # / product ref manually:':
    'Of voer handmatig het bestelnummer / de referentie in:',
  'Ou saisie manuelle du numéro de commande / référence :':
    'Of voer handmatig het bestelnummer / de referentie in:',
  'Verify': 'Verifiëren',
  'Vérifier': 'Verifiëren',
  'Order Verified!': 'Bestelling Geverifieerd!',
  'Commande Identifiée !': 'Bestelling Geverifieerd!',
  'Pickup Location': 'Afhaallocatie',
  'Emplacement de Retrait': 'Afhaallocatie',
  'Store pickup area': 'Afhaalzone magazijn',
  'Zone de retrait magasin': 'Afhaalzone magazijn',
  'Site': 'Werf',
  'Chantier': 'Werf',
  'Requester': 'Aanvrager',
  'Demandeur': 'Aanvrager',
  'Unavailable': 'Niet beschikbaar',
  'Non disponible': 'Niet beschikbaar',
  'Add Items to Cart': 'Artikelen toevoegen aan mandje',
  'Ajouter des Articles au Panier': 'Artikelen toevoegen aan mandje',
  'Search catalog': 'Zoek een artikel in de catalogus',
  'Recherchez un article dans le catalogue': 'Zoek een artikel in de catalogus',
  'Search by ref, name, brand...': 'Zoeken op referentie, naam, merk...',
  'Rechercher par référence, désignation, marque...': 'Zoeken op referentie, naam, merk...',
  'No items found': 'Geen artikelen gevonden',
  'Aucun article trouvé': 'Geen artikelen gevonden',
  'Back to cart': 'Mijn mandje bekijken',
  'Voir mon panier': 'Mijn mandje bekijken',

  // UsersRolesModal & SMTP
  'Native Camera': 'Native camera',
  'Appareil photo natif': 'Native camera',
  'Scan with native smartphone camera': 'Scannen met de native smartphonecamera',
  'Scanner via appareil photo natif du smartphone': 'Scannen met de native smartphonecamera',
  'Please enter a valid recipient email address for testing.':
    'Voer een geldig e-mailadres van de ontvanger in voor de test.',
  'Veuillez saisir une adresse e-mail destinataire valide pour le test.':
    'Voer een geldig e-mailadres van de ontvanger in voor de test.',
  'Please provide a valid "Sender Email" in the form (verified on your Brevo account).':
    'Vul een geldig "E-mailadres afzender" in op het formulier (geverifieerd op uw Brevo-account).',
  'Veuillez renseigner un "E-mail Expéditeur" valide dans le formulaire (adresse validée sur votre compte Brevo).':
    'Vul een geldig "E-mailadres afzender" in op het formulier (geverifieerd op uw Brevo-account).',
  'Permission denied: "perm_report_view" is required to send emails.':
    'Toegang geweigerd: u moet beschikken over het recht "perm_report_view" om e-mails te verzenden.',
  'Permission refusée : Vous devez disposer du droit "perm_report_view" pour expédier des e-mails.':
    'Toegang geweigerd: u moet beschikken over het recht "perm_report_view" om e-mails te verzenden.',
  '✅ Secure transmission test - TOT Stock PRO':
    '✅ Beveiligde verzendtest - TOT Stock PRO',
  '✅ Test de transmission sécurisée - TOT Stock PRO':
    '✅ Beveiligde verzendtest - TOT Stock PRO',
  'Test email sent successfully via secure Edge Function to':
    'Test-e-mail succesvol verzonden via beveiligde Edge Function naar',
  "E-mail de test expédié avec succès via l'Edge Function sécurisée à":
    'Test-e-mail succesvol verzonden via beveiligde Edge Function naar',
  'Email Dispatch Configuration': 'Configuratie E-mailverzending',
  'Configuration Expédition E-mail': 'Configuratie E-mailverzending',
  'Secure setup with zero passwords or keys stored in client':
    'Beveiligd beheer zonder opslag van sleutels of wachtwoorden in de client',
  'Gestion sécurisée sans stockage de clés ou mot de passe dans le client':
    'Beveiligd beheer zonder opslag van sleutels of wachtwoorden in de client',
  'Name is required.': 'De naam is verplicht.',
  'Le nom est obligatoire.': 'De naam is verplicht.',
  'Email is required to create an account.':
    'Een zakelijk e-mailadres is verplicht om een account aan te maken.',
  "L'adresse e-mail professionnelle est obligatoire pour créer un compte.":
    'Een zakelijk e-mailadres is verplicht om een account aan te maken.',
  'Initial password must be at least 6 characters.':
    'Het initiële wachtwoord moet minstens 6 tekens bevatten.',
  'Le mot de passe initial doit comporter au moins 6 caractères.':
    'Het initiële wachtwoord moet minstens 6 tekens bevatten.',
  'Error saving user': 'Fout bij het opslaan van gebruiker',
  'Erreur enregistrement': 'Fout bij het opslaan van gebruiker',
  'Role name is required.': 'De naam van de rol is verplicht.',
  'Le nom du rôle est obligatoire.': 'De naam van de rol is verplicht.',
  'Cancel editing': 'Bewerking annuleren',
  'Annuler la modification': 'Bewerking annuleren',
  'General': 'Algemeen',
  'Général': 'Algemeen',
  'Auto if empty': 'Automatisch indien leeg',
  'Auto si vide': 'Automatisch indien leeg',
  '💡 Leave empty to auto-generate a secure temporary password.':
    '💡 Laat leeg om automatisch een veilig tijdelijk wachtwoord te genereren.',
  "💡 Laissez vide pour qu'un mot de passe temporaire soit généré automatiquement.":
    '💡 Laat leeg om automatisch een veilig tijdelijk wachtwoord te genereren.',
  '⚡ Generate': '⚡ Genereren',
  '⚡ Générer': '⚡ Genereren',
  'Department Manager cannot change role':
    'Een afdelingsverantwoordelijke kan de rol van een gebruiker niet wijzigen',
  "Un Responsable de département ne peut pas modifier le rôle d'un utilisateur":
    'Een afdelingsverantwoordelijke kan de rol van een gebruiker niet wijzigen',
  'Reset password': 'Wachtwoord resetten (tijdelijk wachtwoord genereren)',
  'Réinitialiser le mot de passe (générer un mot de passe temporaire)':
    'Wachtwoord resetten (tijdelijk wachtwoord genereren)',
  'Preparer Option ?': 'Optie « Orderpicker? »',
  'Menu « Préparateur ? »': 'Optie « Orderpicker? »',
  'YES (Can manage orders)': 'JA (Kan bestellingen beheren)',
  'OUI (Gestion des commandes)': 'JA (Kan bestellingen beheren)',
  'NO (Requester only)': 'NEE (Alleen aanvrager)',
  'NON (Demandeur seul)': 'NEE (Alleen aanvrager)',
  'Can manage warehouse orders': 'Deze persoon kan magazijnbestellingen beheren',
  'La personne pourra gérer les commandes': 'Deze persoon kan magazijnbestellingen beheren',
  'Can only place orders': 'Deze persoon kan alleen bestellingen plaatsen',
  'La personne ne pourra que faire des commandes': 'Deze persoon kan alleen bestellingen plaatsen',
  'Require password renewal on next login':
    'Wachtwoordvernieuwing verplichten bij volgende aanmelding',
  'Exiger le renouvellement du mot de passe à la prochaine connexion':
    'Wachtwoordvernieuwing verplichten bij volgende aanmelding',
  'User will be prompted to set a new personal password (min. 6 chars) immediately upon next login.':
    'Bij de volgende aanmelding wordt de gebruiker gevraagd direct een nieuw persoonlijk wachtwoord (min. 6 tekens) in te stellen.',
  "Dès sa prochaine ouverture de session, l'utilisateur sera invité à définir son nouveau mot de passe secret personnel (min. 6 caractères).":
    'Bij de volgende aanmelding wordt de gebruiker gevraagd direct een nieuw persoonlijk wachtwoord (min. 6 tekens) in te stellen.',
  'Paired Teammate / Binôme': 'Vaste partner / Binôme op het terrein',
  'Binôme habituel / Équipier de terrain': 'Vaste partner / Binôme op het terrein',
  'Paired': 'Gekoppelde binôme',
  'Binôme associé': 'Gekoppelde binôme',
  "Pairs this teammate: they gain access to their partner's assigned vehicle and shared equipment.":
    'Koppelt deze collega als binôme: hij/zij krijgt toegang tot de bestelwagen en het gedeelde materiaal van zijn/haar partner.',
  'Associe cet équipier comme binôme : il aura accès aux camionnettes et matériels partagés de son partenaire.':
    'Koppelt deze collega als binôme: hij/zij krijgt toegang tot de bestelwagen en het gedeelde materiaal van zijn/haar partner.',
  '— No paired binôme —': '— Geen vaste binôme —',
  '— Aucun binôme attitré —': '— Geen vaste binôme —',
  'Authorized Depots & Warehouses': 'Toegestane magazijnen & depots voor dit account',
  'Dépôts & Magasins autorisés pour ce compte': 'Toegestane magazijnen & depots voor dit account',
  'All depots (*)': 'Alle magazijnen (*)',
  'Tous les dépôts (*)': 'Alle magazijnen (*)',
  'selected': 'geselecteerd',
  'sélectionné(s)': 'geselecteerd',
  'Access to all depots (No restriction)': 'Toegang tot alle magazijnen (Geen beperking)',
  'Accès à tous les dépôts (Prélèvement libre)': 'Toegang tot alle magazijnen (Geen beperking)',
  'Or check specific depots accessible by this user:':
    'Of vink de specifieke magazijnen aan waartoe deze gebruiker toegang heeft:',
  'Ou cochez précisément les dépôts accessibles par cet utilisateur :':
    'Of vink de specifieke magazijnen aan waartoe deze gebruiker toegang heeft:',
  'Only department managers and their deputies can view members of other departments.':
    'Alleen afdelingsverantwoordelijken en hun plaatsvervangers kunnen medewerkers van andere afdelingen bekijken.',
  'Seuls les responsables de département et leurs suppléants peuvent consulter les collaborateurs des autres départements.':
    'Alleen afdelingsverantwoordelijken en hun plaatsvervangers kunnen medewerkers van andere afdelingen bekijken.',
  'As department manager or deputy, you can view members across all departments.':
    'Als afdelingsverantwoordelijke of plaatsvervanger ziet u de medewerkers van alle afdelingen.',
  'En tant que responsable ou suppléant, vous visualisez les collaborateurs de tous les départements.':
    'Als afdelingsverantwoordelijke of plaatsvervanger ziet u de medewerkers van alle afdelingen.',
  'Blocked': 'Geblokkeerd',
  'Bloqué': 'Geblokkeerd',
  'Reset required': 'Vernieuwing vereist',
  'Renouvellement requis': 'Vernieuwing vereist',
  'Warehouse Preparer': 'Magazijn-orderpicker',
  'Préparateur Magasin': 'Magazijn-orderpicker',
  'All depots': 'Alle magazijnen',
  'Tous les dépôts': 'Alle magazijnen',
  'allowed depot(s)': 'toegestane magazijn(en)',
  'dépôt(s) autorisé(s)': 'toegestane magazijn(en)',
  'Disable required password reset': 'Verplichte wachtwoordvernieuwing uitschakelen',
  'Désactiver le renouvellement obligatoire du mot de passe':
    'Verplichte wachtwoordvernieuwing uitschakelen',
  'Require password reset on next login': 'Wachtwoordvernieuwing verplichten bij volgende login',
  '11 Recommended Roles (TOT Stock Spec)': '11 Aanbevolen Rollen (TOT Stock Specificatie)',
  '11 Rôles Recommandés (Spécification TOT Stock)': '11 Aanbevolen Rollen (TOT Stock Specificatie)',
  'Reset all 11 roles to the recommended TOT Stock specification?':
    'Wilt u alle 11 rollen herstellen naar de aanbevolen TOT Stock-specificatie?',
  'Voulez-vous rétablir l\'ensemble des 11 rôles par défaut selon les recommandations du document (Super Admin, IT, Adm, Log, RMag, Mag, RDép, Chef, Op, Int, Cons) ?':
    'Wilt u alle 11 rollen herstellen naar de aanbevolen TOT Stock-specificatie?',
  'Reset to default specifications': 'Standaardaanbevelingen herstellen',
  'Revenir aux recommandations par défaut de ce document': 'Standaardaanbevelingen herstellen',
  'Defaults (Specification)': 'Standaard (Specificatie)',
  'Défaut (Recommandations document)': 'Standaard (Specificatie)',
  'Menu Buttons & Rights Attribution (Checkboxes) :':
    'Toewijzing van knoppen & menu’s (Selectievakjes):',
  'Attribution des boutons & menus (Cases à cocher) :':
    'Toewijzing van knoppen & menu’s (Selectievakjes):',
  'Every button of each menu has its own dedicated checkbox':
    'Elke knop van elk menu heeft een eigen selectievakje',
  'Chaque bouton de chaque menu possède sa propre case à cocher':
    'Elke knop van elk menu heeft een eigen selectievakje',
  'buttons': 'knoppen',
  'boutons': 'knoppen',
  'Check all buttons': 'Alles aanvinken (Alle knoppen)',
  'Tout cocher (Tous les boutons)': 'Alles aanvinken (Alle knoppen)',
  'Uncheck all': 'Alles uitvinken',
  'Tout décocher': 'Alles uitvinken',
  'Restore default permissions for this role': 'Aanbevolen rechten voor deze rol herstellen',
  'Rétablir les droits recommandés pour ce rôle': 'Aanbevolen rechten voor deze rol herstellen',
  'Default for this role': 'Standaardrechten van deze rol',
  'Droits par défaut de ce rôle': 'Standaardrechten van deze rol',
  'Filter buttons (e.g. price, label, delete, scan, kpi, csv...)...':
    'Filter knoppen (bijv. prijs, etiket, verwijderen, scan, kpi, csv...)...',
  'Filtrer un bouton (ex: prix, étiquettes, suppression, scan, kpi, csv...)...':
    'Filter knoppen (bijv. prijs, etiket, verwijderen, scan, kpi, csv...)...',
  'Uncheck all in this menu': 'Alles uitvinken in dit menu',
  'Tout décocher dans ce menu': 'Alles uitvinken in dit menu',
  'Check all in this menu': 'Alles aanvinken in dit menu',
  'Tout cocher dans ce menu': 'Alles aanvinken in dit menu',
  'Active': 'Actief',
  'Menu Actif': 'Actief menu',
  'Check All': 'Alles aanvinken',
  'Tout Cocher': 'Alles aanvinken',
  'Prices & Finance': 'Prijzen & Financiën',
  'Prix & Finance': 'Prijzen & Financiën',
  'permission(s)': 'recht(en)',
  'Prices hidden': 'Prijzen verborgen',
  'Prix masqués': 'Prijzen verborgen',
  'role(s)': 'rol(len)',
  'rôle(s)': 'rol(len)',

  // AppContext messages & notifications
  'Ready for sign in': 'Klaar om in te loggen',
  'Prêt pour connexion': 'Klaar om in te loggen',
  'Supabase server unreachable ("Failed to fetch"). Project paused or bad URL.':
    'Supabase-server onbereikbaar ("Failed to fetch"). Project gepauzeerd of onjuiste URL.',
  'Serveur Supabase inaccessible ("Failed to fetch"). Projet en veille ou URL erronée.':
    'Supabase-server onbereikbaar ("Failed to fetch"). Project gepauzeerd of onjuiste URL.',
  'Supabase communication error.': 'Supabase-communicatiefout.',
  'Erreur de communication Supabase.': 'Supabase-communicatiefout.',
  'User Sign-out': 'Gebruiker Uitgelogd',
  'Déconnexion Utilisateur': 'Gebruiker Uitgelogd',
  'Invalid login credentials (email or password incorrect).':
    'Ongeldige inloggegevens (e-mailadres of wachtwoord onjuist).',
  'Identifiants de connexion incorrects (e-mail ou mot de passe invalide).':
    'Ongeldige inloggegevens (e-mailadres of wachtwoord onjuist).',
  'Email address not yet confirmed on Supabase.':
    'Uw e-mailadres is nog niet bevestigd op Supabase.',
  "Votre adresse e-mail n'est pas encore confirmée sur Supabase.":
    'Uw e-mailadres is nog niet bevestigd op Supabase.',
  'Invalid email or password.': 'Ongeldig e-mailadres of wachtwoord.',
  'Email ou mot de passe incorrect.': 'Ongeldig e-mailadres of wachtwoord.',
  'User Sign-in': 'Gebruiker Ingelogd',
  'Connexion Utilisateur': 'Gebruiker Ingelogd',
  'No account found for this email address.': 'Geen account gevonden voor dit e-mailadres.',
  'Aucun compte trouvé pour cette adresse e-mail.': 'Geen account gevonden voor dit e-mailadres.',
  'Unable to reach Supabase server to send reset email.':
    'Kan de Supabase-server niet bereiken om de herstel-e-mail te verzenden.',
  "Impossible de joindre le serveur Supabase pour envoyer l'e-mail de réinitialisation.":
    'Kan de Supabase-server niet bereiken om de herstel-e-mail te verzenden.',
  'Error requesting password reset.': 'Fout bij het aanvragen van wachtwoordherstel.',
  'Erreur lors de la demande de réinitialisation.': 'Fout bij het aanvragen van wachtwoordherstel.',
  'Password Reset Requested': 'Wachtwoordherstel Aangevraagd',
  'Demande Mot de Passe Oublié': 'Wachtwoordherstel Aangevraagd',
  'No account found with this email address.': 'Geen account gekoppeld aan dit e-mailadres.',
  'Aucun compte associé à cette adresse e-mail.': 'Geen account gekoppeld aan dit e-mailadres.',
  'Invalid email address.': 'Ongeldig e-mailadres.',
  'Adresse e-mail invalide.': 'Ongeldig e-mailadres.',
  'Please enter the recovery code from your email (or click the link in the email).':
    'Voer de herstelcode uit uw e-mail in (of klik direct op de link in de e-mail).',
  "Veuillez saisir le code de récupération reçu par e-mail (ou cliquez directement sur le lien dans l'e-mail).":
    'Voer de herstelcode uit uw e-mail in (of klik direct op de link in de e-mail).',
  'Your password has been reset successfully.': 'Uw wachtwoord is succesvol opnieuw ingesteld.',
  'Votre mot de passe a été réinitialisé avec succès.': 'Uw wachtwoord is succesvol opnieuw ingesteld.',
  'User not found.': 'Gebruiker niet gevonden.',
  'Utilisateur introuvable.': 'Gebruiker niet gevonden.',
  'Password updated.': 'Wachtwoord bijgewerkt.',
  'Mot de passe mis à jour.': 'Wachtwoord bijgewerkt.',
  'Unauthorized withdrawal from this depot.': 'Uitgifte niet toegestaan op dit magazijn.',
  'Sortie ou emprunt non autorisé sur ce dépôt.': 'Uitgifte niet toegestaan op dit magazijn.',
  'Unauthorized stock entry for this depot.': 'Voorraadinname niet toegestaan op dit magazijn.',
  'Entrée en stock non autorisée sur ce dépôt.': 'Voorraadinname niet toegestaan op dit magazijn.',
  'Basket 1': 'Mandje 1',
  'Panier 1': 'Mandje 1',
  'Action blocked: This order is awaiting hierarchical approval and cannot be assigned.':
    'Actie geblokkeerd: deze bestelling wacht op hiërarchische goedkeuring en kan niet worden toegewezen.',
  'Action impossible : Cette commande est en attente de validation hiérarchique et ne peut pas être assignée à la préparation.':
    'Actie geblokkeerd: deze bestelling wacht op hiërarchische goedkeuring en kan niet worden toegewezen.',
  'Cannot assign a rejected order.': 'Kan een geweigerde bestelling niet toewijzen.',
  'Action impossible : Cette commande a été refusée.': 'Kan een geweigerde bestelling niet toewijzen.',
  'Order not found.': 'Bestelling niet gevonden.',
  'Commande introuvable.': 'Bestelling niet gevonden.',
  'Order assigned to you!': 'Bestelling aan u toegewezen!',
  'Commande assignée à votre préparation !': 'Bestelling aan u toegewezen!',
  'Withdrawal confirmed! Stock outflows recorded.':
    'Afhaling bevestigd! Voorraaduitgiftes zijn geregistreerd.',
  'Retrait confirmé avec succès ! Les sorties de stock ont été enregistrées.':
    'Afhaling bevestigd! Voorraaduitgiftes zijn geregistreerd.',
  'This order is already being prepared and cannot be modified.':
    'Deze bestelling wordt al voorbereid door het magazijn en kan niet meer worden gewijzigd.',
  'Cette commande est déjà prise en charge ou en cours de préparation par le magasin et ne peut plus être modifiée.':
    'Deze bestelling wordt al voorbereid door het magazijn en kan niet meer worden gewijzigd.',
  'Order cancelled.': 'Bestelling geannuleerd.',
  'Commande annulée avec succès.': 'Bestelling succesvol geannuleerd.',
  'Not signed in.': 'Niet ingelogd.',
  'Non connecté.': 'Niet ingelogd.',
  'Colleague not found.': 'Geselecteerde collega niet gevonden.',
  'Collègue sélectionné introuvable.': 'Geselecteerde collega niet gevonden.',
  'Order Pickup Delegated': 'Afhaling van Bestelling Gedelegeerd',
  'Délégation de Retrait Commande': 'Afhaling van Bestelling Gedelegeerd',
  'Item not found in order.': 'Artikel niet gevonden in de bestelling.',
  'Article introuvable dans la commande.': 'Artikel niet gevonden in de bestelling.',
  'Picked quantity must be > 0.': 'Het gepickte aantal moet groter zijn dan 0.',
  'La quantité préparée doit être supérieure à 0.': 'Het gepickte aantal moet groter zijn dan 0.',
  'Product Deleted': 'Artikel Verwijderd',
  'Article Supprimé': 'Artikel Verwijderd',
  'Inventory Audit Adjusted': 'Inventaristelling Gecorrigeerd',
  "Comptage d'Inventaire Régularisé": 'Inventaristelling Gecorrigeerd',
  'Roles reset to recommendations': 'Rollen hersteld naar standaardaanbevelingen',
  'Rôles réinitialisés aux recommandations': 'Rollen hersteld naar standaardaanbevelingen',

  // PlusMenuView & Header & LoginWelcomeScreen
  'Valuation Currency': 'Waarderingsvaluta',
  'Devise de Valorisation': 'Waarderingsvaluta',
  '🏢 Centralized Company-wide': '🏢 Centraal voor het hele bedrijf (Supabase)',
  '🏢 Centralisée Entreprise (Supabase)': '🏢 Centraal voor het hele bedrijf (Supabase)',
  'Installation Diagnostics': 'Installatiediagnose',
  "Diagnostic d'installation": 'Installatiediagnose',
  'Run public.diagnostic_installation() (8 checks)':
    'Voer public.diagnostic_installation() uit (8 controles)',
  'Exécuter public.diagnostic_installation() (8 contrôles)':
    'Voer public.diagnostic_installation() uit (8 controles)',
  'Documentation & Guides': 'Documentatie & Handleidingen',
  'Documentation & Manuels': 'Documentatie & Handleidingen',
  'User Manual (PDF)': 'Gebruikershandleiding (PDF)',
  "Manuel d'Utilisation (PDF)": 'Gebruikershandleiding (PDF)',
  'Android APK Build Guide': 'Android APK-compileergids',
  'Guide Compilation APK Android': 'Android APK-compileergids',
  'Marketing Website HTML': 'Promotionele Website HTML',
  'Code HTML Site Vitrine': 'Promotionele Website HTML',
  'Supabase SQL & CLI': 'Supabase SQL & CLI',
  'Console SQL & CLI Supabase': 'Supabase SQL & CLI',

  // Roles, Departments, Subcategories (initialData.ts)
  'Super Administrateur 👑': 'Superbeheerder 👑',
  'Administrateur 🏢': 'Beheerder 🏢',
  'Magasinier 👷': 'Magazijnier 👷',
  'Chef de Chantier 🏗️': 'Werfleider 🏗️',
  'Opérateur 🔨': 'Operator 🔨',
  'Administrateur Informatique (IT) 💻': 'IT-Beheerder 💻',
  'Responsable Logistique 🚚': 'Logistiek Verantwoordelijke 🚚',
  'Responsable Magasin 📋': 'Magazijnverantwoordelijke 📋',
  'Responsable de Département 📁': 'Afdelingsverantwoordelijke 📁',
  'Intérimaire ⏱️': 'Uitzendkracht ⏱️',
  'Consultation 🔍': 'Raadpleging 🔍',
  'Plomberie': 'Sanitair & Loodgieterij',
  'Logistique': 'Logistiek',
  'Électricité': 'Elektriciteit',
  'Direction': 'Directie',
  'Bâti & Sanitaire': 'Ruwbouw & Sanitair',
  'Tuyauterie & Raccords': 'Leidingen & Koppelingen',
  'Électricité & Câblage': 'Elektriciteit & Bekabeling',
  'Robinetterie & Vannes': 'Kranen & Afsluiters',
  'Outillage & Équipement': 'Gereedschap & Uitrusting',
  'Consommables & Fixations': 'Verbruiksartikelen & Bevestigingen',

  // Permission Groups & Buttons (permissionMatrix.ts)
  'Navigation Bar & Header': 'Navigatiebalk & Koptekst (Header & BottomNav)',
  'Barre de Navigation & En-tête (Header & BottomNav)': 'Navigatiebalk & Koptekst (Header & BottomNav)',
  'Buttons from the fixed bottom bar and top header':
    'Knoppen van de vaste onderste navigatiebalk en bovenste koptekst',
  'Boutons de la barre inférieure fixe et de la barre supérieure':
    'Knoppen van de vaste onderste navigatiebalk en bovenste koptekst',
  'Tab Button "Home / Dashboard"': 'Tabbladknop « Start / Dashboard »',
  'Bouton Onglet « Accueil / Dashboard »': 'Tabbladknop « Start / Dashboard »',
  'Displays first bottom tab linking to dashboard':
    'Toont het eerste navigatietabblad naar het dashboard',
  'Affiche le premier onglet de navigation vers le tableau de bord':
    'Toont het eerste navigatietabblad naar het dashboard',
  'Tab Button "Inventory / Search"': 'Tabbladknop « Inventaris / Zoeken »',
  'Bouton Onglet « Inventaire / Recherche »': 'Tabbladknop « Inventaris / Zoeken »',
  'Displays second tab linking to inventory catalog':
    'Toont het tweede navigatietabblad naar de voorraadcatalogus',
  'Affiche le deuxième onglet de navigation vers le catalogue de stock':
    'Toont het tweede navigatietabblad naar de voorraadcatalogus',
  'Central "(+) Quick Action" Button': 'Centrale Knop « (+) Snelle Actie »',
  'Bouton Central « (+) Action Rapide »': 'Centrale Knop « (+) Snelle Actie »',
  'Floating central orange plus button for quick movements':
    'Zwevende centrale oranje plusknop onderaan het scherm voor snelle uitgiftes/innames',
  "Bouton orange flottant central au bas de l'écran pour sorties/entrées rapides":
    'Zwevende centrale oranje plusknop onderaan het scherm voor snelle uitgiftes/innames',
  'Tab Button "Movements & Flows"': 'Tabbladknop « Bewegingen & Stromen »',
  'Bouton Onglet « Mouvements & Flux »': 'Tabbladknop « Bewegingen & Stromen »',
  'Displays fourth tab for stock transaction history':
    'Toont het vierde tabblad met de geschiedenis van innames en uitgiftes',
  "Affiche le quatrième onglet d'historique des entrées/sorties":
    'Toont het vierde tabblad met de geschiedenis van innames en uitgiftes',
  'Tab Button "More Menu (•••)"': 'Tabbladknop « Menu Meer (•••) »',
  'Bouton Onglet « Menu Plus (•••) »': 'Tabbladknop « Menu Meer (•••) »',
  'Displays fifth tab for general menu & settings':
    'Toont het vijfde tabblad met toegang tot instellingen en submenu’s',
  'Affiche le cinquième onglet donnant accès aux paramètres et sous-menus':
    'Toont het vijfde tabblad met toegang tot instellingen en submenu’s',
  'Bell Button "Low Stock Alerts"': 'Belknop « Meldingen Lage Voorraad »',
  'Bouton Cloche « Notifications Stocks Faibles »': 'Belknop « Meldingen Lage Voorraad »',
  'Header bell icon with low-stock badge count':
    'Bel-icoon in de koptekst met teller voor voorraadwaarschuwingen',
  'Icône cloche dans le header avec badge de comptage des alertes':
    'Bel-icoon in de koptekst met teller voor voorraadwaarschuwingen',
  'Button "Sync Status & Offline Details"': 'Knop « Synchronisatiestatus & Offline Details »',
  'Bouton « Statut Synchronisation & Hors-ligne »': 'Knop « Synchronisatiestatus & Offline Details »',
  'Clickable Online/Offline/Supabase status pill in header':
    'Klikbare Online/Offline/Supabase-statusbadge in de koptekst',
  'Badge cliquable En ligne/Hors-ligne/Supabase dans le header':
    'Klikbare Online/Offline/Supabase-statusbadge in de koptekst',
  'Button "Company License Plan Badge"': 'Knop « Bedrijfslicentie & Formulebadge »',
  'Bouton « Badge & Forfait Licence Entreprise »': 'Knop « Bedrijfslicentie & Formulebadge »',
  'Plan pill (FREE/PRO/ENT) opening license details':
    'Klikbare formulebadge (FREE/STA/PRO/ENT) die de licentiedetails opent',
  'Pilule cliquable du forfait (FREE/PRO/ENT) ouvrant les détails licence':
    'Klikbare formulebadge (FREE/STA/PRO/ENT) die de licentiedetails opent',
  'Button "Language Switch FR / EN"': 'Knop « Taalkeuze FR / EN / NL »',
  'Bouton « Bascule de Langue FR / EN »': 'Knop « Taalkeuze FR / EN / NL »',
  'Flag toggle button in header to switch language':
    'Vlagknop in de koptekst om de taal te wijzigen',
  'Bouton drapeau dans le header pour changer la langue':
    'Vlagknop in de koptekst om de taal te wijzigen',
  'Button "Theme Toggle Dark / Light"': 'Knop « Schakelaar Donkere / Lichte Modus »',
  'Bouton « Bascule Mode Sombre / Clair »': 'Knop « Schakelaar Donkere / Lichte Modus »',
  'Sun/moon icon in header to switch dark/light mode':
    'Zon/maan-icoon in de koptekst om van thema te wisselen',
  'Icône soleil/lune dans le header pour basculer le thème':
    'Zon/maan-icoon in de koptekst om van thema te wisselen',
  'Button "About & Version Info"': 'Knop « Over & Versie-info TOT »',
  'Bouton « À Propos & Version TOT »': 'Knop « Over & Versie-info TOT »',
  'Info (i) icon in header showing version & legal info':
    'Informatie-icoon (i) in de koptekst met versie en juridische vermeldingen',
  "Icône d'information (i) dans le header affichant la version et mentions":
    'Informatie-icoon (i) in de koptekst met versie en juridische vermeldingen',
  'Button "Quick Logout"': 'Knop « Snel Uitloggen »',
  'Bouton « Déconnexion Rapide »': 'Knop « Snel Uitloggen »',
  'Red logout button in header and menu': 'Rode uitlogknop in de koptekst en het menu Meer',
  'Bouton rouge de déconnexion dans le header et le menu plus':
    'Rode uitlogknop in de koptekst en het menu Meer',
  'Central Quick Action Menu (+)': 'Centraal Snelle Actie Menu (+)',
  "Menu Central d'Action Rapide (+)": 'Centraal Snelle Actie Menu (+)',
  'Buttons shown when clicking the central floating (+) button':
    'Knoppen die verschijnen bij het klikken op de centrale (+) knop',
  "Boutons qui s'affichent lors du clic sur le bouton central (+)":
    'Knoppen die verschijnen bij het klikken op de centrale (+) knop',
  'Button "Outflow / Project assignment"': 'Knop « Uitgifte Werf / Scan Uitgifte »',
  'Bouton « Sortie Chantier / Scanner Sortie »': 'Knop « Uitgifte Werf / Scan Uitgifte »',
  'Allows scanning or recording stock exit to a project/site':
    'Maakt het mogelijk een voorraaduitgifte naar een werf te scannen of in te voeren',
  'Permet de scanner ou saisir une sortie de stock vers un chantier':
    'Maakt het mogelijk een voorraaduitgifte naar een werf te scannen of in te voeren',
  'Button "Inflow / Stock reception"': 'Knop « Voorraadinname / Scan Ontvangst »',
  'Bouton « Entrée en Stock / Scanner Réception »': 'Knop « Voorraadinname / Scan Ontvangst »',
  'Allows scanning or recording stock reception in warehouse':
    'Maakt het mogelijk een goederenontvangst in het magazijn te scannen of in te voeren',
  'Permet de scanner ou saisir une entrée de marchandise en magasin':
    'Maakt het mogelijk een goederenontvangst in het magazijn te scannen of in te voeren',
  'Button "+ Create New Article"': 'Knop « + Nieuw Artikel Aanmaken »',
  'Bouton « + Créer un Nouvel Article »': 'Knop « + Nieuw Artikel Aanmaken »',
  'Direct shortcut in (+) menu to create a catalog reference':
    'Directe snelkoppeling in het (+) menu om een productreferentie aan te maken',
  'Raccourci direct dans le menu (+) pour créer une référence produit':
    'Directe snelkoppeling in het (+) menu om een productreferentie aan te maken',
  'Button / Action "Inter-Depot Transfer"': 'Knop / Actie « Overdracht tussen Depots »',
  'Bouton / Action « Transfert entre Dépôts »': 'Knop / Actie « Overdracht tussen Depots »',
  'Allows recording material transfers from source depot to destination depot':
    'Maakt het mogelijk een materiaaloverdracht van een bronmagazijn naar een bestemmingsmagazijn uit te voeren',
  "Permet d'effectuer un transfert de matériel d'un dépôt source vers un dépôt destination":
    'Maakt het mogelijk een materiaaloverdracht van een bronmagazijn naar een bestemmingsmagazijn uit te voeren',
  'Home & Dashboard Menu': 'Menu Start & Dashboard',
  'Menu Accueil & Tableau de Bord (Dashboard)': 'Menu Start & Dashboard',
  'Buttons, filters and KPI cards on the home page':
    'Knoppen, filters en gegevenskaarten op de startpagina',
  "Boutons, filtres et cartes de données de la page d'accueil":
    'Knoppen, filters en gegevenskaarten op de startpagina',
  'Buttons / KPI Stat Cards (Refs, Units, Stocks)':
    'Knoppen / KPI-statistiekkaarten (Referenties, Eenheden, Voorraden)',
  'Boutons / Tuiles Cartes KPIs (Références, Unités, Stocks)':
    'Knoppen / KPI-statistiekkaarten (Referenties, Eenheden, Voorraden)',
  'Displays 4 clickable stat cards linking to filtered inventory':
    'Toont de 4 klikbare statistiekblokken die naar de inventaris leiden',
  "Affiche les 4 blocs de statistiques cliquables menant vers l'inventaire":
    'Toont de 4 klikbare statistiekblokken die naar de inventaris leiden',
  'Button / Tile "Total Financial Stock Value (€)"':
    'Knop / Tegel « Totale Financiële Voorraadwaarde (€) »',
  'Bouton / Tuile « Valeur Financière Totale du Stock (€) »':
    'Knop / Tegel « Totale Financiële Voorraadwaarde (€) »',
  'Displays total valuation amount of stock in enterprise currency':
    'Toont het totale gewaardeerde bedrag van de bedrijfsvoorraad',
  "Affiche le montant total valorisé du stock de l'entreprise":
    'Toont het totale gewaardeerde bedrag van de bedrijfsvoorraad',
  'Scope Button "Entire Company" (All departments)':
    'Bereikknop « Hele Bedrijf » (Alle afdelingen)',
  'Bouton Portée « Toute la Société » (Tous départements)':
    'Bereikknop « Hele Bedrijf » (Alle afdelingen)',
  'Allows switching KPI view to entire company scope':
    'Maakt het mogelijk de KPI-weergave om te schakelen naar alle werven en afdelingen',
  "Permet de basculer la vue KPI sur l'intégralité des chantiers et services":
    'Maakt het mogelijk de KPI-weergave om te schakelen naar alle werven en afdelingen',
  'Scope Button "My Department" (Team view)': 'Bereikknop « Mijn Afdeling » (Teamweergave)',
  'Bouton Portée « Mon Département » (Vue Équipe)': 'Bereikknop « Mijn Afdeling » (Teamweergave)',
  'Allows department heads to inspect their team movements':
    'Stelt werfleiders en afdelingshoofden in staat de stromen van hun afdeling te analyseren',
  "Permet aux conducteurs et chefs de service d'analyser les flux de leur département":
    'Stelt werfleiders en afdelingshoofden in staat de stromen van hun afdeling te analyseren',
  'Scope Button "Other Department"': 'Bereikknop « Andere Afdeling »',
  'Bouton Portée « Autre Département »': 'Bereikknop « Andere Afdeling »',
  'Allows checking KPIs for any other company department':
    'Maakt het mogelijk de KPI’s van een andere afdeling van het bedrijf te raadplegen',
  "Permet de consulter les KPIs d'un autre service de l'entreprise":
    'Maakt het mogelijk de KPI’s van een andere afdeling van het bedrijf te raadplegen',
  'Scope Button "My Individual KPIs"': 'Bereikknop « Mijn Individuele KPI’s »',
  'Bouton Portée « Mes KPI Individuels »': 'Bereikknop « Mijn Individuele KPI’s »',
  'Displays only movements performed by this user':
    'Toont uitsluitend het materiaal dat persoonlijk door de gebruiker is behandeld',
  "Affiche uniquement le matériel manipulé personnellement par l'utilisateur":
    'Toont uitsluitend het materiaal dat persoonlijk door de gebruiker is behandeld',
  'Filter Button "By Depot / Warehouse" on KPIs':
    'Filterknop « Per Depot / Magazijn » op de KPI’s',
  'Bouton Filtre « Par Dépôt / Magasin » sur les KPIs':
    'Filterknop « Per Depot / Magazijn » op de KPI’s',
  'Allows filtering dashboard counters by physical depot location':
    'Maakt het mogelijk de tellers te filteren per magazijn, werkplaats of nevendepot',
  'Permet de filtrer les compteurs par entrepôt, atelier ou dépôt secondaire':
    'Maakt het mogelijk de tellers te filteren per magazijn, werkplaats of nevendepot',
  'Shortcut Button to Departments list': 'Snelkoppelingsknop naar de lijst met Afdelingen',
  'Bouton Raccourci vers la liste des Départements':
    'Snelkoppelingsknop naar de lijst met Afdelingen',
  'Building icon in dashboard header opening departments':
    'Gebouw-icoon in de koptekst van het dashboard dat de afdelingen opent',
  "Icône bâtiment dans l'en-tête du dashboard ouvrant les départements":
    'Gebouw-icoon in de koptekst van het dashboard dat de afdelingen opent',
  'Inventory & Catalog Menu': 'Menu Inventaris & Materiaalcatalogus',
  'Menu Inventaire & Catalogue Matériel': 'Menu Inventaris & Materiaalcatalogus',
  'Buttons from inventory view, product detail modal and actions':
    'Knoppen van de catalogusweergave, productfiches en bijbehorende acties',
  'Boutons de la vue catalogue, fiches articles et actions associées':
    'Knoppen van de catalogusweergave, productfiches en bijbehorende acties',
  'Button / Access "View product details & stock"':
    'Knop / Toegang « Productfiches & voorraadniveaus bekijken »',
  'Bouton / Accès « Consulter fiches & niveaux de stock »':
    'Knop / Toegang « Productfiches & voorraadniveaus bekijken »',
  'Viewing items catalog and available stock quantities':
    'Raadplegen van catalogusartikelen en beschikbare aantallen',
  'Consultation des articles du catalogue et des quantités disponibles':
    'Raadplegen van catalogusartikelen en beschikbare aantallen',
  'Button / Display "Purchase Prices & Valuations (€)"':
    'Knop / Weergave « Aankoopprijzen & Bedragen (€) »',
  "Bouton / Affichage « Prix d'achat & Montants (€) »":
    'Knop / Weergave « Aankoopprijzen & Bedragen (€) »',
  'UNCHECK to hide all prices, values and monetary amounts for this role':
    'UITVINKEN om alle prijzen, kosten en bedragen te verbergen voor deze rol',
  'DÉCOCHER pour masquer tous les prix, coûts et montants à ce rôle':
    'UITVINKEN om alle prijzen, kosten en bedragen te verbergen voor deze rol',
  'Button "Scan QR / Barcode"': 'Knop « Scan QR-code / Barcode »',
  'Bouton « Scanner QR Code / Code-barres »': 'Knop « Scan QR-code / Barcode »',
  'Top orange scan button to instantly locate item by QR/barcode':
    'Oranje knop bovenaan de inventaris om een product via scan te vinden',
  "Bouton orange en haut de l'inventaire pour trouver un produit par scan":
    'Oranje knop bovenaan de inventaris om een product via scan te vinden',
  'Button "Print Labels"': 'Knop « Etiketten Afdrukken »',
  'Bouton « Imprimer des Étiquettes »': 'Knop « Etiketten Afdrukken »',
  'Printer button opening QR/barcode label generator':
    'Printerknop die de studio voor het genereren van QR-etiketten opent',
  'Bouton imprimante ouvrant le studio de génération de planches QR codes':
    'Printerknop die de studio voor het genereren van QR-etiketten opent',
  'Button "Physical Inventory Audit & Adjustment"':
    'Knop « Fysieke Inventaristelling & Correctie »',
  "Bouton « Comptage d'Inventaire & Régularisation »":
    'Knop « Fysieke Inventaristelling & Correctie »',
  'Button opening physical stock count tool and entering quantities':
    'Knop die de inventaristellingstool en invoer van fysieke aantallen opent',
  "Bouton ouvrant l'outil de comptage terrain et saisie des quantités physiques":
    'Knop die de inventaristellingstool en invoer van fysieke aantallen opent',
  'Button "Validate Inventory Variances"': 'Knop « Inventarisverschillen Valideren »',
  "Bouton « Valider les Écarts d'Inventaire »": 'Knop « Inventarisverschillen Valideren »',
  'Allows manager to approve count variances and write adjustments to stock':
    'Stelt de verantwoordelijke in staat fysieke verschillen goed te keuren en de correctie in de voorraad te boeken (functiescheiding)',
  "Permet au responsable d'approuver les écarts physiques et d'enregistrer la régularisation en stock (séparation des tâches)":
    'Stelt de verantwoordelijke in staat fysieke verschillen goed te keuren en de correctie in de voorraad te boeken (functiescheiding)',
  'Button "+ New Item" & Reference Editing':
    'Knop « + Nieuw Materiaal » & Referentie Bewerken',
  'Bouton « + Nouveau Matériel » & Édition Référence':
    'Knop « + Nieuw Materiaal » & Referentie Bewerken',
  'Create items, modify prices, alert thresholds and details':
    'Aanmaken van artikelen, wijzigen van prijzen, waarschuwingsdrempels, enz.',
  "Création d'articles, modification de prix, seuils d'alertes, etc.":
    'Aanmaken van artikelen, wijzigen van prijzen, waarschuwingsdrempels, enz.',
  'Button "Permanently delete article"': 'Knop « Artikel definitief verwijderen »',
  "Bouton « Supprimer définitivement l'article »": 'Knop « Artikel definitief verwijderen »',
  'Red delete button in article detail view':
    'Rode knop voor definitieve verwijdering van een referentie in de productfiche',
  "Bouton rouge de suppression définitive d'une référence dans sa fiche":
    'Rode knop voor definitieve verwijdering van een referentie in de productfiche',
  'Button "Direct Quick Out/In Movement" (Item Detail)':
    'Knop « Directe Snelle Uitgifte / Inname » (Productfiche)',
  'Bouton « Sortie / Entrée Rapide Directe » (Fiche)':
    'Knop « Directe Snelle Uitgifte / Inname » (Productfiche)',
  'Quick movement buttons directly on the product detail view':
    'Knoppen voor snelle voorraadbewegingen rechtstreeks vanuit de productfiche',
  "Boutons de mouvement rapide directement depuis la fiche de l'article":
    'Knoppen voor snelle voorraadbewegingen rechtstreeks vanuit de productfiche',
  'Button "Cart / Batch Outflow"': 'Knop « Mandje / Groepsuitgifte »',
  'Bouton « Panier / Sortie par Lot »': 'Knop « Mandje / Groepsuitgifte »',
  'Adding article to multi-item batch assignment cart':
    'Artikel toevoegen aan het mandje voor groepsuitgifte naar werven',
  "Ajout de l'article au panier de sortie multiple pour chantiers":
    'Artikel toevoegen aan het mandje voor groepsuitgifte naar werven',
  'Buttons "Quick Pills & Advanced Filters"':
    'Knoppen « Snelle Filters & Geavanceerde Filters »',
  'Boutons « Filtres Rapides & Filtres Avancés »':
    'Knoppen « Snelle Filters & Geavanceerde Filters »',
  'Pill filters (All, Low, Out) and advanced depot/shelf filter drawer':
    'Filterknoppen (Alles, Laag, Uitverkocht) en filterpaneel voor magazijn, categorie en rek',
  'Pillules (Tous, Faible, Rupture) et tiroir de filtrage dépôt, catégorie, rayon':
    'Filterknoppen (Alles, Laag, Uitverkocht) en filterpaneel voor magazijn, categorie en rek',
  'Movements & Audit Trail Menu': 'Menu Bewegingen & Traceerbaarheid',
  'Menu Mouvements & Traçabilité': 'Menu Bewegingen & Traceerbaarheid',
  'Buttons from movements view, history filters and exports':
    'Knoppen van de stromenweergave, geschiedenis en exports',
  'Boutons de la vue des flux, historique et exports':
    'Knoppen van de stromenweergave, geschiedenis en exports',
  'Button / Access "Movements History View"':
    'Knop / Toegang « Globale Weergave van Bewegingen »',
  'Bouton / Accès « Vue Globale des Mouvements »':
    'Knop / Toegang « Globale Weergave van Bewegingen »',
  'Grants access to stock movements and site assignments log':
    'Geeft toegang tot de lijst met voorraadstromen en werfuitgiftes',
  "Permet d'accéder à la liste des flux de stock et sorties chantiers":
    'Geeft toegang tot de lijst met voorraadstromen en werfuitgiftes',
  'Right "View ALL Company Movements"': 'Recht « ALLE Bewegingen van het Bedrijf Bekijken »',
  "Droit « Consulter TOUS les Mouvements de l'Entreprise »":
    'Recht « ALLE Bewegingen van het Bedrijf Bekijken »',
  'Full visibility over all warehouses, depots, and vehicle stocks':
    'Volledige zichtbaarheid over alle magazijnen, depots en voertuigen (Beheerder)',
  "Visibilité totale sur l'ensemble des dépôts et véhicules (Administrateur)":
    'Volledige zichtbaarheid over alle magazijnen, depots en voertuigen (Beheerder)',
  'Right "View Movements for Assigned Depots / Vehicles"':
    'Recht « Bewegingen van Eigen Magazijnen / Voertuigen Bekijken »',
  'Droit « Consulter les Mouvements de ses Dépôts / Véhicules »':
    'Recht « Bewegingen van Eigen Magazijnen / Voertuigen Bekijken »',
  'Restricts movement visibility to assigned warehouses and vehicles':
    'Beperkt de zichtbaarheid tot alleen de toegestane magazijnen en voertuigen (Magazijnier)',
  'Restreint la visibilité aux seuls dépôts et véhicules autorisés (Magasinier)':
    'Beperkt de zichtbaarheid tot alleen de toegestane magazijnen en voertuigen (Magazijnier)',
  'Tab Button "My Movements"': 'Tabbladknop « Mijn Bewegingen »',
  'Bouton Onglet « Mes Mouvements »': 'Tabbladknop « Mijn Bewegingen »',
  "Subtab button to filter one's own movements":
    'Subtabbladknop om de eigen persoonlijke bewegingen te bekijken',
  'Bouton sous-onglet pour consulter ses mouvements personnels':
    'Subtabbladknop om de eigen persoonlijke bewegingen te bekijken',
  'Tab Button "Movements by Project / Site"': 'Tabbladknop « Bewegingen per Werf / Project »',
  'Bouton Onglet « Mouvements par Chantier / Projet »':
    'Tabbladknop « Bewegingen per Werf / Project »',
  'Subtab button to inspect assignments by project code':
    'Subtabbladknop om toewijzingen per werfnummer te bekijken',
  'Bouton sous-onglet pour consulter les affectations par numéro de chantier':
    'Subtabbladknop om toewijzingen per werfnummer te bekijken',
  'Selector Button "Filter by Department"': 'Keuzeknop « Filter op Afdeling »',
  'Bouton Sélecteur « Filtre par Département »': 'Keuzeknop « Filter op Afdeling »',
  'Dropdown selector to filter movements by specific department':
    'Keuzelijst om bewegingen van een specifieke afdeling te filteren',
  "Menu déroulant pour isoler les mouvements d'un service précis":
    'Keuzelijst om bewegingen van een specifieke afdeling te filteren',
  'Button "Export to CSV format"': 'Knop « Exporteren naar CSV-formaat »',
  'Bouton « Exporter au format CSV »': 'Knop « Exporteren naar CSV-formaat »',
  'Downloads CSV spreadsheet of filtered transactions for Excel':
    'Downloadt het spreadsheetbestand van de gefilterde bewegingen voor Excel',
  'Télécharge le fichier tableur des mouvements filtrés pour Excel':
    'Downloadt het spreadsheetbestand van de gefilterde bewegingen voor Excel',
  'Button "Delete / Cancel a Movement"': 'Knop « Een Beweging Verwijderen / Annuleren »',
  'Bouton « Supprimer / Annuler un Mouvement »': 'Knop « Een Beweging Verwijderen / Annuleren »',
  'Allows cancelling a movement and correcting stock count':
    'Maakt het mogelijk een foutieve beweging te annuleren en de voorraad te corrigeren',
  "Permet d'annuler un mouvement erroné et réajuster le stock":
    'Maakt het mogelijk een foutieve beweging te annuleren en de voorraad te corrigeren',
  'Warehouse Order Prep & Site Drive': 'Orderpicking Magazijn & Werf Drive',
  'Préparation Commandes Magasin & Drive Chantier': 'Orderpicking Magazijn & Werf Drive',
  'Buttons for material ordering, fulfillment and collection':
    'Knoppen van het aanvraagmandje, magazijnvoorbereiding en afhaling op het terrein',
  'Boutons du panier de demande, préparation magasin et retrait terrain':
    'Knoppen van het aanvraagmandje, magazijnvoorbereiding en afhaling op het terrein',
  'Button "Create Site Material Order"': 'Knop « Werf-materiaalbestelling Aanmaken »',
  'Bouton « Créer une Commande Matériel Chantier »': 'Knop « Werf-materiaalbestelling Aanmaken »',
  'Allows site staff to add items to cart and submit order to warehouse':
    'Stelt de arbeider of werfleider in staat artikelen aan het mandje toe te voegen en bij het magazijn te bestellen',
  "Permet à l'ouvrier ou conducteur d'ajouter au panier et commander au magasin":
    'Stelt de arbeider of werfleider in staat artikelen aan het mandje toe te voegen en bij het magazijn te bestellen',
  'Button "Approve or Reject Material Order"': 'Knop « Bestelling Goedkeuren of Weigeren »',
  'Bouton « Valider ou Refuser une Commande »': 'Knop « Bestelling Goedkeuren of Weigeren »',
  'Allows site manager or department head to approve orders in their scope':
    'Stelt de werfleider of afdelingsverantwoordelijke in staat bestellingen binnen zijn bereik goed te keuren',
  "Permet au chef de chantier ou responsable d'approuver les commandes de son périmètre":
    'Stelt de werfleider of afdelingsverantwoordelijke in staat bestellingen binnen zijn bereik goed te keuren',
  'Button "Warehouse Order Preparation Menu"': 'Knop « Menu Orderpicking Magazijn »',
  'Bouton « Menu Préparation des Commandes Magasin »': 'Knop « Menu Orderpicking Magazijn »',
  'Access to the fulfillment dashboard for storekeepers':
    'Toegang tot het dashboard met te picken bestellingen voor magazijniers',
  'Accès au tableau de bord des commandes à préparer pour les magasiniers':
    'Toegang tot het dashboard met te picken bestellingen voor magazijniers',
  'Button "Assign Order Preparation to Self"':
    'Knop « Orderpicking van een Bestelling aan Zichzelf Toewijzen »',
  "Bouton « S'assigner la Préparation d'une Commande »":
    'Knop « Orderpicking van een Bestelling aan Zichzelf Toewijzen »',
  'Allows storekeeper to claim order picking with timestamp':
    'Stelt de magazijnier in staat de pakbon toe te eigenen en de behandeling te tijdstempelen',
  "Permet au magasinier de s'attribuer le bon de préparation et horodater la prise en charge":
    'Stelt de magazijnier in staat de pakbon toe te eigenen en de behandeling te tijdstempelen',
  'Button "Mark Order Ready for Pickup"': 'Knop « Bestelling op "Klaar voor Afhaling" zetten »',
  'Bouton « Passer la Commande en "Prête au Retrait" »':
    'Knop « Bestelling op "Klaar voor Afhaling" zetten »',
  'Timestamps preparation completion and triggers readiness notification':
    'Registreert het einde van de voorbereiding en stuurt een melding naar de aanvrager',
  'Horodate la fin de préparation et envoie une alerte au demandeur':
    'Registreert het einde van de voorbereiding en stuurt een melding naar de aanvrager',
  'Button "Confirm Material Pickup (Stock Outflow)"':
    'Knop « Afhaling Materiaal Bevestigen (Voorraaduitgifte) »',
  'Bouton « Confirmer le Retrait Matériel (Sortie Stock) »':
    'Knop « Afhaling Materiaal Bevestigen (Voorraaduitgifte) »',
  'Confirms handoff, logs actual stock outflow movements and archives after 24h':
    'Bevestigt de daadwerkelijke afhaling, genereert de voorraadbewegingen en archiveert na 24u',
  'Valide le retrait effectif, génère les mouvements de stock et archive après 24h':
    'Bevestigt de daadwerkelijke afhaling, genereert de voorraadbewegingen en archiveert na 24u',
  'Button "Cancel / Delete an Order"': 'Knop « Een Bestelling Annuleren / Verwijderen »',
  'Bouton « Annuler / Supprimer une Commande »': 'Knop « Een Bestelling Annuleren / Verwijderen »',
  'Cancels an unfulfilled or rejected material order':
    'Annuleert een nog niet voorbereide of geweigerde bestelling',
  'Annule une commande non préparée ou rejetée':
    'Annuleert een nog niet voorbereide of geweigerde bestelling',
  'More Menu — Account & Preferences': 'Menu Meer — Account & Voorkeuren',
  'Menu Plus — Compte & Préférences': 'Menu Meer — Account & Voorkeuren',
  'Buttons from account section in the more menu':
    'Knoppen van de accountsectie in het algemene menu',
  'Boutons de la section compte dans le menu général':
    'Knoppen van de accountsectie in het algemene menu',
  'Button "My Profile & PIN Code"': 'Knop « Mijn Profiel & Wachtwoord »',
  'Bouton « Mon Profil & Code PIN »': 'Knop « Mijn Profiel & Wachtwoord »',
  'Allows user to modify their own secret PIN code':
    'Stelt de gebruiker in staat zijn eigen geheime wachtwoord/PIN te wijzigen',
  "Permet à l'utilisateur de modifier son propre code PIN secret":
    'Stelt de gebruiker in staat zijn eigen geheime wachtwoord/PIN te wijzigen',
  'Button "Language Switcher (French / English)"': 'Knop « Taalkeuze (FR / EN / NL) »',
  'Bouton « Sélecteur de Langue (Français / English) »': 'Knop « Taalkeuze (FR / EN / NL) »',
  'Language selector tile in the more menu':
    'Keuzeknop voor de taal van de applicatie in het menu',
  "Bouton de choix de la langue de l'application dans le menu":
    'Keuzeknop voor de taal van de applicatie in het menu',
  'Button / Selector "Company Valuation Currency"':
    'Knop / Keuzelijst « Waarderingsvaluta Bedrijf »',
  'Bouton / Sélecteur « Devise de Valorisation Entreprise »':
    'Knop / Keuzelijst « Waarderingsvaluta Bedrijf »',
  'Allows modifying company-wide currency (EUR, USD, CHF, CFA...)':
    'Maakt het mogelijk de globale valuta te wijzigen (EUR, USD, CHF, CFA...)',
  'Permet de changer la devise globale (EUR, USD, CHF, CFA...)':
    'Maakt het mogelijk de globale valuta te wijzigen (EUR, USD, CHF, CFA...)',
  'More Menu — Sites & Operations': 'Menu Meer — Werven & Operaties',
  'Menu Plus — Chantiers & Opérations': 'Menu Meer — Werven & Operaties',
  'Buttons for managing departments, job sites, labels and audits':
    'Knoppen voor het beheer van afdelingen, werven, etiketten en controles',
  'Boutons de gestion des départements, chantiers, étiquettes et audits':
    'Knoppen voor het beheer van afdelingen, werven, etiketten en controles',
  'Button "Departments & Sites Menu"': 'Knop « Menu Afdelingen & Werven »',
  'Bouton « Menu Départements & Chantiers »': 'Knop « Menu Afdelingen & Werven »',
  'General access to Departments & Sites sections in menu':
    'Algemene toegang tot de rubrieken Afdelingen en Werven in het menu',
  'Accès global aux rubriques Départements et Chantiers dans le menu':
    'Algemene toegang tot de rubrieken Afdelingen en Werven in het menu',
  'Button "Create / Edit a Department"': 'Knop « Afdeling Aanmaken / Bewerken »',
  'Bouton « Créer / Modifier un Département »': 'Knop « Afdeling Aanmaken / Bewerken »',
  'Add new departments and designate heads/deputies':
    'Nieuwe afdelingen toevoegen en verantwoordelijken/plaatsvervangers aanwijzen',
  'Ajout de nouveaux départements et nomination de responsables/suppléants':
    'Nieuwe afdelingen toevoegen en verantwoordelijken/plaatsvervangers aanwijzen',
  'Button "Delete a Department"': 'Knop « Afdeling Verwijderen »',
  'Bouton « Supprimer un Département »': 'Knop « Afdeling Verwijderen »',
  'Permanent deletion of a department': 'Definitieve verwijdering van een afdeling',
  "Suppression définitive d'un département": 'Definitieve verwijdering van een afdeling',
  'Button "Create / Edit a Job Site (Project)"': 'Knop « Werf (Project) Aanmaken / Bewerken »',
  'Bouton « Créer / Modifier un Chantier (Projet) »':
    'Knop « Werf (Project) Aanmaken / Bewerken »',
  'Add job sites, project numbers, site managers and deputies':
    'Werven, werfcodes, werfleiders en plaatsvervangers toevoegen',
  'Ajout de chantiers, codes chantiers, conducteurs de travaux et suppléants':
    'Werven, werfcodes, werfleiders en plaatsvervangers toevoegen',
  'Button "Delete a Job Site (Project)"': 'Knop « Werf (Project) Verwijderen »',
  'Bouton « Supprimer un Chantier (Projet) »': 'Knop « Werf (Project) Verwijderen »',
  'Permanent deletion of a job site': 'Definitieve verwijdering van een werf uit de database',
  "Suppression définitive d'un chantier de la base":
    'Definitieve verwijdering van een werf uit de database',
  'More Menu — Reports & Email Alerts': 'Menu Meer — Rapporten & E-mailmeldingen',
  'Menu Plus — Rapports & Alertes E-mail': 'Menu Meer — Rapporten & E-mailmeldingen',
  'Buttons for automated and manual stock report dispatches':
    'Knoppen voor automatische en handmatige verzending van voorraadrapporten',
  "Boutons d'envoi automatique et manuel des rapports de stock":
    'Knoppen voor automatische en handmatige verzending van voorraadrapporten',
  'Button "Automated Email Reports (Brevo)"': 'Knop « Automatische E-mailrapporten (Brevo) »',
  'Bouton « Rapports E-mail Automatiques (Brevo) »':
    'Knop « Automatische E-mailrapporten (Brevo) »',
  'Access to stock report scheduler and automatic email reports':
    'Toegang tot de planner voor het verzenden van voorraadrapporten per e-mail',
  "Accès au planificateur d'envoi de rapports de stock par e-mail":
    'Toegang tot de planner voor het verzenden van voorraadrapporten per e-mail',
  'Button "Trigger Immediate Email Dispatch"':
    'Knop « Onmiddellijke Verzending van een Rapport Starten »',
  "Bouton « Déclencher l'Envoi Immédiat d'un Rapport »":
    'Knop « Onmiddellijke Verzending van een Rapport Starten »',
  'Allows triggering on-demand immediate email report to team':
    'Maakt het mogelijk direct handmatig een rapport naar het team te sturen',
  "Permet de lancer l'envoi manuel instantané d'un rapport à l'équipe":
    'Maakt het mogelijk direct handmatig een rapport naar het team te sturen',
  'More Menu — System Administration & Security': 'Menu Meer — Systeembeheer & Beveiliging',
  'Menu Plus — Administration Système & Sécurité': 'Menu Meer — Systeembeheer & Beveiliging',
  'Buttons for technical settings, database, accounts and rights':
    'Knoppen voor technische instellingen, database, accounts en rechten',
  'Boutons de paramétrage technique, base, comptes et droits':
    'Knoppen voor technische instellingen, database, accounts en rechten',
  'Button "Brevo & SMTP Server Setup"': 'Knop « Configuratie Brevo & SMTP-server »',
  'Bouton « Configuration Brevo & Serveur SMTP »': 'Knop « Configuratie Brevo & SMTP-server »',
  'Configure Brevo API keys or SMTP credentials for real emails':
    'Instellen van Brevo API-sleutels of SMTP-gegevens voor echte e-mails',
  'Paramétrage des clés API Brevo ou identifiants SMTP pour les e-mails réels':
    'Instellen van Brevo API-sleutels of SMTP-gegevens voor echte e-mails',
  'Button "Categories & Article Families"': 'Knop « Categorieën & Artikelfamilies »',
  "Bouton « Catégories & Familles d'Articles »": 'Knop « Categorieën & Artikelfamilies »',
  'Manage item categories and subcategories':
    'Aanmaken, bewerken en indelen van families en subfamilies',
  'Création, modification et classement des familles et sous-familles':
    'Aanmaken, bewerken en indelen van families en subfamilies',
  'Button "Manage Depots & Warehouses"': 'Knop « Beheer van Depots & Magazijnen »',
  'Bouton « Gestion des Dépôts & Magasins »': 'Knop « Beheer van Depots & Magazijnen »',
  'Access list of warehouses, storage rooms and shops':
    'Toegang tot de lijst met magazijnen, opslagplaatsen en werkplaatsen',
  'Accès à la liste des entrepôts, magasins et ateliers':
    'Toegang tot de lijst met magazijnen, opslagplaatsen en werkplaatsen',
  'Button "Create a New Depot"': 'Knop « Nieuw Depot Aanmaken »',
  'Bouton « Créer un Nouveau Dépôt »': 'Knop « Nieuw Depot Aanmaken »',
  'Add a new depot within license quota limits':
    'Een depot toevoegen binnen de limiet van de licentieformule',
  "Ajout d'un dépôt dans la limite autorisée par le forfait":
    'Een depot toevoegen binnen de limiet van de licentieformule',
  'Button "Pause / Close a Depot"': 'Knop « Een Depot Pauzeren / Sluiten »',
  'Bouton « Mettre en Pause / Fermer un Dépôt »': 'Knop « Een Depot Pauzeren / Sluiten »',
  'Temporarily pause a depot preventing stock deductions':
    'Tijdelijke sluiting van een depot waardoor materiaaluitgiftes worden geblokkeerd',
  "Fermeture temporaire d'un dépôt bloquant les sorties de matériel":
    'Tijdelijke sluiting van een depot waardoor materiaaluitgiftes worden geblokkeerd',
  'Button "Delete a Depot"': 'Knop « Een Depot Verwijderen »',
  'Bouton « Supprimer un Dépôt »': 'Knop « Een Depot Verwijderen »',
  'Permanently remove a depot': 'Definitieve verwijdering van een depot uit de lijst',
  "Suppression définitive d'un dépôt de la liste":
    'Definitieve verwijdering van een depot uit de lijst',
  'Button "Manage Users & Teams"': 'Knop « Beheer van Gebruikers & Teams »',
  'Bouton « Gestion des Utilisateurs & Équipes »': 'Knop « Beheer van Gebruikers & Teams »',
  'Create, edit users, assign roles and authorized depots':
    'Aanmaken, bewerken, toewijzen van rollen en toegestane magazijnen',
  'Création, modification, affectation de rôle et de dépôts autorisés':
    'Aanmaken, bewerken, toewijzen van rollen en toegestane magazijnen',
  'Button "Force Password Reset"': 'Knop « Wachtwoordvernieuwing Verplichten »',
  'Bouton « Forcer Renouvellement du Mot de passe »':
    'Knop « Wachtwoordvernieuwing Verplichten »',
  'Requires user to set new password upon next login':
    'Verplicht de medewerker zijn wachtwoord te vernieuwen bij de volgende aanmelding',
  'Oblige le collaborateur à renouveler son mot de passe à sa prochaine connexion':
    'Verplicht de medewerker zijn wachtwoord te vernieuwen bij de volgende aanmelding',
  'Button "Block / Unblock an Account"': 'Knop « Een Account Blokkeren / Deblokkeren »',
  'Bouton « Bloquer / Débloquer un Compte »': 'Knop « Een Account Blokkeren / Deblokkeren »',
  'Instantly lock or unlock user access':
    'Onmiddellijke vergrendeling of ontgrendeling van een gebruikersaccount',
  "Verrouillage immédiat des accès d'un compte utilisateur":
    'Onmiddellijke vergrendeling of ontgrendeling van een gebruikersaccount',
  'Button "Permanently Delete a User"': 'Knop « Een Gebruiker Definitief Verwijderen »',
  'Bouton « Supprimer définitivement un Utilisateur »':
    'Knop « Een Gebruiker Definitief Verwijderen »',
  'Permanent removal of a user account': 'Definitieve verwijdering van een medewerkersaccount',
  "Suppression définitive d'un compte collaborateur":
    'Definitieve verwijdering van een medewerkersaccount',
  'Button / Right "View ALL company login logs"':
    'Knop / Recht « ALLE aanmeldingslogs van het bedrijf bekijken »',
  'Bouton / Droit « Consulter TOUS les logs de connexion »':
    'Knop / Recht « ALLE aanmeldingslogs van het bedrijf bekijken »',
  'If unchecked, user only sees their own personal login events for privacy':
    'Indien uitgevinkt, heeft de gebruiker uitsluitend toegang tot zijn eigen logs (AVG/GDPR)',
  "Si décoché, l'utilisateur n'a strictement accès qu'à ses propres logs (RGPD)":
    'Indien uitgevinkt, heeft de gebruiker uitsluitend toegang tot zijn eigen logs (AVG/GDPR)',
  'Button "Audit Log & Security"': 'Knop « Auditlogboek & Beveiliging »',
  "Bouton « Journal d'Audit & Sécurité »": 'Knop « Auditlogboek & Beveiliging »',
  'Access to full system audit log and administrative security events':
    'Toegang tot het volledige auditlogboek van beheer- en beveiligingsacties',
  "Accès au journal d'audit complet des actions administrateur et sécurité":
    'Toegang tot het volledige auditlogboek van beheer- en beveiligingsacties',
  'Button "View Activity Reports"': 'Knop « Activiteitenrapporten Bekijken »',
  "Bouton « Consulter les Rapports d'Activité »": 'Knop « Activiteitenrapporten Bekijken »',
  'Access to summary reports, consumption balance sheets and activity exports':
    'Toegang tot overzichtstaten, verbruiksbalansen en activiteitenexports',
  "Accès aux états récapitulatifs, bilans de consommation et exports d'activité":
    'Toegang tot overzichtstaten, verbruiksbalansen en activiteitenexports',
  'Button "Manage Roles & Permissions Matrix"': 'Knop « Beheer van Rollen & Rechtenmatrix »',
  'Bouton « Gestion des Rôles & Matrice des Permissions »':
    'Knop « Beheer van Rollen & Rechtenmatrix »',
  'Create roles, rename and configure checkbox for each button':
    'Rollen aanmaken, hernoemen en elk selectievakje per knop configureren',
  'Créer, renommer des rôles et configurer chaque case à cocher par bouton':
    'Rollen aanmaken, hernoemen en elk selectievakje per knop configureren',
  'Button "Multi-Device QR Code License Sharing"':
    'Knop « Licentie Delen via QR-code voor Meerdere Apparaten »',
  'Bouton « Partage de Licence QR Code Multi-Appareils »':
    'Knop « Licentie Delen via QR-code voor Meerdere Apparaten »',
  'Generates setup QR code to clone config on another device':
    'Genereert een QR-code om de configuratie naar een andere smartphone te klonen',
  'Génère un QR code pour cloner la configuration sur un autre smartphone':
    'Genereert een QR-code om de configuratie naar een andere smartphone te klonen',
  'Button "Supabase DB & Company Settings"': 'Knop « Supabase-database & Bedrijfsinstellingen »',
  'Bouton « Base Supabase & Paramètres Entreprise »':
    'Knop « Supabase-database & Bedrijfsinstellingen »',
  'Connect Supabase cloud backend, sync settings and keys':
    'Verbinding met de PostgreSQL/Supabase-database, synchronisatie en URL',
  'Connexion de la base PostgreSQL/Supabase, synchronisation et URL':
    'Verbinding met de PostgreSQL/Supabase-database, synchronisatie en URL',
  'Button "Company License & Plans"': 'Knop « Bedrijfslicentie & Formules »',
  'Bouton « Licence Entreprise & Forfaits »': 'Knop « Bedrijfslicentie & Formules »',
  'View company license contract, tiers and quotas':
    'Raadplegen van het licentiecontract, de formules en toegestane quota',
  'Consultation du contrat de licence, forfaits et quotas autorisés':
    'Raadplegen van het licentiecontract, de formules en toegestane quota',
  'More Menu — Documentation, Guides & Exports': 'Menu Meer — Documentatie, Gidsen & Exports',
  'Menu Plus — Documentation, Guides & Exports': 'Menu Meer — Documentatie, Gidsen & Exports',
  'Buttons for viewing user manuals, exports and documentation':
    'Knoppen voor het raadplegen van handleidingen, exports en PDF-gidsen',
  "Boutons de consultation des notices d'emploi, exports et manuels PDF":
    'Knoppen voor het raadplegen van handleidingen, exports en PDF-gidsen',
  'Button "Official User Manual (PDF)"': 'Knop « Officiële Gebruikershandleiding (PDF) »',
  "Bouton « Manuel d'Utilisation Officiel (PDF) »":
    'Knop « Officiële Gebruikershandleiding (PDF) »',
  'View and download complete A4 printable user guide':
    'Raadplegen en afdrukken/downloaden van de volledige A4 PDF-handleiding',
  'Consultation et impression/téléchargement du manuel PDF A4 complet':
    'Raadplegen en afdrukken/downloaden van de volledige A4 PDF-handleiding',
  'Button "Android Studio Export Procedure (APK/AAB)"':
    'Knop « Exportprocedure Android Studio (APK/AAB) »',
  'Bouton « Procédure Export Android Studio (APK/AAB) »':
    'Knop « Exportprocedure Android Studio (APK/AAB) »',
  'Guide to compile native Android mobile app with Capacitor':
    'Gids voor het compileren van de native mobiele app met Capacitor & Android',
  'Guide de compilation mobile native Capacitor & Android':
    'Gids voor het compileren van de native mobiele app met Capacitor & Android',
  'Button "Marketing Web Landing Page HTML"': 'Knop « HTML-code Promotionele Website »',
  'Bouton « Code HTML Site Web Promotionnel »': 'Knop « HTML-code Promotionele Website »',
  'HTML5/Tailwind showcase page source code to promote app':
    'HTML5/Tailwind-broncode van de presentatiepagina voor de promotiewebsite',
  'Code source HTML5/Tailwind de la page de présentation pour site vitrine':
    'HTML5/Tailwind-broncode van de presentatiepagina voor de promotiewebsite',
  'Button "Supabase CLI & SQL Migrations"': 'Knop « Supabase CLI-console & SQL-migraties »',
  'Bouton « Console Supabase CLI & Migrations SQL »':
    'Knop « Supabase CLI-console & SQL-migraties »',
  'SQL table scripts and Supabase CLI push commands':
    'SQL-scripts voor het aanmaken van tabellen en Supabase CLI-opdrachten',
  'Scripts SQL de création des tables et commandes CLI Supabase':
    'SQL-scripts voor het aanmaken van tabellen en Supabase CLI-opdrachten',
};

/**
 * Parameterized regex patterns for dynamic UI strings (English & French -> Dutch).
 */
const PATTERN_NL_RULES: Array<[RegExp, string]> = [
  [/^New version v([^\s]+) available$/i, 'Nieuwe versie v$1 beschikbaar'],
  [/^Nouvelle version v([^\s]+) disponible$/i, 'Nieuwe versie v$1 beschikbaar'],
  [/^Download Update \(v([^)]+)\)$/i, 'Update downloaden (v$1)'],
  [/^Télécharger la mise à jour \(v([^)]+)\)$/i, 'Update downloaden (v$1)'],
  [/^Schéma SQL \(v([^)]+)\) antérieur au schéma attendu \(v([^)]+)\)\.$/i, 'SQL-schema (v$1) ouder dan verwacht schema (v$2).'],
  [/^✏️ Editing Mode: Role "(.+)"$/i, '✏️ Bewerkingsmodus: Rol « $1 »'],
  [/^✏️ Mode Modification : Rôle « (.+) »$/i, '✏️ Bewerkingsmodus: Rol « $1 »'],
  [/^No button matching "(.+)"$/i, 'Geen knop komt overeen met « $1 »'],
  [/^Aucun bouton correspondant à « (.+) »$/i, 'Geen knop komt overeen met « $1 »'],
  [/^⚠️ Strict rule: Binôme must belong to the same department \("(.+)"\)\.$/i, '⚠️ Strikte regel: De binôme moet tot dezelfde afdeling behoren (« $1 »).'],
  [/^⚠️ Règle stricte : Le binôme doit obligatoirement appartenir au même département \(« (.+) »\)\.$/i, '⚠️ Strikte regel: De binôme moet tot dezelfde afdeling behoren (« $1 »).'],
  [/^You only view members of your department \((.+)\)\.$/i, 'U ziet alleen de medewerkers van uw afdeling ($1).'],
  [/^Vous visualisez uniquement les collaborateurs de votre département \((.+)\)\.$/i, 'U ziet alleen de medewerkers van uw afdeling ($1).'],
  [/^Basket\s+(\d+)$/i, 'Mandje $1'],
  [/^Panier\s+(\d+)$/i, 'Mandje $1'],
  [/^Order\s+#(.+)$/i, 'Bestelling #$1'],
  [/^Commande\s+#(.+)$/i, 'Bestelling #$1'],
  [/^(\d+)\s+item\(s\)\s+in\s+cart$/i, '$1 artikel(en) in mandje'],
  [/^(\d+)\s+article\(s\)\s+au\s+panier$/i, '$1 artikel(en) in mandje'],
  [/^(\d+)\s+active\s+order\(s\)$/i, '$1 lopende bestelling(en)'],
  [/^(\d+)\s+commande\(s\)\s+en\s+cours$/i, '$1 lopende bestelling(en)'],
  [/^(\d+)\s+allowed\s+depot\(s\)$/i, '$1 toegestane magazijn(en)'],
  [/^(\d+)\s+dépôt\(s\)\s+autorisé\(s\)$/i, '$1 toegestane magazijn(en)'],
  [/^(\d+)\s+selected$/i, '$1 geselecteerd'],
  [/^(\d+)\s+sélectionné\(s\)$/i, '$1 geselecteerd'],
  [/^(\d+)\s+assigned$/i, '$1 toegewezen'],
  [/^(\d+)\s+assigné\(s\)$/i, '$1 toegewezen'],
  [/^(\d+)\s+audited$/i, '$1 gecontroleerd'],
  [/^(\d+)\s+commandes\s+auditées$/i, '$1 gecontroleerde bestellingen'],
  [/^(\d+)\s+buttons$/i, '$1 knoppen'],
  [/^(\d+)\s+boutons$/i, '$1 knoppen'],
  [/^(\d+)\s+permission\(s\)$/i, '$1 recht(en)'],
  [/^(\d+)\s+role\(s\)$/i, '$1 rol(len)'],
  [/^(\d+)\s+rôle\(s\)$/i, '$1 rol(len)'],
  [/^(\d+)\s+user\(s\)$/i, '$1 gebruiker(s)'],
  [/^(\d+)\s+utilisateur\(s\)$/i, '$1 gebruiker(s)'],
];

/**
 * Ordered phrase-level and word-level replacement rules (English & French -> Dutch)
 * used as fallback for composite or dynamic strings not in EXACT_NL_DICTIONARY.
 */
const PHRASE_NL_REPLACEMENTS: Array<[RegExp, string]> = [
  // Multi-word English phrases
  [/\bEvery role is customizable\. The "Default" button restores recommended permissions from the specification\./gi, 'Elke rol kan worden aangepast. De knop « Standaard » herstelt de aanbevolen rechten uit de specificatie.'],
  [/\bChaque rôle peut être personnalisé\. Le bouton « Défaut » permet de revenir aux recommandations du document\./gi, 'Elke rol kan worden aangepast. De knop « Standaard » herstelt de aanbevolen rechten uit de specificatie.'],
  [/\bRestricted view\s*:/gi, 'Beperkte weergave:'],
  [/\bAffichage restreint\s*:/gi, 'Beperkte weergave:'],
  [/\bCross-department access active:/gi, 'Afdelingsoverschrijdende toegang actief:'],
  [/\bAccès inter-départements actif\s*:/gi, 'Afdelingsoverschrijdende toegang actief:'],
  [/\bTab Button\b/gi, 'Tabbladknop'],
  [/\bBell Button\b/gi, 'Belknop'],
  [/\bButton\b/gi, 'Knop'],
  [/\bLow Stock Alerts\b/gi, 'Meldingen Lage Voorraad'],
  [/\bOut of Stock\b/gi, 'Niet op voorraad'],
  [/\bLow stock\b/gi, 'Lage voorraad'],
  [/\bWarehouse\b/gi, 'Magazijn'],
  [/\bWarehouses\b/gi, 'Magazijnen'],
  [/\bDepots\b/gi, 'Depots'],
  [/\bDepot\b/gi, 'Depot'],
  [/\bJob Sites\b/gi, 'Werven'],
  [/\bJob Site\b/gi, 'Werf'],
  [/\bJob-Site\b/gi, 'Werf'],
  [/\bDepartments\b/gi, 'Afdelingen'],
  [/\bDepartment\b/gi, 'Afdeling'],
  [/\bProjects\b/gi, 'Projecten'],
  [/\bProject\b/gi, 'Project'],
  [/\bSuppliers\b/gi, 'Leveranciers'],
  [/\bSupplier\b/gi, 'Leverancier'],
  [/\bCategories\b/gi, 'Categorieën'],
  [/\bCategory\b/gi, 'Categorie'],
  [/\bSubcategories\b/gi, 'Subcategorieën'],
  [/\bSubcategory\b/gi, 'Subcategorie'],
  [/\bProducts\b/gi, 'Producten'],
  [/\bProduct\b/gi, 'Product'],
  [/\bItems\b/gi, 'Artikelen'],
  [/\bItem\b/gi, 'Artikel'],
  [/\bMovements\b/gi, 'Bewegingen'],
  [/\bMovement\b/gi, 'Beweging'],
  [/\bOrders\b/gi, 'Bestellingen'],
  [/\bOrder\b/gi, 'Bestelling'],
  [/\bUsers\b/gi, 'Gebruikers'],
  [/\bUser\b/gi, 'Gebruiker'],
  [/\bRoles\b/gi, 'Rollen'],
  [/\bRole\b/gi, 'Rol'],
  [/\bPermissions\b/gi, 'Rechten'],
  [/\bPermission\b/gi, 'Recht'],
  [/\bSettings\b/gi, 'Instellingen'],
  [/\bConfiguration\b/gi, 'Configuratie'],
  [/\bConnected\b/gi, 'Verbonden'],
  [/\bDisconnected\b/gi, 'Niet verbonden'],
  [/\bAvailable\b/gi, 'Beschikbaar'],
  [/\bUnavailable\b/gi, 'Niet beschikbaar'],
  [/\bRequired\b/gi, 'Vereist'],
  [/\bOptional\b/gi, 'Optioneel'],
  [/\bSuccess\b/gi, 'Succes'],
  [/\bError\b/gi, 'Fout'],
  [/\bWarning\b/gi, 'Waarschuwing'],
  [/\bLoading\b/gi, 'Laden'],
  [/\bSaving\b/gi, 'Opslaan'],
  [/\bSaved\b/gi, 'Opgeslagen'],
  [/\bDeleted\b/gi, 'Verwijderd'],
  [/\bUpdated\b/gi, 'Bijgewerkt'],
  [/\bCreated\b/gi, 'Aangemaakt'],
  [/\bCancel\b/gi, 'Annuleren'],
  [/\bConfirm\b/gi, 'Bevestigen'],
  [/\bValidate\b/gi, 'Valideren'],
  [/\bSearch\b/gi, 'Zoeken'],
  [/\bFilter\b/gi, 'Filteren'],
  [/\bRefresh\b/gi, 'Vernieuwen'],
  [/\bDownload\b/gi, 'Downloaden'],
  [/\bPrint\b/gi, 'Afdrukken'],
  [/\bExport\b/gi, 'Exporteren'],
  [/\bQuantity\b/gi, 'Aantal'],
  [/\bPrice\b/gi, 'Prijs'],
  [/\bTotal\b/gi, 'Totaal'],
  [/\bValue\b/gi, 'Waarde'],
  [/\bStock\b/gi, 'Voorraad'],
  [/\bInventory\b/gi, 'Inventaris'],
  [/\bCatalog\b/gi, 'Catalogus'],
  [/\bReference\b/gi, 'Referentie'],
  [/\bReferences\b/gi, 'Referenties'],
  [/\bBrand\b/gi, 'Merk'],
  [/\bModel\b/gi, 'Model'],
  [/\bLocation\b/gi, 'Locatie'],
  [/\bHistory\b/gi, 'Geschiedenis'],
  [/\bDetails\b/gi, 'Details'],
  [/\bSummary\b/gi, 'Samenvatting'],
  [/\bReport\b/gi, 'Rapport'],
  [/\bReports\b/gi, 'Rapporten'],
  [/\bLicense\b/gi, 'Licentie'],
  [/\bCompany\b/gi, 'Bedrijf'],
  [/\bDatabase\b/gi, 'Database'],
  [/\bVehicle\b/gi, 'Voertuig'],
  [/\bVehicles\b/gi, 'Voertuigen'],
  [/\bTransfer\b/gi, 'Overdracht'],
  [/\bSignature\b/gi, 'Handtekening'],
  [/\bApproved\b/gi, 'Goedgekeurd'],
  [/\bRejected\b/gi, 'Geweigerd'],
  [/\bPending\b/gi, 'In behandeling'],
  [/\bReady\b/gi, 'Klaar'],
  [/\bCollected\b/gi, 'Afgehaald'],
  [/\bCancelled\b/gi, 'Geannuleerd'],

  // Multi-word & common French phrases (for hardcoded French strings)
  [/\bRôle commande\s*:/gi, 'Bestellingsrol:'],
  [/\bDemandeur par défaut\b/gi, 'Standaard aanvrager'],
  [/\bOption "Préparateurs" non activée sur\b/gi, 'Optie "Orderpickers" niet geactiveerd op'],
  [/\bMagasins & Dépôts\b/gi, 'Magazijnen & Depots'],
  [/\bDépôt Principal\b/gi, 'Hoofdmagazijn'],
  [/\bDépôt Général\b/gi, 'Hoofdmagazijn'],
  [/\bTous les dépôts\b/gi, 'Alle magazijnen'],
  [/\bToutes les catégories\b/gi, 'Alle categorieën'],
  [/\bTous les départements\b/gi, 'Alle afdelingen'],
  [/\bChantiers \/ Projets\b/gi, 'Werven / Projecten'],
  [/\bChantier\b/gi, 'Werf'],
  [/\bChantiers\b/gi, 'Werven'],
  [/\bDépartement\b/gi, 'Afdeling'],
  [/\bDépartements\b/gi, 'Afdelingen'],
  [/\bMagasinier\b/gi, 'Magazijnier'],
  [/\bPréparateur\b/gi, 'Orderpicker'],
  [/\bPréparateurs\b/gi, 'Orderpickers'],
  [/\bDemandeur\b/gi, 'Aanvrager'],
  [/\bResponsable\b/gi, 'Verantwoordelijke'],
  [/\bSuppléant\b/gi, 'Plaatsvervanger'],
  [/\bSuppléants\b/gi, 'Plaatsvervangers'],
  [/\bCamionnette\b/gi, 'Bestelwagen'],
  [/\bCamionnettes\b/gi, 'Bestelwagens'],
  [/\bVéhicule\b/gi, 'Voertuig'],
  [/\bVéhicules\b/gi, 'Voertuigen'],
  [/\bCommande\b/gi, 'Bestelling'],
  [/\bCommandes\b/gi, 'Bestellingen'],
  [/\bPanier\b/gi, 'Mandje'],
  [/\bPaniers\b/gi, 'Mandjes'],
  [/\b Enregistrer\b/gi, ' Opslaan'],
  [/\bAnnuler\b/gi, 'Annuleren'],
  [/\bSupprimer\b/gi, 'Verwijderen'],
  [/\bModifier\b/gi, 'Bewerken'],
  [/\bFermer\b/gi, 'Sluiten'],
  [/\bAjouter\b/gi, 'Toevoegen'],
  [/\bRechercher\b/gi, 'Zoeken'],
  [/\bActualiser\b/gi, 'Vernieuwen'],
  [/\bTélécharger\b/gi, 'Downloaden'],
  [/\bImprimer\b/gi, 'Afdrukken'],
  [/\b Valider\b/gi, ' Bevestigen'],
  [/\bRefuser\b/gi, 'Weigeren'],
  [/\b Utilisateur\b/gi, ' Gebruiker'],
  [/\bUtilisateurs\b/gi, 'Gebruikers'],
  [/\bRôle\b/gi, 'Rol'],
  [/\bRôles\b/gi, 'Rollen'],
  [/\bEntreprise\b/gi, 'Bedrijf'],
  [/\bLicence\b/gi, 'Licentie'],
  [/\bParamètres\b/gi, 'Instellingen'],
  [/\bobligatoire\b/gi, 'verplicht'],
  [/\bintrouvable\b/gi, 'niet gevonden'],
  [/\bdisponible\b/gi, 'beschikbaar'],
  [/\bindisponible\b/gi, 'niet beschikbaar'],
];

const translationCache = new Map<string, string>();

/**
 * Translates an English or French UI string into Dutch (nl).
 */
export function translateTextToNl(rawText: string, frHint?: string): string {
  if (!rawText) return rawText;
  const trimmed = rawText.trim();
  if (!trimmed) return rawText;

  // Preserve leading and trailing whitespace
  const leadingMatch = rawText.match(/^\s*/);
  const trailingMatch = rawText.match(/\s*$/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const trailing = trailingMatch ? trailingMatch[0] : '';

  const cacheKey = frHint ? `${trimmed}|||${frHint.trim()}` : trimmed;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) {
    return leading + cached + trailing;
  }

  // 1. Direct lookup on trimmed text or frHint
  if (EXACT_NL_DICTIONARY[trimmed]) {
    const res = EXACT_NL_DICTIONARY[trimmed];
    translationCache.set(cacheKey, res);
    return leading + res + trailing;
  }
  if (frHint && EXACT_NL_DICTIONARY[frHint.trim()]) {
    const res = EXACT_NL_DICTIONARY[frHint.trim()];
    translationCache.set(cacheKey, res);
    return leading + res + trailing;
  }

  // 2. Pattern regex rules
  for (const [regex, replacement] of PATTERN_NL_RULES) {
    if (regex.test(trimmed)) {
      const res = trimmed.replace(regex, replacement);
      translationCache.set(cacheKey, res);
      return leading + res + trailing;
    }
    if (frHint && regex.test(frHint.trim())) {
      const res = frHint.trim().replace(regex, replacement);
      translationCache.set(cacheKey, res);
      return leading + res + trailing;
    }
  }

  // 3. Phrase & word-level replacements
  let result = trimmed;
  for (const [regex, replacement] of PHRASE_NL_REPLACEMENTS) {
    result = result.replace(regex, replacement);
  }

  translationCache.set(cacheKey, result);
  return leading + result + trailing;
}

/**
 * Helper for inline trilingual expressions:
 * - 'fr' -> returns fr
 * - 'en' -> returns en
 * - 'nl' -> returns nl if provided, otherwise translates en/fr to Dutch
 */
export function tr(language: Language, fr: string, en: string, nl?: string): string {
  if (language === 'fr') return fr;
  if (language === 'en') return en;
  if (nl !== undefined) return nl;
  return translateTextToNl(en, fr);
}

const originalTextNodes = new WeakMap<Text, string>();
const originalElementAttrs = new WeakMap<Element, Map<string, string>>();
const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'aria-label'] as const;

/**
 * React hook that automatically translates any remaining untranslated DOM text nodes
 * and attributes (placeholder, title, aria-label) when language === 'nl', and restores
 * them when switching back to 'fr' or 'en'.
 */
export function useDutchDomTranslator(language: Language): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language;

    let isApplying = false;

    const processTextNode = (node: Text) => {
      const parent = node.parentElement;
      if (!parent) return;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') return;

      const currentVal = node.nodeValue || '';
      if (!currentVal.trim()) return;

      if (language === 'nl') {
        if (!originalTextNodes.has(node)) {
          originalTextNodes.set(node, currentVal);
        }
        const sourceVal = originalTextNodes.get(node) || currentVal;
        const translated = translateTextToNl(sourceVal);
        if (translated !== currentVal) {
          node.nodeValue = translated;
        }
      } else {
        const orig = originalTextNodes.get(node);
        if (orig !== undefined && orig !== currentVal) {
          node.nodeValue = orig;
        }
        originalTextNodes.delete(node);
      }
    };

    const processElement = (el: Element) => {
      for (const attr of TRANSLATABLE_ATTRS) {
        const currentAttr = el.getAttribute(attr);
        if (!currentAttr || !currentAttr.trim()) continue;

        let attrMap = originalElementAttrs.get(el);
        if (language === 'nl') {
          if (!attrMap) {
            attrMap = new Map<string, string>();
            originalElementAttrs.set(el, attrMap);
          }
          if (!attrMap.has(attr)) {
            attrMap.set(attr, currentAttr);
          }
          const sourceAttr = attrMap.get(attr) || currentAttr;
          const translated = translateTextToNl(sourceAttr);
          if (translated !== currentAttr) {
            el.setAttribute(attr, translated);
          }
        } else if (attrMap && attrMap.has(attr)) {
          const orig = attrMap.get(attr)!;
          if (orig !== currentAttr) {
            el.setAttribute(attr, orig);
          }
          attrMap.delete(attr);
        }
      }
    };

    const walkAndTranslate = (root: Node) => {
      if (isApplying) return;
      isApplying = true;
      try {
        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
        );
        let current: Node | null = walker.currentNode;
        while (current) {
          if (current.nodeType === Node.TEXT_NODE) {
            processTextNode(current as Text);
          } else if (current.nodeType === Node.ELEMENT_NODE) {
            processElement(current as Element);
          }
          current = walker.nextNode();
        }
      } finally {
        isApplying = false;
      }
    };

    walkAndTranslate(document.body);

    if (language !== 'nl') {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (isApplying) return;
      isApplying = true;
      try {
        for (const m of mutations) {
          if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
            originalTextNodes.set(m.target as Text, m.target.nodeValue || '');
            processTextNode(m.target as Text);
          } else if (m.type === 'childList') {
            m.addedNodes.forEach((added) => {
              if (added.nodeType === Node.TEXT_NODE) {
                processTextNode(added as Text);
              } else if (added.nodeType === Node.ELEMENT_NODE) {
                processElement(added as Element);
                const subWalker = document.createTreeWalker(
                  added,
                  NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
                );
                let sub: Node | null = subWalker.nextNode();
                while (sub) {
                  if (sub.nodeType === Node.TEXT_NODE) {
                    processTextNode(sub as Text);
                  } else if (sub.nodeType === Node.ELEMENT_NODE) {
                    processElement(sub as Element);
                  }
                  sub = subWalker.nextNode();
                }
              }
            });
          }
        }
      } finally {
        isApplying = false;
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [language]);
}
