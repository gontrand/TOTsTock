import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { SearchableSelect } from './SearchableSelect';
import { User, Role } from '../types';
import { generateTrigram } from '../utils/crypto';
import { adminResetPassword } from '../services/adminUsersService';
import { getClientSupabase } from '../services/clientSupabase';
import {
  X,
  Users,
  Shield,
  Search,
  Edit2,
  Lock,
  Unlock,
  Trash2,
  CheckSquare,
  Square,
  KeyRound,
  Key,
  Mail,
  Building,
  ChevronDown,
  ChevronUp,
  Check,
  Filter,
  Sparkles,
  Package,
  Eye,
  EyeOff,
  RotateCcw,
} from 'lucide-react';
import {
  MENU_PERMISSION_GROUPS,
  ALL_MENU_BUTTON_KEYS,
  MenuGroup,
  MenuPermissionButton,
} from '../data/permissionMatrix';
import { RECOMMENDED_ROLES_SPEC } from '../data/initialData';
import { tr } from '../i18n/dutchTranslator';
import {
  requestGuardedNavigation,
  scrollToAndFocusForm,
  useRegisterUnsavedForm,
} from '../services/unsavedChangesGuard';

export const UsersRolesModal: React.FC = () => {
  const {
    usersRolesModal,
    setUsersRolesModal,
    users,
    allUsers,
    roles,
    departments,
    depots,
    saveUser,
    deleteUser,
    toggleBlockUser,
    saveRole,
    deleteRole,
    resetRolesToRecommended,
    userHasPermission,
    currentUser,
    canViewCrossDepartment,
    supabaseUrl,
    supabaseKey,
    isSupabaseConnected,
    syncFromSupabase,
    language,
    t,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'users' | 'roles'>(
    usersRolesModal.tab || 'users'
  );

  const wasModalOpenRef = React.useRef(false);

  useEffect(() => {
    if (usersRolesModal.open && usersRolesModal.tab) {
      setActiveTab(usersRolesModal.tab);
    }
  }, [usersRolesModal.open, usersRolesModal.tab]);

  useEffect(() => {
    if (usersRolesModal.open && !wasModalOpenRef.current) {
      wasModalOpenRef.current = true;
      if (isSupabaseConnected) {
        syncFromSupabase().catch(() => {});
      }
    } else if (!usersRolesModal.open) {
      wasModalOpenRef.current = false;
    }
  }, [usersRolesModal.open, isSupabaseConnected, syncFromSupabase]);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && usersRolesModal.open) {
        setUsersRolesModal({ open: false, tab: activeTab });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [usersRolesModal.open, activeTab, setUsersRolesModal]);

  const isSuperAdmin = Number(currentUser?.role_id) === 0;
  const isDeptManager = Number(currentUser?.role_id) === 8;

  const managedDeptNames = useMemo(() => {
    const callerIdStr = String(currentUser?.id || '');
    const list: string[] = [];
    departments.forEach((d) => {
      const isMgr = String(d.manager_id) === callerIdStr;
      const isDeputy = d.deputy_manager_ids?.some((id) => String(id) === callerIdStr);
      if (isMgr || isDeputy) list.push(d.name);
    });
    if (currentUser?.department && !list.includes(currentUser.department)) {
      list.push(currentUser.department);
    }
    return list;
  }, [departments, currentUser]);

  const availableRolesToAssign = useMemo(() => {
    if (isDeptManager) {
      return roles.filter((r) => Number(r.id) === 4 || Number(r.id) === 9);
    }
    if (!isSuperAdmin) {
      return roles.filter((r) => Number(r.id) !== 0);
    }
    return roles;
  }, [roles, isDeptManager, isSuperAdmin]);

  // User form state (Défaut rôle Opérateur = 4 selon PDF)
  const [editingUserId, setEditingUserId] = useState<string | number | null>(null);
  const [userName, setUserName] = useState('');
  const [userTrigram, setUserTrigram] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userDepartment, setUserDepartment] = useState(() => managedDeptNames[0] || currentUser?.department || 'Général');
  const [userPassword, setUserPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [userRoleId, setUserRoleId] = useState<string>('4');
  const [userMustChangePin, setUserMustChangePin] = useState(true);
  const [userIsPreparer, setUserIsPreparer] = useState(false);
  const [userBinomeId, setUserBinomeId] = useState<string | number | ''>('');
  const [allDepotsAllowed, setAllDepotsAllowed] = useState(isSuperAdmin);
  const [userAllowedDepots, setUserAllowedDepots] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userFormMsg, setUserFormMsg] = useState('');

  // Password generator for temporary passwords
  const handleGeneratePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
    let pwd = 'Tot-';
    for (let i = 0; i < 6; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setUserPassword(pwd);
    setShowPassword(true);
  };

  // Role form state
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [roleName, setRoleName] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [roleFormMsg, setRoleFormMsg] = useState('');

  // Form DOM Refs for direct auto-scrolling on edit click
  const userFormRef = useRef<HTMLFormElement | null>(null);
  const userNameInputRef = useRef<HTMLInputElement | null>(null);
  const roleFormRef = useRef<HTMLFormElement | null>(null);
  const roleNameInputRef = useRef<HTMLInputElement | null>(null);

  const resetUserFormState = () => {
    setEditingUserId(null);
    setUserName('');
    setUserTrigram('');
    setUserEmail('');
    setUserPassword('');
    setShowPassword(false);
    setUserDepartment(managedDeptNames[0] || currentUser?.department || 'Général');
    setUserRoleId('4');
    setUserMustChangePin(true);
    setUserIsPreparer(false);
    setUserBinomeId('');
    setAllDepotsAllowed(isSuperAdmin);
    setUserAllowedDepots([]);
    setUserFormMsg('');
  };

  const resetRoleFormState = () => {
    setEditingRoleId(null);
    setRoleName('');
    setSelectedPerms([]);
    setRoleFormMsg('');
  };

  const performSaveUser = async (): Promise<boolean> => {
    setUserFormMsg('');

    if (!userName.trim()) {
      setUserFormMsg(tr(language, 'Le nom est obligatoire.', 'Name is required.'));
      return false;
    }

    if (!editingUserId && !userEmail.trim()) {
      setUserFormMsg(tr(language, "L'adresse e-mail professionnelle est obligatoire pour créer un compte.", "Email is required to create an account."));
      return false;
    }

    if (userPassword.trim() && userPassword.trim().length < 6) {
      setUserFormMsg(
        tr(language, 'Le mot de passe initial doit comporter au moins 6 caractères.', 'Initial password must be at least 6 characters.')
      );
      return false;
    }

    const selectedDepObj = departments.find((d) => d.name === userDepartment);
    const deptAllowsPreparers = Boolean(selectedDepObj?.is_preparer_dept);
    const finalIsPreparer = deptAllowsPreparers ? userIsPreparer : false;
    const targetRoleId = parseInt(userRoleId) || 4;

    if (targetRoleId === 0 && !isSuperAdmin) {
      setUserFormMsg('Seul un Super Administrateur (rôle 0) peut attribuer le rôle Super Admin.');
      return false;
    }

    // Délégation Responsable de département (PDF Chapitre 4)
    if (isDeptManager) {
      if (targetRoleId !== 4 && targetRoleId !== 9) {
        setUserFormMsg('Délégation Responsable de département : vous ne pouvez créer que des comptes Opérateur (rôle 4) ou Intérimaire (rôle 9).');
        return false;
      }
      const deptNorm = (userDepartment || '').toLowerCase().trim();
      const allowedDeptsNorm = managedDeptNames.map((n) => n.toLowerCase().trim());
      if (!allowedDeptsNorm.includes(deptNorm)) {
        setUserFormMsg(`Délégation Responsable de département : vous ne pouvez assigner que votre département (${managedDeptNames.join(', ')}).`);
        return false;
      }
    }

    const selectedBinome = users.find((u) => String(u.id) === String(userBinomeId));
    if (userBinomeId && selectedBinome) {
      const binomeDept = (selectedBinome.department || '').toLowerCase().trim();
      const curDept = (userDepartment || '').toLowerCase().trim();
      if (binomeDept !== curDept) {
        setUserFormMsg(
          tr(language, `Règle stricte : Le binôme (${selectedBinome.name}) doit obligatoirement appartenir au même département (« ${userDepartment} »).`, `Strict rule: Binôme must belong to the same department ("${userDepartment}").`)
        );
        return false;
      }
    }

    const payload: Partial<User> = {
      id: editingUserId || undefined,
      name: userName.trim(),
      trigram: (userTrigram || generateTrigram(userName)).toUpperCase(),
      email: userEmail.trim(),
      department: userDepartment,
      role_id: targetRoleId,
      allowed_depots: allDepotsAllowed ? ['*'] : userAllowedDepots,
      must_change_pin: userMustChangePin,
      is_preparer: finalIsPreparer,
      binome_id: userBinomeId !== '' ? userBinomeId : null,
      binome_name: selectedBinome ? selectedBinome.name : null,
    };

    const res = await saveUser(payload, userPassword.trim() || undefined);
    if (!res.success) {
      setUserFormMsg(res.message || (tr(language, 'Erreur enregistrement', 'Error saving user')));
      return false;
    }

    if (res.message && res.message.includes('Mot de passe temporaire')) {
      alert(res.message);
    }

    resetUserFormState();
    return true;
  };

  const performSaveRole = async (): Promise<boolean> => {
    if (!roleName.trim()) {
      setRoleFormMsg(tr(language, 'Le nom du rôle est obligatoire.', 'Role name is required.'));
      return false;
    }

    const isSuperAdminCaller = Number(currentUser?.role_id) === 0;
    if (editingRoleId === 0 && !isSuperAdminCaller) {
      setRoleFormMsg('Seul un Super Administrateur peut modifier le rôle Super Admin.');
      return false;
    }
    if (selectedPerms.includes('*') && !isSuperAdminCaller) {
      setRoleFormMsg('Seul un Super Administrateur peut attribuer la permission universelle "*".');
      return false;
    }

    const ok = await saveRole({
      id: editingRoleId || undefined,
      name: roleName.trim(),
      permissions: selectedPerms,
    });
    if (!ok) return false;

    resetRoleFormState();
    return true;
  };

  const isUserFormDirty =
    usersRolesModal.open &&
    activeTab === 'users' &&
    (editingUserId !== null || Boolean(userName.trim() || userEmail.trim() || userPassword.trim()));

  const isRoleFormDirty =
    usersRolesModal.open &&
    activeTab === 'roles' &&
    (editingRoleId !== null || Boolean(roleName.trim()));

  useRegisterUnsavedForm({
    id: 'mobile-users-roles-modal',
    isDirty: isUserFormDirty || isRoleFormDirty,
    label: isUserFormDirty
      ? editingUserId !== null
        ? tr(language, `Modification de l’utilisateur (${userName || userTrigram})`, `Editing user (${userName || userTrigram})`, `Gebruiker bewerken (${userName || userTrigram})`)
        : tr(language, 'Nouvel utilisateur', 'New user', 'Nieuwe gebruiker')
      : editingRoleId !== null
        ? tr(language, `Modification du rôle (${roleName})`, `Editing role (${roleName})`, `Rol bewerken (${roleName})`)
        : tr(language, 'Nouveau rôle', 'New role', 'Nieuwe rol'),
    onSave: async () => {
      if (isUserFormDirty) return await performSaveUser();
      if (isRoleFormDirty) return await performSaveRole();
      return true;
    },
    onDiscard: () => {
      if (isUserFormDirty) resetUserFormState();
      if (isRoleFormDirty) resetRoleFormState();
    },
  });

  const handleRequestClose = () => {
    requestGuardedNavigation(() => {
      resetUserFormState();
      resetRoleFormState();
      setUsersRolesModal({ open: false, tab: activeTab });
    }, ['mobile-users-roles-modal']);
  };

  if (!usersRolesModal.open) return null;

  const canManageUsers = userHasPermission('perm_manage_users');
  const canDeleteUser = userHasPermission('perm_user_delete') && !isDeptManager;
  const canManageRoles = userHasPermission('perm_manage_roles') && !isDeptManager;

  // Trigram auto-generator on name input
  const handleNameChange = (val: string) => {
    setUserName(val);
    if (!editingUserId) {
      setUserTrigram(generateTrigram(val));
    }
  };

  // User Submit
  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveUser();
  };

  const handleEditUser = (u: User) => {
    setEditingUserId(u.id);
    setUserName(u.name);
    setUserTrigram(u.trigram);
    setUserEmail(u.email || '');
    setUserDepartment(u.department || 'Général');
    setUserRoleId(String(u.role_id));
    setUserPassword('');
    setShowPassword(false);
    setUserMustChangePin(Boolean(u.must_change_pin));
    setUserIsPreparer(Boolean(u.is_preparer));
    setUserBinomeId(u.binome_id !== undefined && u.binome_id !== null ? u.binome_id : '');
    const allowed = u.allowed_depots || [];
    setAllDepotsAllowed(allowed.length === 0 || allowed.includes('*'));
    setUserAllowedDepots(allowed.filter((d) => d !== '*'));
    setUserFormMsg('');

    // Règle : Afficher directement le formulaire et scroller dessus
    scrollToAndFocusForm(userFormRef.current, userNameInputRef.current);
  };

  const toggleMustChangePin = async (userId: string | number) => {
    const target = users.find((x) => String(x.id) === String(userId));
    if (!target) return;
    const newVal = !target.must_change_pin;
    await saveUser({ ...target, must_change_pin: newVal });
  };

  const handleResetPassword = async (u: User) => {
    if (
      !window.confirm(
        tr(language, `Réinitialiser le mot de passe de ${u.name} ? Un nouveau mot de passe temporaire aléatoire sera généré de façon sécurisée via l'Edge Function.`, `Reset password for ${u.name}? A secure temporary password will be generated.`)
      )
    ) {
      return;
    }
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (!client) {
      alert('Connexion Supabase non configurée.');
      return;
    }
    const res = await adminResetPassword(client, u.id);
    if (!res.success) {
      alert(res.error || 'Erreur lors de la réinitialisation du mot de passe.');
      return;
    }
    alert(
      `Mot de passe réinitialisé avec succès !\n\nNouveau mot de passe temporaire pour ${u.name} :\n${res.temporary_password}\n\nL'utilisateur devra obligatoirement le renouveler lors de sa prochaine connexion.`
    );
  };

  // Role Submit
  const handleRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveRole();
  };

  const handleEditRole = (r: Role) => {
    setEditingRoleId(r.id);
    setRoleName(r.name);
    setSelectedPerms(r.permissions || []);
    setRoleFormMsg('');

    // Règle : Afficher directement le formulaire et scroller dessus
    scrollToAndFocusForm(roleFormRef.current, roleNameInputRef.current);
  };

  const togglePerm = (key: string) => {
    setSelectedPerms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  const toggleAllInGroup = (keys: string[]) => {
    const allPresent = keys.every((k) => selectedPerms.includes(k));
    if (allPresent) {
      setSelectedPerms((prev) => prev.filter((k) => !keys.includes(k)));
    } else {
      setSelectedPerms((prev) => Array.from(new Set([...prev, ...keys])));
    }
  };

  const [permSearch, setPermSearch] = useState('');
  const [collapsedMenus, setCollapsedMenus] = useState<string[]>([]);

  const toggleMenuCollapse = (menuId: string) => {
    setCollapsedMenus((prev) =>
      prev.includes(menuId) ? prev.filter((id) => id !== menuId) : [...prev, menuId]
    );
  };

  const selectAllPermissions = () => {
    setSelectedPerms([...ALL_MENU_BUTTON_KEYS]);
  };

  const deselectAllPermissions = () => {
    setSelectedPerms([]);
  };

  const displayedPermissionGroups = useMemo(() => {
    if (!permSearch.trim()) return MENU_PERMISSION_GROUPS;
    const q = permSearch.toLowerCase().trim();
    return MENU_PERMISSION_GROUPS.map((group) => {
      const matchGroupName =
        group.nameFr.toLowerCase().includes(q) ||
        group.nameEn.toLowerCase().includes(q) ||
        group.taglineFr.toLowerCase().includes(q) ||
        group.taglineEn.toLowerCase().includes(q);

      const matchedButtons = group.buttons.filter(
        (b) =>
          matchGroupName ||
          b.labelFr.toLowerCase().includes(q) ||
          b.labelEn.toLowerCase().includes(q) ||
          b.descFr.toLowerCase().includes(q) ||
          b.descEn.toLowerCase().includes(q) ||
          b.key.toLowerCase().includes(q)
      );

      return {
        ...group,
        buttons: matchedButtons,
      };
    }).filter((group) => group.buttons.length > 0);
  }, [permSearch]);

  const directoryUsers = allUsers && allUsers.length > 0 ? allUsers : users;

  const filteredUsers = directoryUsers.filter((u) => {
    const q = userSearch.toLowerCase().trim();
    return (
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.trigram.toLowerCase().includes(q) ||
      (u.department && u.department.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleRequestClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 pb-[max(0.875rem,env(safe-area-inset-bottom))] text-slate-800 dark:text-slate-100 max-h-[94dvh] sm:max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 sm:pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
              {t('users_roles_title')}
            </h2>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRequestClose();
            }}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
            title={t('common_close')}
            aria-label="Fermer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 my-2.5 sm:my-3 border border-slate-200 dark:border-slate-700 gap-1 shrink-0">
          <button
            onClick={() => {
              if (activeTab === 'users') return;
              requestGuardedNavigation(() => setActiveTab('users'), ['mobile-users-roles-modal']);
            }}
            className={`flex-1 min-w-0 py-1.5 px-2 text-xs font-bold rounded-lg transition truncate ${
              activeTab === 'users'
                ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            👥 {t('users_tab')} ({directoryUsers.length})
          </button>
          <button
            onClick={() => {
              if (activeTab === 'roles') return;
              requestGuardedNavigation(() => setActiveTab('roles'), ['mobile-users-roles-modal']);
            }}
            className={`flex-1 min-w-0 py-1.5 px-2 text-xs font-bold rounded-lg transition truncate ${
              activeTab === 'roles'
                ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            🛡️ {t('roles_tab')} ({roles.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pr-0.5 sm:pr-1 text-xs space-y-3.5 sm:space-y-4">
          {activeTab === 'users' ? (
            <>
              {/* User Form */}
              {canManageUsers && (
                <form
                  ref={userFormRef}
                  onSubmit={handleUserSubmit}
                  className={`p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border space-y-2.5 transition ${
                    editingUserId
                      ? 'border-amber-400 dark:border-amber-600 ring-2 ring-amber-400/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {/* Mode Édition Banner */}
                  {editingUserId && (
                    <div className="p-2.5 rounded-xl bg-amber-100/70 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700/80 flex items-center justify-between text-xs font-bold text-amber-950 dark:text-amber-200 animate-fadeIn">
                      <div className="flex items-center gap-2">
                        <Edit2 className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          {tr(language, `✏️ Mode Modification : ${userName || 'Collaborateur'} (${userTrigram || ''})`, `✏️ Editing Mode: ${userName || 'User'} (${userTrigram || ''})`)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUserId(null);
                          setUserName('');
                          setUserTrigram('');
                          setUserEmail('');
                          setUserPassword('');
                          setUserDepartment('Général');
                          setUserBinomeId('');
                        }}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 border border-slate-300 dark:border-slate-700 transition cursor-pointer font-extrabold shadow-2xs"
                      >
                        {tr(language, 'Annuler la modification', 'Cancel editing')}
                      </button>
                    </div>
                  )}

                  <span className="font-extrabold text-slate-700 dark:text-slate-300 block">
                    {editingUserId ? t('user_update_btn') : `➕ ${t('user_save_btn')}`}
                  </span>

                  {userFormMsg && (
                    <div className="text-red-500 text-[11px] font-bold">{userFormMsg}</div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('user_name_label')}
                      </label>
                      <input
                        ref={userNameInputRef}
                        type="text"
                        value={userName}
                        onChange={(e) => handleNameChange(e.target.value)}
                        placeholder="Ex: Jean Dupont"
                        required
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('user_trigram_label')}
                      </label>
                      <input
                        type="text"
                        maxLength={3}
                        value={userTrigram}
                        onChange={(e) => setUserTrigram(e.target.value.toUpperCase())}
                        placeholder="JDU"
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none uppercase font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('user_email_label')}
                      </label>
                      <input
                        type="email"
                        value={userEmail}
                        onChange={(e) => setUserEmail(e.target.value)}
                        placeholder="nom@entreprise.com"
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('user_dep_label')}
                      </label>
                      <SearchableSelect
                        value={userDepartment}
                        disabled={isDeptManager && editingUserId !== null}
                        onChange={(newDept) => {
                          setUserDepartment(newDept);
                          if (userBinomeId) {
                            const bUser = users.find((u) => String(u.id) === String(userBinomeId));
                            if (bUser && (bUser.department || '').toLowerCase().trim() !== newDept.toLowerCase().trim()) {
                              setUserBinomeId('');
                            }
                          }
                        }}
                        className={`w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none ${isDeptManager && editingUserId !== null ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {!isDeptManager && <option value="Général">{tr(language, 'Général', 'General')}</option>}
                        {(isDeptManager ? managedDeptNames : departments.map((d) => d.name)).map((deptName) => (
                          <option key={deptName} value={deptName}>
                            {deptName}
                          </option>
                        ))}
                      </SearchableSelect>
                    </div>
                  </div>

                  {/* Rôle et Mot de passe initial (création) ou Sécurité d'accès (édition) */}
                  {!editingUserId ? (
                    <div className="space-y-2.5 p-3 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                            {t('user_role_label')}
                          </label>
                          <SearchableSelect
                            value={userRoleId}
                            onChange={(val) => setUserRoleId(val)}
                            className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none font-bold"
                          >
                            {availableRolesToAssign.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </SearchableSelect>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5 flex items-center justify-between">
                            <span>{t('user_pin_label')}</span>
                            <span className="text-[10px] font-normal text-slate-400">
                              {tr(language, 'Auto si vide', 'Auto if empty')}
                            </span>
                          </label>
                          <div className="relative">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={userPassword}
                              onChange={(e) => setUserPassword(e.target.value)}
                              placeholder="Ex: Tot2026-X8kM"
                              minLength={6}
                              className="w-full p-2 pr-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none font-mono text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                              title={showPassword ? 'Masquer' : 'Afficher'}
                            >
                              {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                        <span>
                          {tr(language, '💡 Laissez vide pour qu\'un mot de passe temporaire soit généré automatiquement.', '💡 Leave empty to auto-generate a secure temporary password.')}
                        </span>
                        <button
                          type="button"
                          onClick={handleGeneratePassword}
                          className="px-2 py-0.5 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 font-bold hover:bg-orange-200 transition shrink-0 cursor-pointer"
                        >
                          {tr(language, '⚡ Générer', '⚡ Generate')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                            {t('user_role_label')}
                          </label>
                          <SearchableSelect
                            value={userRoleId}
                            disabled={isDeptManager}
                            onChange={(val) => setUserRoleId(val)}
                            className={`w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none font-bold ${isDeptManager ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {availableRolesToAssign.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </SearchableSelect>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                            {tr(language, 'Sécurité & Accès', 'Security & Access')}
                          </label>
                          {(() => {
                            const editingUser = users.find((u) => String(u.id) === String(editingUserId));
                            return (
                              <button
                                type="button"
                                onClick={() => editingUser && handleResetPassword(editingUser)}
                                className="w-full p-2 rounded-xl bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                              >
                                <Key className="w-3.5 h-3.5 text-amber-600" />
                                <span>{tr(language, 'Réinitialiser mot de passe', 'Reset password')}</span>
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Menu "Préparateur ?" (selon l'option Préparateurs du département sélectionné) */}
                  {(() => {
                    const currentDept = departments.find((d) => d.name === userDepartment);
                    const deptHasPreparerOption = Boolean(currentDept?.is_preparer_dept);

                    if (deptHasPreparerOption) {
                      return (
                        <div className="p-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-extrabold text-blue-950 dark:text-blue-200 flex items-center gap-1.5">
                              <Package className="w-3.5 h-3.5 text-blue-600" />
                              <span>{tr(language, 'Menu « Préparateur ? »', 'Preparer Option ?')}</span>
                            </label>
                            <span className="text-[10px] text-blue-700 dark:text-blue-300 font-black">
                              {userIsPreparer
                                ? (tr(language, 'OUI (Gestion des commandes)', 'YES (Can manage orders)'))
                                : (tr(language, 'NON (Demandeur seul)', 'NO (Requester only)'))}
                            </span>
                          </div>

                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            {tr(language, `Le département « ${userDepartment} » possède l'option « Préparateurs ». Définissez si cet utilisateur gère les commandes :`, `Department "${userDepartment}" allows preparers. Set if this user manages orders:`)}
                          </div>

                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setUserIsPreparer(true)}
                              className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition cursor-pointer ${
                                userIsPreparer
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-300'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-black text-sm">
                                <Check className="w-4 h-4 stroke-[3]" />
                                <span>OUI</span>
                              </div>
                              <span className="text-[10px] font-normal opacity-90 text-center leading-tight">
                                {tr(language, 'La personne pourra gérer les commandes', 'Can manage warehouse orders')}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setUserIsPreparer(false)}
                              className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition cursor-pointer ${
                                !userIsPreparer
                                  ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-700 dark:border-slate-600 shadow-sm'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-black text-sm">
                                <X className="w-4 h-4 stroke-[3]" />
                                <span>NON</span>
                              </div>
                              <span className="text-[10px] font-normal opacity-90 text-center leading-tight">
                                {tr(language, 'La personne ne pourra que faire des commandes', 'Can only place orders')}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <span>Rôle commande : <strong>Demandeur par défaut</strong></span>
                        <span className="text-[10px] text-slate-400">(Option "Préparateurs" non activée sur {userDepartment})</span>
                      </div>
                    );
                  })()}

                  {/* Option Renouvellement du mot de passe à la prochaine connexion */}
                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userMustChangePin}
                      onChange={(e) => setUserMustChangePin(e.target.checked)}
                      className="mt-0.5 accent-amber-600 rounded"
                    />
                    <div>
                      <div className="font-bold text-amber-950 dark:text-amber-200 text-[11px] flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>{tr(language, 'Exiger le renouvellement du mot de passe à la prochaine connexion', 'Require password renewal on next login')}</span>
                      </div>
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                        {tr(language, "Dès sa prochaine ouverture de session, l'utilisateur sera invité à définir son nouveau mot de passe secret personnel (min. 6 caractères).", 'User will be prompted to set a new personal password (min. 6 chars) immediately upon next login.')}
                      </div>
                    </div>
                  </label>

                  {/* Option Binôme habituel / Équipier */}
                  <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <label className="text-[11px] font-extrabold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{tr(language, 'Binôme habituel / Équipier de terrain', 'Paired Teammate / Binôme')}</span>
                      </span>
                      {userBinomeId && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          ✓ {tr(language, 'Binôme associé', 'Paired')}
                        </span>
                      )}
                    </label>
                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                      {tr(language, 'Associe cet équipier comme binôme : il aura accès aux camionnettes et matériels partagés de son partenaire.', 'Pairs this teammate: they gain access to their partner\'s assigned vehicle and shared equipment.')}
                    </p>
                    <SearchableSelect
                      value={userBinomeId}
                      onChange={(val) => setUserBinomeId(val)}
                      className="w-full p-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none font-bold"
                    >
                      <option value="">{tr(language, '— Aucun binôme attitré —', '— No paired binôme —')}</option>
                      {users
                        .filter((u) => {
                          if (String(u.id) === String(editingUserId)) return false;
                          const targetDept = (userDepartment || '').toLowerCase().trim();
                          if (!targetDept) return false;
                          return (u.department || '').toLowerCase().trim() === targetDept;
                        })
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.trigram}) {u.department ? `• ${u.department}` : ''}
                          </option>
                        ))}
                    </SearchableSelect>
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 font-bold">
                      {tr(language, `⚠️ Règle stricte : Le binôme doit obligatoirement appartenir au même département (« ${userDepartment} »).`, `⚠️ Strict rule: Binôme must belong to the same department ("${userDepartment}").`)}
                    </p>
                  </div>

                  {/* Option Dépôts autorisés (Accès à 1, 2, 3 dépôts ou tous) */}
                  <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-extrabold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Building className="w-3.5 h-3.5 text-orange-500" />
                        <span>{tr(language, 'Dépôts & Magasins autorisés pour ce compte', 'Authorized Depots & Warehouses')}</span>
                      </label>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {allDepotsAllowed
                          ? (tr(language, 'Tous les dépôts (*)', 'All depots (*)'))
                          : `${userAllowedDepots.length} ${tr(language, 'sélectionné(s)', 'selected')}`}
                      </span>
                    </div>

                    {!isDeptManager && (
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-orange-600 dark:text-orange-400 p-1.5 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800">
                        <input
                          type="checkbox"
                          checked={allDepotsAllowed}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setAllDepotsAllowed(checked);
                            if (checked) {
                              setUserAllowedDepots([]);
                            } else if (userAllowedDepots.length === 0 && depots.length > 0) {
                              setUserAllowedDepots([depots[0].name]);
                            }
                          }}
                          className="accent-orange-600 rounded"
                        />
                        <span>🏢 {tr(language, 'Accès à tous les dépôts (Prélèvement libre)', 'Access to all depots (No restriction)')}</span>
                      </label>
                    )}

                    <div className="pt-1.5 space-y-1.5 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">
                        {tr(language, 'Ou cochez précisément les dépôts accessibles par cet utilisateur :', 'Or check specific depots accessible by this user:')}
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                        {(isDeptManager && !currentUser?.allowed_depots?.includes('*')
                          ? depots.filter((d) => currentUser?.allowed_depots?.includes(d.name))
                          : depots
                        ).map((d) => {
                          const isChecked = !allDepotsAllowed && userAllowedDepots.includes(d.name);
                          return (
                            <label
                              key={d.id}
                              className={`flex items-center gap-1.5 p-1.5 rounded-xl border text-[11px] cursor-pointer transition ${
                                isChecked
                                  ? 'bg-orange-50/60 dark:bg-orange-950/40 border-orange-300 dark:border-orange-700 text-orange-900 dark:text-orange-200 font-bold'
                                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (allDepotsAllowed) {
                                    setAllDepotsAllowed(false);
                                    setUserAllowedDepots([d.name]);
                                  } else {
                                    setUserAllowedDepots((prev) =>
                                      prev.includes(d.name)
                                        ? prev.filter((name) => name !== d.name)
                                        : [...prev, d.name]
                                    );
                                  }
                                }}
                                className="accent-orange-600 rounded"
                              />
                              <span className="truncate">📍 {d.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingUserId(null);
                        setUserName('');
                        setUserTrigram('');
                        setUserEmail('');
                        setUserPassword('');
                        setShowPassword(false);
                        setUserMustChangePin(true);
                        setUserFormMsg('');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition cursor-pointer"
                    >
                      {editingUserId ? t('common_cancel') : (tr(language, 'Effacer', 'Clear'))}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold"
                    >
                      {editingUserId ? t('user_update_btn') : t('user_save_btn')}
                    </button>
                  </div>
                </form>
              )}

              {/* Users List */}
              <div className="space-y-2">
                {!canViewCrossDepartment ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                    <Lock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                      <span className="font-bold">{tr(language, 'Affichage restreint :', 'Restricted view :')} </span>
                      {tr(language, `Vous visualisez uniquement les collaborateurs de votre département (${currentUser?.department || 'Général'}).`, `You only view members of your department (${currentUser?.department || 'General'}).`)}
                      <span className="block text-[11px] opacity-80 mt-0.5">
                        {tr(language, 'Seuls les responsables de département et leurs suppléants peuvent consulter les collaborateurs des autres départements.', 'Only department managers and their deputies can view members of other departments.')}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-xl flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                    <Shield className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[11px]">
                      <strong>{tr(language, 'Accès inter-départements actif :', 'Cross-department access active:')}</strong>{' '}
                      {tr(language, 'En tant que responsable ou suppléant, vous visualisez les collaborateurs de tous les départements.', 'As department manager or deputy, you can view members across all departments.')}
                    </span>
                  </div>
                )}

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder={t('user_search_placeholder')}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none"
                  />
                </div>

                {filteredUsers.map((u) => {
                  const roleObj = roles.find((r) => Number(r.id) === Number(u.role_id));
                  const isSuper = Number(u.id) === 0;

                  return (
                    <div
                      key={u.id}
                      className={`p-3 bg-white dark:bg-slate-900 border rounded-2xl shadow-sm transition overflow-hidden ${
                        u.is_blocked
                          ? 'opacity-60 border-rose-200 dark:border-rose-900/40 bg-rose-50/20'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-9 h-9 mt-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-black text-xs flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700">
                          {u.trigram}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                            <span>{u.name}</span>
                            {u.is_blocked && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-600 font-bold">
                                {tr(language, 'Bloqué', 'Blocked')}
                              </span>
                            )}
                            {u.must_change_pin && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold flex items-center gap-1">
                                <KeyRound className="w-3 h-3 text-amber-600 shrink-0" />
                                <span>{tr(language, 'Renouvellement requis', 'Reset required')}</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 break-words">
                            {u.department || 'Général'} •{' '}
                            <span className="font-semibold text-orange-600">
                              {roleObj?.name || 'Utilisateur'}
                            </span>
                            {u.email && (
                              <span className="block sm:inline text-slate-400 break-all">
                                <span className="hidden sm:inline"> • </span>
                                {u.email}
                              </span>
                            )}
                          </div>
                          {/* Ligne Demandeur / Préparateur & Dépôts autorisés */}
                          <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                            {u.is_preparer ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold flex items-center gap-1 border border-blue-200 dark:border-blue-800">
                                <Package className="w-3 h-3 text-blue-600 shrink-0" />
                                <span>{tr(language, 'Préparateur Magasin', 'Warehouse Preparer')}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                                {tr(language, 'Demandeur', 'Requester')}
                              </span>
                            )}

                            {!u.allowed_depots || u.allowed_depots.length === 0 || u.allowed_depots.includes('*') ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-medium">
                                🏢 {tr(language, 'Tous les dépôts', 'All depots')}
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 font-medium">
                                📍 {u.allowed_depots.length} {tr(language, 'dépôt(s) autorisé(s)', 'allowed depot(s)')} : {u.allowed_depots.join(', ')}
                              </span>
                            )}

                            {u.binome_name && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                                <Users className="w-3 h-3 text-emerald-600 shrink-0" />
                                <span>Binôme : {u.binome_name}</span>
                              </span>
                            )}
                          </div>

                          {/* Icônes d'action placées juste en dessous de la ligne "Demandeur" */}
                          {!isSuper && (canManageUsers || canDeleteUser) && (
                            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-1.5 flex-wrap">
                              {canManageUsers && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleEditUser(u)}
                                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 transition cursor-pointer shrink-0"
                                    title={t('product_edit')}
                                  >
                                    <Edit2 className="w-3.5 h-3.5 shrink-0" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleMustChangePin(u.id)}
                                    className={`p-1.5 rounded-lg transition cursor-pointer shrink-0 ${
                                      u.must_change_pin
                                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300 ring-1 ring-amber-400'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-amber-600'
                                    }`}
                                    title={
                                      u.must_change_pin
                                        ? (tr(language, 'Désactiver le renouvellement obligatoire du mot de passe', 'Disable required password reset'))
                                        : (tr(language, 'Exiger le renouvellement du mot de passe à la prochaine connexion', 'Require password reset on next login'))
                                    }
                                  >
                                    <KeyRound className="w-3.5 h-3.5 shrink-0" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleResetPassword(u)}
                                    className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 transition cursor-pointer shrink-0"
                                    title={tr(language, 'Réinitialiser le mot de passe (générer un mot de passe temporaire)', 'Reset password')}
                                  >
                                    <Key className="w-3.5 h-3.5 shrink-0" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleBlockUser(u.id)}
                                    className={`p-1.5 rounded-lg transition cursor-pointer shrink-0 ${
                                      u.is_blocked
                                        ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                                        : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                                    }`}
                                    title={u.is_blocked ? t('user_unblock') : t('user_block')}
                                  >
                                    {u.is_blocked ? <Unlock className="w-3.5 h-3.5 shrink-0" /> : <Lock className="w-3.5 h-3.5 shrink-0" />}
                                  </button>
                                </>
                              )}
                              {canDeleteUser && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const confirmMsg = t('user_delete_confirm').replace('{name}', u.name);
                                    if (window.confirm(confirmMsg)) {
                                      deleteUser(u.id);
                                    }
                                  }}
                                  className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600 transition cursor-pointer shrink-0"
                                  title={t('common_delete')}
                                >
                                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {/* Toolbar : Rétablir les rôles recommandés par défaut (Bouton "Défaut") */}
              {canManageRoles && (
                <div className="p-3 bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 dark:from-orange-950/40 dark:via-amber-950/30 dark:to-orange-950/40 rounded-2xl border border-orange-200 dark:border-orange-800/60 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-xs font-black text-orange-950 dark:text-orange-200 flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-orange-600" />
                      <span>{tr(language, '11 Rôles Recommandés (Spécification TOT Stock)', '11 Recommended Roles (TOT Stock Spec)')}</span>
                    </div>
                    <div className="text-[10px] text-orange-800 dark:text-orange-300">
                      {tr(language, 'Chaque rôle peut être personnalisé. Le bouton « Défaut » permet de revenir aux recommandations du document.', 'Every role is customizable. The "Default" button restores recommended permissions from the specification.')}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        window.confirm(
                          tr(language, 'Voulez-vous rétablir l\'ensemble des 11 rôles par défaut selon les recommandations du document (Super Admin, IT, Adm, Log, RMag, Mag, RDép, Chef, Op, Int, Cons) ?', 'Reset all 11 roles to the recommended TOT Stock specification?')
                        )
                      ) {
                        await resetRolesToRecommended();
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
                    title={tr(language, 'Revenir aux recommandations par défaut de ce document', 'Reset to default specifications')}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{tr(language, 'Défaut (Recommandations document)', 'Defaults (Specification)')}</span>
                  </button>
                </div>
              )}

              {/* Role Form */}
              {canManageRoles && (
                <form
                  ref={roleFormRef}
                  onSubmit={handleRoleSubmit}
                  className={`p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border space-y-3 transition ${
                    editingRoleId !== null
                      ? 'border-amber-400 dark:border-amber-600 ring-2 ring-amber-400/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {/* Mode Édition Rôle Banner */}
                  {editingRoleId !== null && (
                    <div className="p-2.5 rounded-xl bg-amber-100/70 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700/80 flex items-center justify-between text-xs font-bold text-amber-950 dark:text-amber-200 animate-fadeIn">
                      <div className="flex items-center gap-2">
                        <Edit2 className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          {tr(language, `✏️ Mode Modification : Rôle « ${roleName} »`, `✏️ Editing Mode: Role "${roleName}"`)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRoleId(null);
                          setRoleName('');
                          setSelectedPerms([]);
                        }}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 border border-slate-300 dark:border-slate-700 transition cursor-pointer font-extrabold shadow-2xs"
                      >
                        {tr(language, 'Annuler', 'Cancel')}
                      </button>
                    </div>
                  )}

                  <span className="font-extrabold text-slate-700 dark:text-slate-300 block">
                    {editingRoleId ? t('role_update_btn') : `➕ ${t('role_save_btn')}`}
                  </span>

                  {roleFormMsg && (
                    <div className="text-red-500 text-[11px] font-bold">{roleFormMsg}</div>
                  )}

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                      {t('role_name_label')}
                    </label>
                    <input
                      ref={roleNameInputRef}
                      type="text"
                      value={roleName}
                      onChange={(e) => setRoleName(e.target.value)}
                      placeholder="Ex: Chef de Chantier..."
                      required
                      className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none"
                    />
                  </div>

                  {/* Hierarchical Permissions Matrix: Chaque bouton de chaque menu est une case à cocher */}
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2">
                      <div>
                        <span className="block font-black text-xs text-slate-800 dark:text-slate-200">
                          {tr(language, 'Attribution des boutons & menus (Cases à cocher) :', 'Menu Buttons & Rights Attribution (Checkboxes) :')}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {tr(language, 'Chaque bouton de chaque menu possède sa propre case à cocher', 'Every button of each menu has its own dedicated checkbox')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                          {selectedPerms.length} / {ALL_MENU_BUTTON_KEYS.length}{' '}
                          {tr(language, 'boutons', 'buttons')}
                        </span>
                      </div>
                    </div>

                    {/* Quick Selection Toolbar & Search Filter */}
                    <div className="mb-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={selectAllPermissions}
                          className="px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 hover:bg-orange-100 border border-orange-200 dark:border-orange-800 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer active:scale-95"
                        >
                          <CheckSquare className="w-3 h-3" />
                          <span>{tr(language, 'Tout cocher (Tous les boutons)', 'Check all buttons')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={deselectAllPermissions}
                          className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 border border-slate-200 dark:border-slate-700 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer active:scale-95"
                        >
                          <Square className="w-3 h-3" />
                          <span>{tr(language, 'Tout décocher', 'Uncheck all')}</span>
                        </button>

                        {/* Rétablir les recommandations par défaut de ce rôle */}
                        {editingRoleId !== null && (
                          <button
                            type="button"
                            onClick={() => {
                              const rec = RECOMMENDED_ROLES_SPEC.find((r) => r.id === editingRoleId);
                              if (rec) {
                                setSelectedPerms([...rec.permissions]);
                              }
                            }}
                            className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 border border-amber-300 dark:border-amber-800 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer active:scale-95 ml-auto"
                            title={tr(language, 'Rétablir les droits recommandés pour ce rôle', 'Restore default permissions for this role')}
                          >
                            <RotateCcw className="w-3 h-3 text-amber-600" />
                            <span>{tr(language, 'Droits par défaut de ce rôle', 'Default for this role')}</span>
                          </button>
                        )}
                      </div>

                      {/* Perm Search */}
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={permSearch}
                          onChange={(e) => setPermSearch(e.target.value)}
                          placeholder={
                            tr(language, 'Filtrer un bouton (ex: prix, étiquettes, suppression, scan, kpi, csv...)...', 'Filter buttons (e.g. price, label, delete, scan, kpi, csv...)...')
                          }
                          className="w-full pl-8 pr-7 py-1.5 text-[11px] bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-slate-400"
                        />
                        {permSearch && (
                          <button
                            type="button"
                            onClick={() => setPermSearch('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Scrollable Container with All Menus and Buttons */}
                    <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                      {displayedPermissionGroups.length === 0 ? (
                        <div className="p-4 text-center bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                          {tr(language, `Aucun bouton correspondant à « ${permSearch} »`, `No button matching "${permSearch}"`)}
                        </div>
                      ) : (
                        displayedPermissionGroups.map((group) => {
                          const groupKeys = group.buttons.map((b) => b.key);
                          const activeInGroupCount = groupKeys.filter((k) =>
                            selectedPerms.includes(k)
                          ).length;
                          const isAllChecked =
                            groupKeys.length > 0 &&
                            groupKeys.every((k) => selectedPerms.includes(k));
                          const isCollapsed = collapsedMenus.includes(group.id);

                          return (
                            <div
                              key={group.id}
                              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs overflow-hidden transition"
                            >
                              {/* Menu Header */}
                              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-2">
                                <div
                                  onClick={() => toggleMenuCollapse(group.id)}
                                  className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                                >
                                  <span className="text-base leading-none shrink-0">{group.icon}</span>
                                  <div className="min-w-0">
                                    <div className="font-extrabold text-[11px] text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                                      <span>{tr(language, group.nameFr, group.nameEn)}</span>
                                      <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300">
                                        {activeInGroupCount}/{groupKeys.length}
                                      </span>
                                    </div>
                                    <div className="text-[9px] text-slate-400 truncate">
                                      {tr(language, group.taglineFr, group.taglineEn)}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {/* Toggle all in this menu */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleAllInGroup(groupKeys);
                                    }}
                                    title={
                                      isAllChecked
                                        ? (tr(language, 'Tout décocher dans ce menu', 'Uncheck all in this menu'))
                                        : (tr(language, 'Tout cocher dans ce menu', 'Check all in this menu'))
                                    }
                                    className={`px-1.5 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition cursor-pointer active:scale-95 ${
                                      isAllChecked
                                        ? 'bg-orange-600 text-white border-orange-600'
                                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    {isAllChecked ? (
                                      <CheckSquare className="w-3 h-3" />
                                    ) : (
                                      <Square className="w-3 h-3 text-slate-400" />
                                    )}
                                    <span className="hidden sm:inline">
                                      {isAllChecked
                                        ? (tr(language, 'Menu Actif', 'Active'))
                                        : (tr(language, 'Tout Cocher', 'Check All'))}
                                    </span>
                                  </button>

                                  {/* Collapse Toggle Arrow */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleMenuCollapse(group.id);
                                    }}
                                    className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 transition"
                                  >
                                    {isCollapsed ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Buttons Checkboxes in this Menu */}
                              {!isCollapsed && (
                                <div className="p-2 space-y-1.5 divide-y divide-slate-100 dark:divide-slate-800/60">
                                  {group.buttons.map((btn) => {
                                    const isChecked = selectedPerms.includes(btn.key);
                                    const isPriceBtn = btn.key === 'perm_prod_view_price';
                                    const isDanger = btn.isDangerous;

                                    return (
                                      <label
                                        key={btn.key}
                                        className={`pt-1.5 first:pt-0 flex items-start gap-2.5 p-1.5 rounded-xl cursor-pointer transition select-none ${
                                          isPriceBtn
                                            ? 'bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50'
                                            : isDanger
                                            ? 'hover:bg-rose-50/40 dark:hover:bg-rose-950/20'
                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => togglePerm(btn.key)}
                                          className={`rounded mt-0.5 shrink-0 ${
                                            isDanger
                                              ? 'accent-rose-600'
                                              : isPriceBtn
                                              ? 'accent-amber-600'
                                              : 'accent-orange-600'
                                          }`}
                                        />

                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            {btn.icon && (
                                              <span className="text-xs leading-none shrink-0">
                                                {btn.icon}
                                              </span>
                                            )}
                                            <span
                                              className={`text-[11px] font-bold leading-tight ${
                                                isPriceBtn
                                                  ? 'text-amber-900 dark:text-amber-300 font-extrabold'
                                                  : isDanger
                                                  ? 'text-rose-600 dark:text-rose-400 font-bold'
                                                  : isChecked
                                                  ? 'text-slate-900 dark:text-white'
                                                  : 'text-slate-600 dark:text-slate-400'
                                              }`}
                                            >
                                              {tr(language, btn.labelFr, btn.labelEn)}
                                            </span>

                                            {isDanger && (
                                              <span className="text-[9px] px-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 font-bold">
                                                {tr(language, 'Suppression', 'Delete', 'Verwijdering')}
                                              </span>
                                            )}

                                            {isPriceBtn && (
                                              <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 font-bold">
                                                {tr(language, 'Prix & Finance', 'Prices & Finance', 'Prijzen & Financiën')}
                                              </span>
                                            )}
                                          </div>

                                          <p className="text-[10px] text-slate-400 dark:text-slate-400 mt-0.5 leading-snug">
                                            {tr(language, btn.descFr, btn.descEn)}
                                          </p>
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRoleId(null);
                        setRoleName('');
                        setSelectedPerms([]);
                        setRoleFormMsg('');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition cursor-pointer"
                    >
                      {editingRoleId ? t('common_cancel') : (tr(language, 'Effacer', 'Clear'))}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs"
                    >
                      {editingRoleId ? t('role_update_btn') : t('role_save_btn')}
                    </button>
                  </div>
                </form>
              )}

              {/* Roles List */}
              <div className="space-y-2">
                {roles.map((r) => {
                  const isSuper = Number(r.id) === 0;
                  return (
                    <div
                      key={r.id}
                      className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between shadow-sm"
                    >
                      <div>
                        <div className="font-extrabold text-slate-900 dark:text-white">
                          {r.name}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                          <span>
                            {(r.permissions || []).length} {tr(language, 'permission(s)', 'permission(s)')}
                          </span>
                          {!isSuper && !(r.permissions || []).includes('perm_prod_view_price') && (
                            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                              🔒 {tr(language, 'Prix masqués', 'Prices hidden')}
                            </span>
                          )}
                        </div>
                      </div>

                      {isSuper ? (
                        <span className="text-[11px] font-bold text-orange-600 bg-orange-50 dark:bg-orange-950/50 px-2 py-0.5 rounded-md">
                          {t('role_system_badge')} (Master)
                        </span>
                      ) : (
                        canManageRoles && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEditRole(r)}
                              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300"
                              title={t('product_edit')}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                const confirmMsg = t('role_delete_confirm').replace('{name}', r.name);
                                if (window.confirm(confirmMsg)) {
                                  deleteRole(r.id);
                                }
                              }}
                              className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600"
                              title={t('common_delete')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer with Cancel / Close Button */}
        <div className="pt-3 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-semibold text-slate-400">
            {activeTab === 'users'
              ? `${users.length} ${tr(language, 'utilisateur(s)', 'user(s)')}`
              : `${roles.length} ${tr(language, 'rôle(s)', 'role(s)')}`}
          </span>
          <button
            type="button"
            onClick={() => setUsersRolesModal({ open: false, tab: activeTab })}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs transition cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs"
          >
            <X className="w-3.5 h-3.5" />
            <span>{tr(language, 'Fermer / Annuler', 'Close / Cancel')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
