import React, { useState, useMemo, useEffect, useRef } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { Department, Project } from '../types';
import { SearchableSelect } from './SearchableSelect';
import {
  requestGuardedNavigation,
  scrollToAndFocusForm,
  useRegisterUnsavedForm,
} from '../services/unsavedChangesGuard';
import {
  X,
  Building2,
  Edit2,
  Trash2,
  User,
  Search,
  Plus,
  ShieldCheck,
  CheckCircle2,
  UserCheck,
  Users,
  Lock,
  Archive,
  RotateCcw,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import {
  canUserManageProjectStatus,
  filterProjectsByStatusTab,
  formatClosedProjectBadgeText,
  getNonFinalOrdersForProject,
  isProjectClosed,
} from '../services/projectStatusService';
import { NO_AUTH_SESSION_BANNER_MESSAGE } from '../services/clientSupabase';
import { MaterialOrder } from '../types';
import {
  canUserViewDepot,
  formatDepotNameForDisplay,
  resolveDepotDepartmentName,
} from '../utils/depotPermissions';

export const DepartmentsProjectsModal: React.FC = () => {
  const {
    departmentsProjectsModal,
    setDepartmentsProjectsModal,
    departments,
    projects,
    depots,
    users,
    orders,
    saveDepartment,
    deleteDepartment,
    saveProject,
    deleteProject,
    closeProject,
    reopenProject,
    setOrderCartModalOpen,
    userHasPermission,
    currentUser,
    canViewCrossDepartment,
    isSupabaseConnected,
    hasAuthSession,
    language,
    t,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'deps' | 'projects'>(
    departmentsProjectsModal.tab || 'deps'
  );

  // Synchronize activeTab whenever the modal is opened or tab property changes
  useEffect(() => {
    if (departmentsProjectsModal.open && departmentsProjectsModal.tab) {
      setActiveTab(departmentsProjectsModal.tab);
    }
  }, [departmentsProjectsModal.open, departmentsProjectsModal.tab]);

  // Department form state
  const [editingDepId, setEditingDepId] = useState<number | null>(null);
  const [depName, setDepName] = useState('');
  const [depManagerId, setDepManagerId] = useState<string>('');
  const [depDeputyIds, setDepDeputyIds] = useState<(string | number)[]>([]);
  const [selectedDepDeputyToAdd, setSelectedDepDeputyToAdd] = useState<string>('');
  const [depAllowGlobalKpis, setDepAllowGlobalKpis] = useState<boolean>(false);
  const [depIsPreparerDept, setDepIsPreparerDept] = useState<boolean>(false);
  const [depRequireOrderApproval, setDepRequireOrderApproval] = useState<boolean>(false);
  const [depOrderApprovalThreshold, setDepOrderApprovalThreshold] = useState<string>('0');
  const [depSearch, setDepSearch] = useState('');

  // Project form state
  const [editingProjId, setEditingProjId] = useState<number | null>(null);
  const [projDepId, setProjDepId] = useState<string>(
    departments && departments.length > 0 ? String(departments[0].id) : ''
  );
  const [projNumber, setProjNumber] = useState('');
  const [projName, setProjName] = useState('');
  const [projManagerId, setProjManagerId] = useState<string>('');
  const [projDeputyIds, setProjDeputyIds] = useState<(string | number)[]>([]);
  const [selectedProjDeputyToAdd, setSelectedProjDeputyToAdd] = useState<string>('');
  const [projSearch, setProjSearch] = useState('');
  const [projStatusTab, setProjStatusTab] = useState<'IN_PROGRESS' | 'CLOSED' | 'ALL'>('IN_PROGRESS');
  const [projectStatusModal, setProjectStatusModal] = useState<{
    project: Project;
    mode: 'CLOSE' | 'REOPEN';
    note: string;
    loading: boolean;
    errorMessage: string | null;
    blockingOrders: MaterialOrder[];
  } | null>(null);
  const writeDisabledNoSession = Boolean(isSupabaseConnected && !hasAuthSession);

  // Form DOM Refs for direct auto-scrolling on edit click
  const depFormRef = useRef<HTMLFormElement | null>(null);
  const depNameInputRef = useRef<HTMLInputElement | null>(null);
  const projFormRef = useRef<HTMLFormElement | null>(null);
  const projNumberInputRef = useRef<HTMLInputElement | null>(null);

  // Synchronize projDepId default if not set
  useEffect(() => {
    if (departments && departments.length > 0 && !projDepId) {
      setProjDepId(String(departments[0].id));
    }
  }, [departments, projDepId]);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && departmentsProjectsModal.open) {
        setDepartmentsProjectsModal({ open: false, tab: activeTab });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [departmentsProjectsModal.open, activeTab, setDepartmentsProjectsModal]);

  const isSuperOrAdmin =
    Number(currentUser?.id) === 0 ||
    Number(currentUser?.role_id) === 0 ||
    Number(currentUser?.role_id) === 1;

  const canEditDep = isSuperOrAdmin || userHasPermission('perm_dep_edit');
  const canDeleteDep = isSuperOrAdmin || userHasPermission('perm_dep_delete');
  const canEditProj = isSuperOrAdmin || userHasPermission('perm_proj_edit');
  const canDeleteProj = isSuperOrAdmin || userHasPermission('perm_proj_delete');

  // Selected Department for Project filtering
  const currentSelectedDep = useMemo(() => {
    return (departments || []).find((d) => String(d?.id) === String(projDepId));
  }, [departments, projDepId]);
  
  // Filter users by department for project conducteurs/responsables
  const departmentFilteredUsers = useMemo(() => {
    if (!currentSelectedDep || !users) return users || [];
    const depNameLower = (currentSelectedDep.name || '').toLowerCase().trim();
    if (!depNameLower) return users;
    const matched = users.filter(
      (u) => (u?.department || '').toLowerCase().trim() === depNameLower
    );
    // If some users belong to this department, return them; otherwise fallback to all users
    return matched.length > 0 ? matched : users;
  }, [currentSelectedDep, users]);

  const isFilteredToDepartment = useMemo(() => {
    if (!currentSelectedDep?.name || !users) return false;
    const depNameLower = currentSelectedDep.name.toLowerCase().trim();
    return users.some(
      (u) => (u?.department || '').toLowerCase().trim() === depNameLower
    );
  }, [currentSelectedDep, users]);

  const filteredDeps = useMemo(() => {
    const q = depSearch.toLowerCase().trim();
    return (departments || []).filter((d) =>
      (d?.name || '').toLowerCase().includes(q)
    );
  }, [departments, depSearch]);

  const filteredProjects = useMemo(() => {
    const q = projSearch.toLowerCase().trim();
    const statusFiltered = filterProjectsByStatusTab(projects || [], projStatusTab);
    return statusFiltered.filter(
      (p) =>
        (p?.project_number || '').toLowerCase().includes(q) ||
        (p?.project_name || '').toLowerCase().includes(q)
    );
  }, [projects, projSearch, projStatusTab]);

  const handleConfirmProjectStatusChange = async () => {
    if (!projectStatusModal) return;
    const { project, mode, note } = projectStatusModal;
    setProjectStatusModal((prev) => (prev ? { ...prev, loading: true, errorMessage: null } : null));

    if (mode === 'CLOSE') {
      const res = await closeProject(project.project_number, note);
      if (!res.success) {
        setProjectStatusModal((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                errorMessage: res.error || 'Fermeture refusée.',
                blockingOrders: res.blockingOrders || getNonFinalOrdersForProject(orders, project.project_number),
              }
            : null
        );
        return;
      }
      setProjectStatusModal(null);
    } else {
      const res = await reopenProject(project.project_number, note);
      if (!res.success) {
        setProjectStatusModal((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                errorMessage: res.error || 'Réouverture refusée.',
              }
            : null
        );
        return;
      }
      setProjectStatusModal(null);
    }
  };

  // Available users for department deputy selector (exclude principal manager & already added deputies)
  const availableDepDeputyUsers = useMemo(() => {
    return (users || []).filter(
      (u) =>
        String(u.id) !== String(depManagerId) &&
        !depDeputyIds.map(String).includes(String(u.id))
    );
  }, [users, depManagerId, depDeputyIds]);

  // Available users for project deputy selector (exclude principal manager & already added deputies)
  const availableProjDeputyUsers = useMemo(() => {
    return (departmentFilteredUsers || []).filter(
      (u) =>
        String(u.id) !== String(projManagerId) &&
        !projDeputyIds.map(String).includes(String(u.id))
    );
  }, [departmentFilteredUsers, projManagerId, projDeputyIds]);

  const safeConfirm = (msg: string): boolean => {
    try {
      return typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(msg)
        : true;
    } catch {
      return true;
    }
  };

  // Reset department form
  const handleResetDepForm = () => {
    setEditingDepId(null);
    setDepName('');
    setDepManagerId('');
    setDepDeputyIds([]);
    setSelectedDepDeputyToAdd('');
    setDepAllowGlobalKpis(false);
    setDepIsPreparerDept(false);
    setDepRequireOrderApproval(false);
    setDepOrderApprovalThreshold('0');
  };

  // Reset project form
  const handleResetProjForm = () => {
    setEditingProjId(null);
    setProjNumber('');
    setProjName('');
    setProjManagerId('');
    setProjDeputyIds([]);
    setSelectedProjDeputyToAdd('');
  };

  const performSaveDep = async (): Promise<boolean> => {
    if (!depName.trim()) return false;
    const ok = await saveDepartment({
      id: editingDepId || undefined,
      name: depName.trim(),
      manager_id: depManagerId ? Number(depManagerId) : null,
      deputy_manager_ids: depDeputyIds,
      allow_global_kpis: depAllowGlobalKpis,
      is_preparer_dept: depIsPreparerDept,
      require_order_approval: depRequireOrderApproval,
      order_approval_threshold: depRequireOrderApproval ? parseFloat(depOrderApprovalThreshold) || 0 : undefined,
    });
    if (!ok) return false;
    handleResetDepForm();
    return true;
  };

  const performSaveProj = async (): Promise<boolean> => {
    if (!projNumber.trim() || !projName.trim()) return false;
    const ok = await saveProject({
      id: editingProjId || undefined,
      department_id: projDepId ? Number(projDepId) : (departments[0]?.id || 1),
      project_number: projNumber.trim(),
      project_name: projName.trim(),
      manager_id: projManagerId ? Number(projManagerId) : null,
      deputy_manager_ids: projDeputyIds,
    });
    if (!ok) return false;
    handleResetProjForm();
    return true;
  };

  const isDepFormDirty =
    departmentsProjectsModal.open &&
    activeTab === 'deps' &&
    (editingDepId !== null || Boolean(depName.trim()));

  const isProjFormDirty =
    departmentsProjectsModal.open &&
    activeTab === 'projects' &&
    (editingProjId !== null || Boolean(projNumber.trim() || projName.trim()));

  useRegisterUnsavedForm({
    id: 'mobile-depproj-modal',
    isDirty: isDepFormDirty || isProjFormDirty,
    label: isDepFormDirty
      ? editingDepId !== null
        ? tr(language, `Modification du département (${depName})`, `Editing department (${depName})`, `Afdeling bewerken (${depName})`)
        : tr(language, 'Nouveau département', 'New department', 'Nieuwe afdeling')
      : editingProjId !== null
        ? tr(language, `Modification du chantier (${projNumber || projName})`, `Editing project (${projNumber || projName})`, `Project bewerken (${projNumber || projName})`)
        : tr(language, 'Nouveau chantier', 'New project', 'Nieuw project'),
    onSave: async () => {
      if (isDepFormDirty) return await performSaveDep();
      if (isProjFormDirty) return await performSaveProj();
      return true;
    },
    onDiscard: () => {
      if (isDepFormDirty) handleResetDepForm();
      if (isProjFormDirty) handleResetProjForm();
    },
  });

  const handleRequestClose = () => {
    requestGuardedNavigation(() => {
      handleResetDepForm();
      handleResetProjForm();
      setDepartmentsProjectsModal({ open: false, tab: activeTab });
    }, ['mobile-depproj-modal']);
  };

  // Handle Department Submit
  const handleDepSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveDep();
  };

  const handleEditDep = (dep: Department) => {
    setEditingDepId(dep.id);
    setDepName(dep.name || '');
    setDepManagerId(dep.manager_id ? String(dep.manager_id) : '');
    setDepDeputyIds(Array.isArray(dep.deputy_manager_ids) ? dep.deputy_manager_ids.map(String) : []);
    setDepAllowGlobalKpis(Boolean(dep.allow_global_kpis));
    setDepIsPreparerDept(Boolean(dep.is_preparer_dept));
    setDepRequireOrderApproval(Boolean(dep.require_order_approval));
    setDepOrderApprovalThreshold(dep.order_approval_threshold !== undefined ? String(dep.order_approval_threshold) : '0');
    setSelectedDepDeputyToAdd('');

    // Afficher directement le formulaire et scroller dessus
    scrollToAndFocusForm(depFormRef.current, depNameInputRef.current);
  };

  const handleAddDepDeputy = () => {
    if (!selectedDepDeputyToAdd) return;
    if (depDeputyIds.map(String).includes(String(selectedDepDeputyToAdd))) return;
    setDepDeputyIds((prev) => [...prev, selectedDepDeputyToAdd]);
    setSelectedDepDeputyToAdd('');
  };

  const handleRemoveDepDeputy = (idToRemove: string | number) => {
    setDepDeputyIds((prev) => prev.filter((id) => String(id) !== String(idToRemove)));
  };

  // Handle Project Submit
  const handleProjSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveProj();
  };

  const handleEditProj = (p: Project) => {
    setEditingProjId(p.id);
    setProjDepId(String(p.department_id || (departments[0]?.id || 1)));
    setProjNumber(p.project_number || '');
    setProjName(p.project_name || '');
    setProjManagerId(p.manager_id ? String(p.manager_id) : '');
    setProjDeputyIds(Array.isArray(p.deputy_manager_ids) ? p.deputy_manager_ids.map(String) : []);
    setSelectedProjDeputyToAdd('');

    // Afficher directement le formulaire et scroller dessus
    scrollToAndFocusForm(projFormRef.current, projNumberInputRef.current);
  };

  const handleAddProjDeputy = () => {
    if (!selectedProjDeputyToAdd) return;
    if (projDeputyIds.map(String).includes(String(selectedProjDeputyToAdd))) return;
    setProjDeputyIds((prev) => [...prev, selectedProjDeputyToAdd]);
    setSelectedProjDeputyToAdd('');
  };

  const handleRemoveProjDeputy = (idToRemove: string | number) => {
    setProjDeputyIds((prev) => prev.filter((id) => String(id) !== String(idToRemove)));
  };

  // RULES OF HOOKS: All hooks called unconditionally before early return
  if (!departmentsProjectsModal.open) return null;

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
            <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center font-bold shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                {t('dep_proj_title')}
              </h2>
              <div className="text-[10px] text-slate-400 truncate">
                {tr(language, 'Gestion des départements, chantiers, responsables & suppléants (+)', 'Manage departments, sites, managers & deputies (+)')}
              </div>
            </div>
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
              if (activeTab === 'deps') return;
              requestGuardedNavigation(() => setActiveTab('deps'), ['mobile-depproj-modal']);
            }}
            className={`flex-1 min-w-0 py-1.5 px-2 text-xs font-bold rounded-lg transition truncate ${
              activeTab === 'deps'
                ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            🏢 {t('dep_tab_deps')} ({departments.length})
          </button>
          <button
            onClick={() => {
              if (activeTab === 'projects') return;
              requestGuardedNavigation(() => setActiveTab('projects'), ['mobile-depproj-modal']);
            }}
            className={`flex-1 min-w-0 py-1.5 px-2 text-xs font-bold rounded-lg transition truncate ${
              activeTab === 'projects'
                ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            🏗️ {t('dep_tab_projs')} ({projects.length})
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto pr-0.5 sm:pr-1 text-xs space-y-3.5 sm:space-y-4">
          {activeTab === 'deps' ? (
            <>
              {/* Department Form */}
              {canEditDep && (
                <form
                  ref={depFormRef}
                  onSubmit={handleDepSubmit}
                  className={`p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border space-y-3 transition ${
                    editingDepId !== null
                      ? 'border-orange-400 dark:border-orange-600 ring-2 ring-orange-400/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {/* Mode Édition Département Banner */}
                  {editingDepId !== null && (
                    <div className="p-2.5 rounded-xl bg-orange-100/70 dark:bg-orange-950/50 border border-orange-300 dark:border-orange-700/80 flex items-center justify-between text-xs font-bold text-orange-950 dark:text-orange-200 animate-fadeIn">
                      <div className="flex items-center gap-2">
                        <Edit2 className="w-4 h-4 text-orange-600 shrink-0" />
                        <span>
                          {tr(language, `✏️ Mode Modification : Département « ${depName} »`, `✏️ Editing Mode: Department "${depName}"`)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetDepForm}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 border border-slate-300 dark:border-slate-700 transition cursor-pointer font-extrabold shadow-2xs"
                      >
                        {tr(language, 'Annuler', 'Cancel')}
                      </button>
                    </div>
                  )}

                  <span className="font-extrabold text-slate-800 dark:text-slate-200 block text-xs">
                    {editingDepId ? t('dep_btn_update') : `➕ ${t('dep_name_label')}`}
                  </span>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('dep_name_label')} *
                      </label>
                      <input
                        ref={depNameInputRef}
                        type="text"
                        value={depName}
                        onChange={(e) => setDepName(e.target.value)}
                        placeholder="Ex: Logistique, Direction, Plomberie..."
                        required
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('dep_manager_label')} (Principal)
                      </label>
                      <SearchableSelect
                        value={depManagerId}
                        onChange={(val) => setDepManagerId(val)}
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-xs"
                      >
                        <option value="">{t('dep_manager_placeholder')}</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.trigram})
                          </option>
                        ))}
                      </SearchableSelect>
                    </div>
                  </div>

                  {/* Suppléants Responsable de Département avec bouton "+" */}
                  <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-extrabold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-orange-500" />
                        <span>
                          {tr(language, 'Suppléant(s) Responsable de Département', 'Department Deputy Manager(s)')}
                        </span>
                      </label>
                      <span className="text-[10px] text-slate-400">
                        {depDeputyIds.length} {tr(language, 'assigné(s)', 'assigned')}
                      </span>
                    </div>

                    {/* Liste des badges de suppléants */}
                    {depDeputyIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {depDeputyIds.map((deputyId) => {
                          const userObj = users.find((u) => String(u.id) === String(deputyId));
                          return (
                            <span
                              key={deputyId}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 text-[11px] font-bold"
                            >
                              <UserCheck className="w-3 h-3 text-orange-500" />
                              <span>{userObj?.name || `ID ${deputyId}`}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveDepDeputy(deputyId)}
                                className="w-3.5 h-3.5 rounded-full hover:bg-orange-200 dark:hover:bg-orange-900/60 flex items-center justify-center text-orange-600 ml-0.5"
                                title="Retirer"
                              >
                                ✕
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Sélecteur de suppléant avec bouton "+" */}
                    <div className="flex items-center gap-2 pt-1">
                      <SearchableSelect
                        value={selectedDepDeputyToAdd}
                        onChange={(val) => setSelectedDepDeputyToAdd(val)}
                        className="flex-1 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none"
                      >
                        <option value="">
                          {tr(language, '-- Choisir un suppléant à ajouter --', '-- Choose a deputy to add --')}
                        </option>
                        {availableDepDeputyUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.trigram}) - {u.department || 'Général'}
                          </option>
                        ))}
                      </SearchableSelect>
                      <button
                        type="button"
                        onClick={handleAddDepDeputy}
                        disabled={!selectedDepDeputyToAdd}
                        className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1 shrink-0 transition ${
                          selectedDepDeputyToAdd
                            ? 'bg-orange-600 hover:bg-orange-700 text-white shadow-sm'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                        }`}
                        title="Ajouter ce suppléant"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span className="text-[11px]">{tr(language, 'Ajouter', 'Add')}</span>
                      </button>
                    </div>
                  </div>

                  {/* Option Droits d'Accès aux KPI & Filtres de Dépôt de toute la société */}
                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={depAllowGlobalKpis}
                      onChange={(e) => setDepAllowGlobalKpis(e.target.checked)}
                      className="mt-0.5 accent-orange-600 rounded"
                    />
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 text-[11px]">
                        <span>👑 {tr(language, 'Accès complet aux KPIs de toute la société & filtres multi-dépôts', 'Full Company KPIs & Multi-Depot Scope')}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                        {tr(language, 'Cochez cette option pour la Logistique, la Direction ou les Approvisionnements : les membres pourront filtrer tous les dépôts et visualiser l\'activité globale.', 'Check this for Logistics or Management: members can filter all depots and view full company KPIs.')}
                      </div>
                    </div>
                  </label>

                  {/* Option Département Préparateurs / Magasin */}
                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={depIsPreparerDept}
                      onChange={(e) => setDepIsPreparerDept(e.target.checked)}
                      className="mt-0.5 accent-blue-600 rounded"
                    />
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 text-[11px]">
                        <span>📦 {tr(language, 'Option « Préparateurs » (Magasin & Gestion des Commandes)', 'Preparers Option (Warehouse & Fulfillment)')}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                        {tr(language, 'Si cette case est cochée, les utilisateurs rattachés à ce département pourront être définis comme « Préparateurs » pour recevoir et gérer les commandes de matériel.', 'When checked, members of this department can be designated as "Preparers" to manage and pick orders.')}
                      </div>
                    </div>
                  </label>

                  {/* Option Validation Hiérarchique Débrayable avec Seuil Optionnel */}
                  <div className="p-2.5 rounded-xl bg-purple-50/60 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/80 space-y-2">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={depRequireOrderApproval}
                        onChange={(e) => setDepRequireOrderApproval(e.target.checked)}
                        className="mt-0.5 accent-purple-600 rounded"
                      />
                      <div>
                        <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 text-[11px]">
                          <span>🛡️ {tr(language, 'Validation des commandes obligatoire (Chef de projet / Département)', 'Require Approval for Material Orders')}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                          {tr(language, 'Workflow débrayable : les commandes émises par les membres de ce département devront être validées par le responsable ou ses suppléants avant d\'être préparées au magasin.', 'Orders requested by members of this department require approval by manager or deputies before store preparation.')}
                        </div>
                      </div>
                    </label>

                    {depRequireOrderApproval && (
                      <div className="pt-2 border-t border-purple-200/80 dark:border-purple-800/60 flex items-center gap-2 animate-fadeIn flex-wrap">
                        <label className="text-[11px] font-bold text-purple-900 dark:text-purple-200 whitespace-nowrap">
                          {tr(language, 'Seuil optionnel de déclenchement (€) :', 'Threshold amount (€):')}
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={depOrderApprovalThreshold}
                            onChange={(e) => setDepOrderApprovalThreshold(e.target.value)}
                            placeholder="0"
                            className="w-24 p-1.5 px-2 rounded-lg bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 text-xs font-bold text-purple-950 dark:text-purple-100 outline-none"
                          />
                          <span className="text-xs font-bold text-purple-700 dark:text-purple-300">€</span>
                        </div>
                        <span className="text-[10px] text-purple-700 dark:text-purple-300">
                          {Number(depOrderApprovalThreshold) > 0
                            ? tr(language, `Seules les commandes ≥ ${depOrderApprovalThreshold} € nécessitent validation.`, `Only orders ≥ ${depOrderApprovalThreshold} € require approval.`)
                            : tr(language, 'Toutes les commandes sans exception nécessitent validation (seuil = 0 €).', 'All orders require approval (threshold = 0 €).')}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleResetDepForm}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition cursor-pointer"
                    >
                      {editingDepId ? t('common_cancel') : (tr(language, 'Effacer', 'Clear'))}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
                    >
                      {editingDepId ? t('dep_btn_update') : t('dep_btn_save')}
                    </button>
                  </div>
                </form>
              )}

              {/* Department List */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={depSearch}
                    onChange={(e) => setDepSearch(e.target.value)}
                    placeholder={t('dep_search_placeholder')}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none"
                  />
                </div>

                {filteredDeps.map((d) => {
                  const mgr = (users || []).find((u) => String(u?.id) === String(d?.manager_id));
                  const deputies = (d.deputy_manager_ids || []).map((depId) =>
                    (users || []).find((u) => String(u?.id) === String(depId))
                  ).filter(Boolean);

                  return (
                    <div
                      key={d.id}
                      className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-start justify-between shadow-2xs gap-2"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                          <span>{d.name}</span>
                          {d.allow_global_kpis && (
                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              👑 {tr(language, 'KPI Global & Dépôts', 'Global KPIs')}
                            </span>
                          )}
                          {d.is_preparer_dept && (
                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                              📦 {tr(language, 'Préparateurs', 'Preparers')}
                            </span>
                          )}
                          {d.require_order_approval && (
                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                              🛡️ {language === 'fr'
                                ? `Validation requise ${d.order_approval_threshold ? `(≥ ${d.order_approval_threshold} €)` : '(toutes)'}`
                                : `Approval required ${d.order_approval_threshold ? `(≥ ${d.order_approval_threshold} €)` : '(all)'}`}
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          <strong>{t('dep_manager_label')} :</strong>{' '}
                          {mgr ? mgr.name : (tr(language, 'Non assigné', 'Unassigned'))}
                        </div>

                        {deputies.length > 0 && (
                          <div className="text-[10px] text-orange-600 dark:text-orange-400 flex items-center gap-1 font-medium">
                            <UserCheck className="w-3 h-3 shrink-0" />
                            <span>
                              {tr(language, 'Suppléant(s) :', 'Deputies :')} {deputies.map((u) => u?.name).join(', ')}
                            </span>
                          </div>
                        )}

                        {(() => {
                          const depNameNorm = (d.name || '').trim().toLowerCase();
                          const attachedDepots = (depots || []).filter((dep) => {
                            if (!canUserViewDepot(dep, currentUser, users, departments)) return false;
                            if (dep.department_id !== undefined && dep.department_id !== null && String(dep.department_id) === String(d.id)) {
                              return true;
                            }
                            const resolved = resolveDepotDepartmentName(dep, users);
                            return Boolean(resolved && resolved.trim().toLowerCase() === depNameNorm);
                          });
                          if (attachedDepots.length === 0) return null;
                          return (
                            <div className="pt-1.5 mt-1 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                {tr(language, 'Dépôts rattachés :', 'Attached depots:')}
                              </span>
                              {attachedDepots.map((dep) => (
                                <span
                                  key={String(dep.id)}
                                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${
                                    dep.type === 'VEHICLE'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                                      : dep.type === 'CONTAINER'
                                        ? 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800'
                                        : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                                  }`}
                                >
                                  {dep.type === 'VEHICLE' ? '🚚 ' : dep.type === 'CONTAINER' ? '📦 ' : '🏢 '}
                                  {formatDepotNameForDisplay(dep, users)}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {canEditDep && (
                          <button
                            onClick={() => handleEditDep(d)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300"
                            title={t('product_edit')}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDeleteDep && (
                          <button
                            onClick={() => {
                              const confirmMsg = t('dep_delete_confirm').replace('{name}', d.name || '');
                              if (safeConfirm(confirmMsg)) {
                                deleteDepartment(d.id);
                              }
                            }}
                            className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600 transition cursor-pointer"
                            title={t('common_delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {filteredDeps.length === 0 && (
                  <div className="p-6 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <Building2 className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <div className="font-bold text-slate-600 dark:text-slate-300 text-xs">
                      {depSearch.trim()
                        ? (tr(language, 'Aucun département ne correspond à votre recherche.', 'No departments match your search.'))
                        : (tr(language, 'Aucun département configuré pour le moment.', 'No departments configured yet.'))}
                    </div>
                    {canEditDep && !editingDepId && (
                      <div className="text-[11px] text-slate-400 mt-1">
                        {tr(language, 'Utilisez le formulaire ci-dessus pour ajouter votre premier département.', 'Use the form above to add your first department.')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Project Form */}
              {canEditProj && (
                <form
                  ref={projFormRef}
                  onSubmit={handleProjSubmit}
                  className={`p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border space-y-3 transition ${
                    editingProjId !== null
                      ? 'border-orange-400 dark:border-orange-600 ring-2 ring-orange-400/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {/* Mode Édition Chantier Banner */}
                  {editingProjId !== null && (
                    <div className="p-2.5 rounded-xl bg-orange-100/70 dark:bg-orange-950/50 border border-orange-300 dark:border-orange-700/80 flex items-center justify-between text-xs font-bold text-orange-950 dark:text-orange-200 animate-fadeIn">
                      <div className="flex items-center gap-2">
                        <Edit2 className="w-4 h-4 text-orange-600 shrink-0" />
                        <span>
                          {tr(language, `✏️ Mode Modification : Chantier « ${projNumber} »`, `✏️ Editing Mode: Project "${projNumber}"`)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetProjForm}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 border border-slate-300 dark:border-slate-700 transition cursor-pointer font-extrabold shadow-2xs"
                      >
                        {tr(language, 'Annuler', 'Cancel')}
                      </button>
                    </div>
                  )}

                  <span className="font-extrabold text-slate-800 dark:text-slate-200 block text-xs">
                    {editingProjId ? t('proj_btn_update') : `➕ ${t('proj_name_label')}`}
                  </span>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('proj_dep_label')} *
                      </label>
                      <SearchableSelect
                        value={projDepId}
                        onChange={(val) => {
                          setProjDepId(val);
                          // Reset manager if not in newly selected department
                          setProjManagerId('');
                          setProjDeputyIds([]);
                        }}
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-xs font-bold"
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </SearchableSelect>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('proj_number_label')} *
                      </label>
                      <input
                        ref={projNumberInputRef}
                        type="text"
                        value={projNumber}
                        onChange={(e) => setProjNumber(e.target.value)}
                        placeholder="Ex: CH-2026-08"
                        required
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none font-bold text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('proj_name_label')} *
                      </label>
                      <input
                        type="text"
                        value={projName}
                        onChange={(e) => setProjName(e.target.value)}
                        placeholder="Ex: Résidence Les Jardins..."
                        required
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-0.5">
                        {t('proj_manager_label')} (Conducteur Principal)
                      </label>
                      <SearchableSelect
                        value={projManagerId}
                        onChange={(val) => setProjManagerId(val)}
                        className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-xs"
                      >
                        <option value="">
                          {isFilteredToDepartment
                            ? `-- Filtré sur ${currentSelectedDep?.name} --`
                            : t('dep_manager_placeholder')}
                        </option>
                        {departmentFilteredUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.trigram}) - {u.department || 'Général'}
                          </option>
                        ))}
                      </SearchableSelect>
                    </div>
                  </div>

                  {/* Notification de filtrage dynamique */}
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <span className="flex items-center gap-1">
                      <span>📁</span>
                      <span>
                        {tr(language, `Responsables filtrés sur le département "${currentSelectedDep?.name || ''}"`, `Managers filtered by department "${currentSelectedDep?.name || ''}"`)}
                      </span>
                    </span>
                    <span className="font-bold text-orange-600">
                      {departmentFilteredUsers.length} {tr(language, 'collaborateur(s)', 'user(s)')}
                    </span>
                  </div>

                  {/* Suppléants Conducteurs de travaux avec bouton "+" */}
                  <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-extrabold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-orange-500" />
                        <span>
                          {tr(language, 'Suppléant(s) Conducteur de travaux / Responsable', 'Deputy Site Manager(s)')}
                        </span>
                      </label>
                      <span className="text-[10px] text-slate-400">
                        {projDeputyIds.length} {tr(language, 'assigné(s)', 'assigned')}
                      </span>
                    </div>

                    {/* Liste des badges de suppléants */}
                    {projDeputyIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {projDeputyIds.map((deputyId) => {
                          const userObj = users.find((u) => String(u.id) === String(deputyId));
                          return (
                            <span
                              key={deputyId}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 text-[11px] font-bold"
                            >
                              <UserCheck className="w-3 h-3 text-orange-500" />
                              <span>{userObj?.name || `ID ${deputyId}`}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveProjDeputy(deputyId)}
                                className="w-3.5 h-3.5 rounded-full hover:bg-orange-200 dark:hover:bg-orange-900/60 flex items-center justify-center text-orange-600 ml-0.5"
                                title="Retirer"
                              >
                                ✕
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Sélecteur de suppléant avec bouton "+" */}
                    <div className="flex items-center gap-2 pt-1">
                      <SearchableSelect
                        value={selectedProjDeputyToAdd}
                        onChange={(val) => setSelectedProjDeputyToAdd(val)}
                        className="flex-1 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none"
                      >
                        <option value="">
                          {tr(language, `-- Ajouter un conducteur suppléant --`, '-- Add a deputy site manager --')}
                        </option>
                        {availableProjDeputyUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.trigram}) - {u.department || 'Général'}
                          </option>
                        ))}
                      </SearchableSelect>
                      <button
                        type="button"
                        onClick={handleAddProjDeputy}
                        disabled={!selectedProjDeputyToAdd}
                        className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1 shrink-0 transition ${
                          selectedProjDeputyToAdd
                            ? 'bg-orange-600 hover:bg-orange-700 text-white shadow-sm'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                        }`}
                        title="Ajouter ce suppléant conducteur de travaux"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span className="text-[11px]">{tr(language, 'Ajouter', 'Add')}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleResetProjForm}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition cursor-pointer"
                    >
                      {editingProjId ? t('common_cancel') : (tr(language, 'Effacer', 'Clear'))}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
                    >
                      {editingProjId ? t('proj_btn_update') : t('proj_btn_save')}
                    </button>
                  </div>
                </form>
              )}

              {/* Project List */}
              <div className="space-y-2">
                {!canViewCrossDepartment ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                    <Lock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                      <span className="font-bold">{tr(language, 'Affichage restreint :', 'Restricted view :')} </span>
                      {tr(language, `Vous visualisez uniquement les chantiers de votre département (${currentUser?.department || 'Général'}).`, `You only view projects belonging to your department (${currentUser?.department || 'General'}).`)}
                      <span className="block text-[11px] opacity-80 mt-0.5">
                        {tr(language, 'Seuls les responsables de département et leurs suppléants peuvent consulter les chantiers des autres départements.', 'Only department managers and their deputies can view projects of other departments.')}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-xl flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[11px]">
                      <strong>{tr(language, 'Accès inter-départements actif :', 'Cross-department access active:')}</strong>{' '}
                      {tr(language, 'En tant que responsable ou suppléant, vous visualisez les chantiers de tous les départements.', 'As department manager or deputy, you can view projects across all departments.')}
                    </span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700">
                    {([
                      { id: 'IN_PROGRESS', label: tr(language, 'En cours', 'In progress') },
                      { id: 'CLOSED', label: tr(language, 'Terminés', 'Closed') },
                      { id: 'ALL', label: tr(language, 'Tous', 'All') },
                    ] as const).map((tabItem) => (
                      <button
                        key={tabItem.id}
                        type="button"
                        onClick={() => setProjStatusTab(tabItem.id)}
                        className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                          projStatusTab === tabItem.id
                            ? 'bg-orange-600 text-white shadow-2xs'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
                        }`}
                      >
                        {tabItem.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={projSearch}
                      onChange={(e) => setProjSearch(e.target.value)}
                      placeholder={t('proj_search_placeholder')}
                      className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none"
                    />
                  </div>
                </div>

                {filteredProjects.map((p) => {
                  const dep = (departments || []).find((d) => d.id === p.department_id);
                  const mgr = (users || []).find((u) => String(u.id) === String(p.manager_id));
                  const deputies = (p.deputy_manager_ids || []).map((depId) =>
                    (users || []).find((u) => String(u.id) === String(depId))
                  ).filter(Boolean);
                  const closed = isProjectClosed(p);
                  const closedBadgeText = formatClosedProjectBadgeText(p);
                  const canManageStatus = canUserManageProjectStatus(currentUser, p, departments);

                  return (
                    <div
                      key={p.id}
                      className={`p-3 bg-white dark:bg-slate-900 border rounded-2xl flex items-start justify-between shadow-2xs gap-2 ${
                        closed
                          ? 'border-slate-300 dark:border-slate-700 opacity-90 bg-slate-50/60 dark:bg-slate-900/60'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                          <span className="text-orange-600 font-bold">[{p.project_number}]</span>
                          <span>{p.project_name}</span>
                          {closed && closedBadgeText ? (
                            <span className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                              {closedBadgeText}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                              {tr(language, 'En cours', 'In progress')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('dep_tab_deps')} : <strong>{dep?.name || 'N/A'}</strong> •{' '}
                          {t('proj_manager_label')} : {mgr?.name || (tr(language, 'Aucun', 'None'))}
                        </div>
                        {p.close_note && closed && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                            Note de clôture : {p.close_note}
                          </div>
                        )}
                        {deputies.length > 0 && (
                          <div className="text-[10px] text-orange-600 dark:text-orange-400 flex items-center gap-1 font-medium">
                            <UserCheck className="w-3 h-3 shrink-0" />
                            <span>
                              {tr(language, 'Conducteur(s) suppléant(s) :', 'Deputy manager(s) :')} {deputies.map((u) => u?.name).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {canManageStatus && (
                          closed ? (
                            <button
                              type="button"
                              disabled={writeDisabledNoSession}
                              title={writeDisabledNoSession ? NO_AUTH_SESSION_BANNER_MESSAGE : 'Rouvrir le projet'}
                              onClick={() =>
                                setProjectStatusModal({
                                  project: p,
                                  mode: 'REOPEN',
                                  note: '',
                                  loading: false,
                                  errorMessage: null,
                                  blockingOrders: [],
                                })
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>{tr(language, 'Rouvrir le projet', 'Reopen project')}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={writeDisabledNoSession}
                              title={writeDisabledNoSession ? NO_AUTH_SESSION_BANNER_MESSAGE : 'Terminer le projet'}
                              onClick={() =>
                                setProjectStatusModal({
                                  project: p,
                                  mode: 'CLOSE',
                                  note: '',
                                  loading: false,
                                  errorMessage: null,
                                  blockingOrders: getNonFinalOrdersForProject(orders, p.project_number),
                                })
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 text-amber-800 dark:text-amber-300 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                            >
                              <Archive className="w-3.5 h-3.5" />
                              <span>{tr(language, 'Terminer le projet', 'Close project')}</span>
                            </button>
                          )
                        )}
                        {canEditProj && (
                          <button
                            onClick={() => handleEditProj(p)}
                            disabled={writeDisabledNoSession}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 disabled:opacity-50"
                            title={writeDisabledNoSession ? NO_AUTH_SESSION_BANNER_MESSAGE : t('product_edit')}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDeleteProj && (
                          <button
                            disabled={writeDisabledNoSession}
                            onClick={() => {
                              const confirmMsg = t('proj_delete_confirm').replace('{number}', p.project_number || '');
                              if (safeConfirm(confirmMsg)) {
                                deleteProject(p.id);
                              }
                            }}
                            className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600 transition cursor-pointer disabled:opacity-50"
                            title={writeDisabledNoSession ? NO_AUTH_SESSION_BANNER_MESSAGE : t('common_delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {filteredProjects.length === 0 && (
                  <div className="p-6 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <Building2 className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <div className="font-bold text-slate-600 dark:text-slate-300 text-xs">
                      {projSearch.trim()
                        ? (tr(language, 'Aucun chantier ne correspond à votre recherche.', 'No sites match your search.'))
                        : (tr(language, 'Aucun chantier configuré pour le moment.', 'No sites configured yet.'))}
                    </div>
                    {canEditProj && !editingProjId && (
                      <div className="text-[11px] text-slate-400 mt-1">
                        {tr(language, 'Utilisez le formulaire ci-dessus pour ajouter votre premier chantier.', 'Use the form above to add your first site.')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer with Cancel / Close Button */}
        <div className="pt-3 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-semibold text-slate-400">
            {activeTab === 'deps'
              ? `${departments.length} ${tr(language, 'département(s)', 'department(s)')}`
              : `${filteredProjects.length} / ${projects.length} ${tr(language, 'chantier(s)', 'project(s)')}`}
          </span>
          <button
            type="button"
            onClick={() => {
              handleResetDepForm();
              handleResetProjForm();
              setDepartmentsProjectsModal({ open: false, tab: activeTab });
            }}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs transition cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs"
          >
            <X className="w-3.5 h-3.5" />
            <span>{tr(language, 'Fermer / Annuler', 'Close / Cancel')}</span>
          </button>
        </div>

        {/* Modale de confirmation Terminer / Rouvrir le projet */}
        {projectStatusModal && (
          <div className="fixed inset-0 z-110 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h4 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                  {projectStatusModal.mode === 'CLOSE' ? (
                    <>
                      <Archive className="w-4 h-4 text-amber-600" />
                      <span>Terminer le projet [{projectStatusModal.project.project_number}]</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4 text-emerald-600" />
                      <span>Rouvrir le projet [{projectStatusModal.project.project_number}]</span>
                    </>
                  )}
                </h4>
                <button
                  type="button"
                  onClick={() => setProjectStatusModal(null)}
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2">
                <p>
                  <strong>{projectStatusModal.project.project_name}</strong>
                </p>
                {projectStatusModal.mode === 'CLOSE' ? (
                  <p>
                    Une fois terminé, aucune nouvelle commande ni sortie de stock ne sera autorisée sur ce projet (les retours en stock restent possibles).
                  </p>
                ) : (
                  <p>
                    La réouverture permettra de nouveau les commandes et sorties de matériel sur ce chantier.
                  </p>
                )}
              </div>

              {projectStatusModal.errorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 space-y-2">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{projectStatusModal.errorMessage}</span>
                  </div>
                </div>
              )}

              {projectStatusModal.mode === 'CLOSE' && projectStatusModal.blockingOrders.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                  <div className="font-bold">
                    Commandes non terminées sur ce projet ({projectStatusModal.blockingOrders.length}) :
                  </div>
                  <ul className="space-y-1 max-h-36 overflow-y-auto">
                    {projectStatusModal.blockingOrders.map((bo) => (
                      <li key={bo.id} className="flex items-center justify-between gap-2 bg-white/80 dark:bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-amber-200/70 dark:border-amber-800/70">
                        <span className="font-semibold truncate">
                          #{String(bo.id).slice(-6)} — {bo.requester_name} ({bo.status})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setProjectStatusModal(null);
                            setDepartmentsProjectsModal({ open: false, tab: activeTab });
                            setOrderCartModalOpen(true);
                          }}
                          className="text-orange-600 dark:text-orange-400 font-bold flex items-center gap-1 shrink-0 hover:underline cursor-pointer"
                        >
                          <span>Voir</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Note (optionnelle)
                </label>
                <textarea
                  value={projectStatusModal.note}
                  onChange={(e) =>
                    setProjectStatusModal((prev) =>
                      prev ? { ...prev, note: e.target.value } : null
                    )
                  }
                  rows={2}
                  placeholder={
                    projectStatusModal.mode === 'CLOSE'
                      ? 'Ex: Fin de chantier, réception client validée...'
                      : 'Ex: Travaux supplémentaires demandés...'
                  }
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProjectStatusModal(null)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={projectStatusModal.loading}
                  onClick={handleConfirmProjectStatusChange}
                  className={`px-4 py-2 rounded-xl text-xs font-bold text-white shadow-sm cursor-pointer disabled:opacity-50 ${
                    projectStatusModal.mode === 'CLOSE'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {projectStatusModal.loading
                    ? 'Traitement...'
                    : projectStatusModal.mode === 'CLOSE'
                    ? 'Confirmer la clôture'
                    : 'Confirmer la réouverture'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
