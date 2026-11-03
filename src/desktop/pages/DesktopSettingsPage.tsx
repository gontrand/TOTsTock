import React, { useEffect, useState } from 'react';
import {
  Award,
  Bell,
  BookOpen,
  Building2,
  FolderTree,
  Info,
  Mail,
  Monitor,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  Users,
  Warehouse,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { DesktopSettingsSection } from '../types';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION } from '../../appVersion';
import {
  DEFAULT_DESKTOP_SYSTEM_SETTINGS,
  DesktopSystemSettings,
  getDesktopSystemSettings,
  isDesktopApp,
  setDesktopSystemSettings,
} from '../../services/desktopBridge';
import {
  DesktopTargetOs,
  buildDesktopInstallerPackage,
} from '../../utils/desktopInstallerDownload';

interface DesktopSettingsPageProps {
  initialSection?: DesktopSettingsSection;
  onChangeSection?: (section: DesktopSettingsSection) => void;
  onNavigatePrintStation?: () => void;
}

export const DesktopSettingsPage: React.FC<DesktopSettingsPageProps> = ({
  initialSection = 'profile',
  onChangeSection,
  onNavigatePrintStation,
}) => {
  const {
    currentUser,
    users,
    roles,
    depots,
    subCategories,
    departments,
    projects,
    settings,
    updateSetting,
    license,
    userHasPermission,
    saveSubCategory,
    deleteSubCategory,
    saveDepot,
  } = useApp();

  const [section, setSection] = useState<DesktopSettingsSection>(initialSection);
  const [sysSettings, setSysSettings] = useState<DesktopSystemSettings>(
    DEFAULT_DESKTOP_SYSTEM_SETTINGS
  );

  // Forms state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newDepotName, setNewDepotName] = useState('');
  const [newDepotAddress, setNewDepotAddress] = useState('');
  const [companyNameInput, setCompanyNameInput] = useState(
    settings.company_name || ''
  );
  const [smtpFromEmail, setSmtpFromEmail] = useState(settings.smtp_from_email || '');
  const [smtpFromName, setSmtpFromName] = useState(settings.smtp_from_name || '');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [installerLinks, setInstallerLinks] = useState<
    Partial<Record<DesktopTargetOs, { url: string; fileName: string }>>
  >({});

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (isDesktopApp()) {
      getDesktopSystemSettings().then(setSysSettings);
    }
  }, []);

  useEffect(() => {
    if (section !== 'about' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return;
    }
    const createdUrls: string[] = [];
    const nextLinks: Partial<Record<DesktopTargetOs, { url: string; fileName: string }>> = {};
    for (const os of ['linux', 'windows', 'mac'] as DesktopTargetOs[]) {
      try {
        const pkg = buildDesktopInstallerPackage(os);
        const blob = new Blob([new Uint8Array(pkg.bytes)], { type: pkg.mimeType });
        const url = URL.createObjectURL(blob);
        createdUrls.push(url);
        nextLinks[os] = { url, fileName: pkg.fileName };
      } catch {
        // Ignore in headless tests
      }
    }
    setInstallerLinks(nextLinks);
    return () => {
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [section]);

  const navItems: Array<{
    id: DesktopSettingsSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    visible: boolean;
  }> = [
    { id: 'profile', label: 'Profil et sécurité', icon: UserIcon, visible: true },
    {
      id: 'users_roles',
      label: 'Utilisateurs et rôles',
      icon: Users,
      visible: userHasPermission('perm_config_users'),
    },
    {
      id: 'depots',
      label: 'Dépôts & Véhicules',
      icon: Warehouse,
      visible: userHasPermission('perm_config_depots'),
    },
    {
      id: 'categories',
      label: 'Catégories articles',
      icon: FolderTree,
      visible: userHasPermission('perm_config_cats'),
    },
    {
      id: 'departments_projects',
      label: 'Départements & Projets',
      icon: Building2,
      visible: userHasPermission('perm_config_depts'),
    },
    {
      id: 'emails_smtp',
      label: 'Entreprise & E-mails SMTP',
      icon: Mail,
      visible:
        userHasPermission('perm_config_smtp') || userHasPermission('perm_config_company'),
    },
    {
      id: 'license',
      label: 'Licence & Formule',
      icon: Award,
      visible: userHasPermission('perm_config_license'),
    },
    { id: 'print_station', label: "Poste d'impression", icon: Printer, visible: true },
    { id: 'documentation', label: 'Documentation', icon: BookOpen, visible: true },
    { id: 'about', label: 'À propos & Installeurs', icon: Info, visible: true },
  ];

  const handleToggleSysSetting = async (
    key: keyof DesktopSystemSettings,
    value: boolean
  ) => {
    const updated = await setDesktopSystemSettings({ [key]: value });
    setSysSettings(updated);
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      <aside className="w-68 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-1 overflow-y-auto">
        <div className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
          Administration & Préférences
        </div>
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === 'print_station' && onNavigatePrintStation) {
                    onNavigatePrintStation();
                    return;
                  }
                  setSection(item.id);
                  onChangeSection?.(item.id);
                  setSaveMessage(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors text-left ${
                  active
                    ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
      </aside>

      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6 text-xs">
          {saveMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
              {saveMessage}
            </div>
          )}

          {section === 'profile' && (
            <div className="space-y-5">
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-orange-600" />
                  Profil opérateur & Sécurité
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                    <div className="text-slate-400">Nom complet</div>
                    <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">
                      {currentUser?.name || '—'} ({currentUser?.trigram || '—'})
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                    <div className="text-slate-400">Adresse e-mail / Département</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {currentUser?.email || 'Locale'} • {currentUser?.department || 'Général'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-orange-600" />
                  Intégration système du poste de bureau (Barre système & Notifications)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-200">
                        Garder le poste actif dans la barre système à la fermeture
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Continue de recevoir et d'imprimer les étiquettes en arrière-plan
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={sysSettings.keepInTrayOnClose}
                      onChange={(e) =>
                        handleToggleSysSetting('keepInTrayOnClose', e.target.checked)
                      }
                      className="rounded text-orange-600"
                    />
                  </label>

                  <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-200">
                        Lancer au démarrage de la session
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Idéal pour un PC dédié au comptoir magasin (désactivé par défaut)
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={sysSettings.launchAtLogin}
                      onChange={(e) =>
                        handleToggleSysSetting('launchAtLogin', e.target.checked)
                      }
                      className="rounded text-orange-600"
                    />
                  </label>

                  <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer col-span-2">
                    <div className="flex items-center gap-2.5">
                      <Bell className="w-4 h-4 text-orange-600" />
                      <div>
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          Activer les notifications système natives (Windows / macOS / Linux)
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Alerte lors d'une commande à valider, d'une commande à préparer, d'un échec d'impression ou d'une rupture
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={sysSettings.notificationsEnabled}
                      onChange={(e) =>
                        handleToggleSysSetting('notificationsEnabled', e.target.checked)
                      }
                      className="rounded text-orange-600"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {section === 'users_roles' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Utilisateurs ({users.length}) & Rôles ({roles.length})
              </h2>
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-2 px-3">Trigramme</th>
                    <th className="py-2 px-3">Nom</th>
                    <th className="py-2 px-3">E-mail</th>
                    <th className="py-2 px-3">Département</th>
                    <th className="py-2 px-3">Rôle</th>
                    <th className="py-2 px-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {users.map((u) => {
                    const roleName =
                      roles.find((r) => r.id === u.role_id)?.name || `Rôle #${u.role_id}`;
                    return (
                      <tr key={String(u.id)}>
                        <td className="py-2 px-3 font-mono font-bold text-orange-600">
                          {u.trigram}
                        </td>
                        <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">
                          {u.name}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-500">{u.email || '—'}</td>
                        <td className="py-2 px-3">{u.department || '—'}</td>
                        <td className="py-2 px-3 font-semibold">{roleName}</td>
                        <td className="py-2 px-3">
                          {u.is_blocked ? (
                            <span className="text-rose-600 font-bold">Bloqué</span>
                          ) : (
                            <span className="text-emerald-600 font-bold">Actif</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {section === 'depots' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Dépôts, Magasins & Véhicules ({depots.length})
              </h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newDepotName.trim()) return;
                  await saveDepot({
                    name: newDepotName.trim(),
                    address: newDepotAddress.trim(),
                    is_active: true,
                    type: 'FIXED',
                  });
                  setNewDepotName('');
                  setNewDepotAddress('');
                  setSaveMessage('Dépôt créé.');
                }}
                className="grid grid-cols-12 gap-2"
              >
                <input
                  type="text"
                  value={newDepotName}
                  onChange={(e) => setNewDepotName(e.target.value)}
                  placeholder="Nom du nouveau dépôt..."
                  className="col-span-5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <input
                  type="text"
                  value={newDepotAddress}
                  onChange={(e) => setNewDepotAddress(e.target.value)}
                  placeholder="Adresse ou localisation..."
                  className="col-span-5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <button
                  type="submit"
                  className="col-span-2 py-1.5 px-3 rounded-lg font-bold bg-orange-600 text-white"
                >
                  + Ajouter
                </button>
              </form>

              <div className="grid grid-cols-2 gap-3">
                {depots.map((d) => (
                  <div
                    key={String(d.id)}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{d.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {d.type || 'FIXED'} {d.address ? `• ${d.address}` : ''}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        d.is_active !== false
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {d.is_active !== false ? 'Ouvert' : 'Fermé'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 'categories' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Catégories d'articles ({subCategories.length})
              </h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newCategoryName.trim()) return;
                  await saveSubCategory(newCategoryName.trim());
                  setNewCategoryName('');
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Nouvelle catégorie..."
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg font-bold bg-orange-600 text-white"
                >
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </form>
              <div className="grid grid-cols-3 gap-2">
                {subCategories.map((sc) => (
                  <div
                    key={sc.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between"
                  >
                    <span className="font-semibold">{sc.name}</span>
                    <button
                      type="button"
                      onClick={() => deleteSubCategory(sc.id)}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 'departments_projects' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Départements ({departments.length}) & Chantiers ({projects.length})
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-500 uppercase text-[11px]">Départements</h3>
                  {departments.map((d) => (
                    <div
                      key={d.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between"
                    >
                      <span className="font-bold">{d.name}</span>
                      {d.is_preparer_dept && (
                        <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold">
                          Préparateurs
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-500 uppercase text-[11px]">
                    Chantiers / Projets
                  </h3>
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between"
                    >
                      <span className="font-mono font-bold text-orange-600">
                        {p.project_number}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300 truncate ml-2">
                        {p.project_name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'emails_smtp' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (companyNameInput.trim()) {
                  updateSetting('company_name', companyNameInput.trim());
                }
                updateSetting('smtp_from_email', smtpFromEmail.trim());
                updateSetting('smtp_from_name', smtpFromName.trim());
                setSaveMessage('Paramètres entreprise et expéditeur enregistrés.');
              }}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
            >
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Identité Entreprise & Expéditeur E-mails
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1">Nom de l'entreprise</label>
                  <input
                    type="text"
                    value={companyNameInput}
                    onChange={(e) => setCompanyNameInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Nom d'expéditeur e-mail</label>
                  <input
                    type="text"
                    value={smtpFromName}
                    onChange={(e) => setSmtpFromName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold mb-1">Adresse e-mail d'expédition</label>
                  <input
                    type="email"
                    value={smtpFromEmail}
                    onChange={(e) => setSmtpFromEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg font-bold bg-orange-600 text-white"
              >
                Enregistrer
              </button>
            </form>
          )}

          {section === 'license' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Licence & Formule d'abonnement
              </h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <div className="text-slate-400">Formule active</div>
                  <div className="text-lg font-black uppercase text-orange-600 mt-1">
                    {license?.plan_type || 'FREE'}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <div className="text-slate-400">Entreprise titulaire</div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                    {settings.company_name || '—'}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <div className="text-slate-400">Statut</div>
                  <div className="text-sm font-bold text-emerald-600 mt-1">
                    {license?.status || 'ACTIVE'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === 'documentation' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Documentation & Guides d'exploitation
              </h2>
              <ul className="space-y-2 text-slate-600 dark:text-slate-300 list-disc pl-5">
                <li>
                  <strong>Interface Bureau (≥ 1024 px)</strong> : Raccourcis clavier (<code>Ctrl+K</code> palette, <code>/</code> recherche, <code>?</code> aide), douchette USB HID automatique (&lt; 50 ms).
                </li>
                <li>
                  <strong>Poste d'impression & Zebra ZPL</strong> : Impression silencieuse sur imprimante système ou envoi ZPL II direct sur port TCP 9100 (`docs/INTEGRATION_BUREAU.md`).
                </li>
                <li>
                  <strong>Import CSV</strong> : Jusqu'à 5 000 articles par lot avec neutralisation des formules tableur et respect du quota de licence.
                </li>
              </ul>
            </div>
          )}

          {section === 'about' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                TOT Stock — Version {APP_VERSION} (Schéma SQL {EXPECTED_SCHEMA_VERSION})
              </h2>
              <p className="text-slate-500">
                Solution de gestion de stock multi-dépôts, préparation de commandes par scan et impression d'étiquettes.
              </p>
              <div className="grid grid-cols-3 gap-3 pt-2">
                {installerLinks.linux && (
                  <a
                    href={installerLinks.linux.url}
                    download={installerLinks.linux.fileName}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-orange-500 font-bold text-center"
                  >
                    Télécharger Linux (.deb)
                  </a>
                )}
                {installerLinks.windows && (
                  <a
                    href={installerLinks.windows.url}
                    download={installerLinks.windows.fileName}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-orange-500 font-bold text-center"
                  >
                    Télécharger Windows (.exe)
                  </a>
                )}
                {installerLinks.mac && (
                  <a
                    href={installerLinks.mac.url}
                    download={installerLinks.mac.fileName}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-orange-500 font-bold text-center"
                  >
                    Télécharger macOS (.app.zip)
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
