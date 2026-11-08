import React, { useState, useMemo, useEffect, useRef } from 'react';
import { tr } from '../i18n/dutchTranslator';
import {
  requestGuardedNavigation,
  scrollToAndFocusForm,
  useRegisterUnsavedForm,
} from '../services/unsavedChangesGuard';
import { useApp } from '../context/AppContext';
import { SearchableSelect } from './SearchableSelect';
import {
  X,
  Warehouse,
  Plus,
  Trash2,
  Edit2,
  Search,
  MapPin,
  Package,
  AlertCircle,
  Crown,
  CheckCircle2,
  Copy,
  Check,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Database,
  ExternalLink,
  WifiOff,
  PauseCircle,
  PlayCircle,
  EyeOff,
  ArrowLeft,
  Truck,
  User,
  Users,
  Building2,
  ClipboardCheck,
  Lock,
} from 'lucide-react';
import { Depot, PLAN_TIERS, getPlanName } from '../types';
import { normalizeSupabaseUrl } from '../services/clientSupabase';
import { copyToClipboard } from '../services/clipboard';
import { DepotHoldersSection, DraftDepotHolder } from './DepotHoldersSection';
import { safeGetSensitiveItem } from '../services/localCrypto';

export const DepotsModal: React.FC = () => {
  const {
    depotsModalOpen,
    setDepotsModalOpen,
    depots,
    depotHolders,
    saveDepotHolders,
    maxDepots,
    products,
    users,
    departments,
    projects,
    saveDepot,
    deleteDepot,
    toggleDepotStatus,
    syncDepotsWithSupabase,
    testSupabaseDepotsTable,
    isSupabaseConnected,
    userHasPermission,
    currentUser,
    license,
    setCompanySetupModalOpen,
    supabaseUrl,
    saveSupabaseConfig,
    language,
    t,
    openInventoryAuditForDepot,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingDepotId, setEditingDepotId] = useState<string | number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'FIXED' | 'VEHICLE' | 'CONTAINER'>('FIXED');
  const [vehicleType, setVehicleType] = useState('Fourgon');
  const [licensePlate, setLicensePlate] = useState('');
  const [containerRef, setContainerRef] = useState('');
  const [projectNumber, setProjectNumber] = useState('');
  const [managerId, setManagerId] = useState<string | number | ''>('');
  const [departmentId, setDepartmentId] = useState<string | number | ''>('');
  const [binomeIds, setBinomeIds] = useState<(string | number)[]>([]);
  const [vehicleManagerChangeAuditPrompt, setVehicleManagerChangeAuditPrompt] = useState<{
    depotName: string;
    oldManagerName: string;
    newManagerName: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Supabase Table Testing & Syncing State
  const [isTestingTable, setIsTestingTable] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [sqlTableStatus, setSqlTableStatus] = useState<string | null>(null);
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [networkErrorMessage, setNetworkErrorMessage] = useState<string | null>(null);

  // Deletion Modal / Action State
  const [depotToDelete, setDepotToDelete] = useState<Depot | null>(null);
  const [reassignAction, setReassignAction] = useState<'detach' | 'transfer'>('detach');
  const [targetTransferDepot, setTargetTransferDepot] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Permission fallback: always allow if modal is accessible or user has admin/perm role
  const canManageDepots =
    userHasPermission('perm_manage_depots') ||
    userHasPermission('perm_config_license') ||
    userHasPermission('perm_manage_categories') ||
    !currentUser ||
    Number(currentUser?.id) === 0 ||
    Number(currentUser?.role_id) <= 2;

  const planTier = PLAN_TIERS[license?.plan_type || 'free'] || PLAN_TIERS.free;
  const isUnlimited = maxDepots >= 99999;
  const activeDepotsCount = useMemo(() => depots.filter((d) => d.is_active !== false).length, [depots]);
  const isQuotaReached = !isUnlimited && activeDepotsCount >= maxDepots && editingDepotId === null;
  // Temporary depot deactivation is available starting from Standard plan
  const canDeactivateDepots = license?.plan_type && license.plan_type !== 'free';

  const canEditDepotHolders = Boolean(
    !currentUser ||
      Number(currentUser.id) === 0 ||
      Number(currentUser.role_id) === 0 ||
      Number(currentUser.role_id) === 1 ||
      userHasPermission('perm_manage_depots')
  );

  const [isActive, setIsActive] = useState(true);
  const [togglingDepotId, setTogglingDepotId] = useState<string | number | null>(null);
  const [pickupZones, setPickupZones] = useState<string[]>([]);
  const [newZoneInput, setNewZoneInput] = useState('');
  const [draftHolders, setDraftHolders] = useState<DraftDepotHolder[]>([]);

  const handleAddZone = (zoneName?: string) => {
    const toAdd = (zoneName || newZoneInput).trim();
    if (!toAdd) return;
    if (!pickupZones.includes(toAdd)) {
      setPickupZones([...pickupZones, toAdd]);
    }
    setNewZoneInput('');
  };

  const handleRemoveZone = (indexToRemove: number) => {
    setPickupZones(pickupZones.filter((_, idx) => idx !== indexToRemove));
  };

  const filteredDepots = useMemo(() => {
    if (!searchQuery.trim()) return depots;
    const q = searchQuery.toLowerCase().trim();
    return depots.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.code && d.code.toLowerCase().includes(q)) ||
        (d.address && d.address.toLowerCase().includes(q)) ||
        (d.description && d.description.toLowerCase().includes(q)) ||
        (d.license_plate && d.license_plate.toLowerCase().includes(q)) ||
        (d.vehicle_type && d.vehicle_type.toLowerCase().includes(q)) ||
        (d.manager_name && d.manager_name.toLowerCase().includes(q)) ||
        (d.department_name && d.department_name.toLowerCase().includes(q)) ||
        (d.binome_names && d.binome_names.some((bn) => bn.toLowerCase().includes(q)))
    );
  }, [depots, searchQuery]);

  const depotFormRef = useRef<HTMLFormElement | null>(null);
  const depotNameInputRef = useRef<HTMLInputElement | null>(null);

  const resetForm = () => {
    setName('');
    setCode('');
    setAddress('');
    setDescription('');
    setType('FIXED');
    setVehicleType('Fourgon');
    setLicensePlate('');
    setContainerRef('');
    setProjectNumber('');
    setManagerId('');
    setDepartmentId('');
    setBinomeIds([]);
    setIsActive(true);
    setPickupZones([]);
    setNewZoneInput('');
    setDraftHolders([]);
    setEditingDepotId(null);
    setIsFormOpen(false);
    setErrorMessage(null);
  };

  const handleStartEdit = (d: Depot) => {
    setEditingDepotId(d.id);
    setName(d.name);
    setCode(d.code || '');
    setAddress(d.address || '');
    setDescription(d.description || '');
    setType(d.type || 'FIXED');
    setVehicleType(d.vehicle_type || 'Fourgon');
    setLicensePlate(d.license_plate || '');
    setContainerRef(d.container_ref || '');
    setProjectNumber(d.project_number || '');
    setManagerId(d.manager_id !== undefined && d.manager_id !== null ? d.manager_id : '');
    setDepartmentId(d.department_id !== undefined && d.department_id !== null ? d.department_id : '');
    setBinomeIds(d.binome_ids && Array.isArray(d.binome_ids) ? d.binome_ids : []);
    setIsActive(d.is_active !== false);
    setPickupZones(d.pickup_zones && Array.isArray(d.pickup_zones) ? d.pickup_zones : []);
    setNewZoneInput('');
    const existingHolders = depotHolders
      .filter((h) => String(h.depot_id) === String(d.id))
      .map((h) => ({
        user_id: h.user_id,
        can_send: Boolean(h.can_send),
        can_receive: Boolean(h.can_receive),
      }));
    setDraftHolders(existingHolders);
    setErrorMessage(null);
    setIsFormOpen(true);
    scrollToAndFocusForm(depotFormRef.current, depotNameInputRef.current);
  };

  useEffect(() => {
    if (depotsModalOpen && isFormOpen) {
      scrollToAndFocusForm(depotFormRef.current, depotNameInputRef.current);
    }
  }, [depotsModalOpen, isFormOpen, editingDepotId]);

  const handleToggleStatus = async (d: Depot) => {
    if (!canDeactivateDepots && d.is_active !== false) {
      setErrorMessage(
        tr(language, 'La mise en veille / fermeture temporaire d’un magasin ou dépôt est réservée aux forfaits STANDARD et supérieurs (3 dépôts, gestion chantiers/congés). Passez au forfait Standard pour utiliser cette fonctionnalité.', 'Temporary depot deactivation / standby is restricted to STANDARD and higher plans (3 depots, site/holiday management). Upgrade to Standard to use this feature.')
      );
      return;
    }
    setTogglingDepotId(d.id);
    setErrorMessage(null);
    setSuccessMessage(null);
    const res = await toggleDepotStatus(d.id);
    setTogglingDepotId(null);
    if (res.success) {
      setSuccessMessage(res.message);
      setTimeout(() => setSuccessMessage(null), 6000);
    } else {
      setErrorMessage(res.message);
    }
  };

  const performSaveDepot = async (): Promise<boolean> => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setErrorMessage(
        tr(language, 'Le nom du magasin / dépôt est obligatoire.', 'Depot / store name is required.')
      );
      return false;
    }

    const selectedUser = users.find((u) => String(u.id) === String(managerId));
    const selectedDept = departments.find((dept) => String(dept.id) === String(departmentId));

    const editingDepot =
      editingDepotId !== null ? depots.find((d) => String(d.id) === String(editingDepotId)) : null;

    // Check if changing manager on vehicle
    const isVehicle = type === 'VEHICLE';
    const managerChangedOnVehicle =
      isVehicle &&
      editingDepot &&
      (editingDepot.type === 'VEHICLE' || type === 'VEHICLE') &&
      String(editingDepot.manager_id || '') !== String(managerId || '') &&
      Boolean(managerId);

    const oldManagerName =
      editingDepot?.manager_name ||
      (editingDepot?.manager_id ? String(editingDepot.manager_id) : tr(language, 'Non assigné', 'Unassigned'));
    const newManagerName =
      selectedUser?.name || (tr(language, 'Nouveau responsable', 'New manager'));

    const selectedBinomeUsers = users.filter((u) => binomeIds.some((id) => String(id) === String(u.id)));

    // Validation stricte : Le binôme doit obligatoirement faire partie du même département que Chauffeur / Responsable du véhicule
    if (type === 'VEHICLE' && binomeIds.length > 0) {
      if (!managerId) {
        setErrorMessage(
          tr(language, 'Veuillez sélectionner un Chauffeur / Responsable du véhicule avant d’associer des binômes.', 'Please select a driver before pairing binômes.')
        );
        return false;
      }
      if (selectedUser?.department && selectedUser.department !== 'Général') {
        const driverDept = selectedUser.department.toLowerCase().trim();
        const invalidBinomes = selectedBinomeUsers.filter(
          (b) => !b.department || b.department.toLowerCase().trim() !== driverDept
        );
        if (invalidBinomes.length > 0) {
          setErrorMessage(
            tr(language, `Le binôme doit obligatoirement faire partie du même département que le Chauffeur (« ${selectedUser.department} »). Collaborateur non conforme : ${invalidBinomes.map((u) => u.name).join(', ')}.`, `Binôme must belong to the same department as the driver (${selectedUser.department}).`)
          );
          return false;
        }
      }
    }

    setIsSubmitting(true);
    const result = await saveDepot({
      id: editingDepotId || undefined,
      name: cleanName,
      code: code.trim() || undefined,
      address: address.trim() || undefined,
      description: description.trim() || undefined,
      type,
      vehicle_type: type === 'VEHICLE' ? vehicleType : undefined,
      license_plate: type === 'VEHICLE' ? licensePlate.trim().toUpperCase() : undefined,
      container_ref: type === 'CONTAINER' ? containerRef.trim() : undefined,
      project_number: type === 'CONTAINER' ? projectNumber.trim() : undefined,
      manager_id: managerId !== '' ? managerId : null,
      manager_name: selectedUser ? selectedUser.name : null,
      binome_ids: type === 'VEHICLE' ? binomeIds : [],
      binome_names: type === 'VEHICLE' ? selectedBinomeUsers.map((u) => u.name) : [],
      department_id: departmentId !== '' ? departmentId : null,
      department_name: selectedDept ? selectedDept.name : null,
      is_active: isActive,
      pickup_zones: pickupZones,
    });
    setIsSubmitting(false);

    if (!result.success) {
      setErrorMessage(result.message);
      return false;
    }

    const targetDepotId =
      editingDepotId ??
      depots.find((d) => d.name.trim().toLowerCase() === cleanName.toLowerCase())?.id;
    if (targetDepotId !== undefined && targetDepotId !== null && canEditDepotHolders) {
      await saveDepotHolders(targetDepotId, draftHolders);
    }

    setSuccessMessage(result.message);
    resetForm();
    setTimeout(() => setSuccessMessage(null), 6000);
    if (managerChangedOnVehicle) {
      setVehicleManagerChangeAuditPrompt({
        depotName: cleanName,
        oldManagerName,
        newManagerName,
      });
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveDepot();
  };

  const isDepotFormDirty = Boolean(
    depotsModalOpen &&
      isFormOpen &&
      (editingDepotId !== null || name.trim() || address.trim() || description.trim())
  );

  useRegisterUnsavedForm({
    id: 'mobile-depots-modal',
    isDirty: isDepotFormDirty,
    label: editingDepotId
      ? tr(language, `Modification du dépôt (${name || 'Dépôt'})`, `Editing depot (${name || 'Depot'})`, `Depot bewerken (${name || 'Depot'})`)
      : tr(language, 'Nouveau Magasin / Dépôt', 'Create New Depot', 'Nieuw depot'),
    onSave: performSaveDepot,
    onDiscard: resetForm,
  });

  const handleRequestBackToDepots = () => {
    requestGuardedNavigation(() => {
      resetForm();
    }, ['mobile-depots-modal']);
  };

  const handleRequestCloseModal = () => {
    requestGuardedNavigation(() => {
      resetForm();
      setDepotsModalOpen(false);
    }, ['mobile-depots-modal']);
  };

  // Trigger delete dialog
  const promptDelete = (d: Depot) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setDepotToDelete(d);

    // Default target for transfer: first other depot
    const otherDepots = depots.filter((item) => String(item.id) !== String(d.id));
    if (otherDepots.length > 0) {
      setTargetTransferDepot(otherDepots[0].name);
      setReassignAction('transfer');
    } else {
      setReassignAction('detach');
      setTargetTransferDepot('');
    }
  };

  // Confirm delete execution
  const executeDelete = async () => {
    if (!depotToDelete) return;
    setIsDeleting(true);
    setErrorMessage(null);

    const affectedCount = products.filter(
      (p) => p.store_name?.toLowerCase() === depotToDelete.name.toLowerCase()
    ).length;

    let reassignTo: string | undefined = undefined;
    if (affectedCount > 0) {
      reassignTo = reassignAction === 'transfer' ? targetTransferDepot : '';
    }

    const res = await deleteDepot(depotToDelete.id, reassignTo);
    setIsDeleting(false);

    if (!res.success) {
      setErrorMessage(res.message);
    } else {
      setSuccessMessage(res.message);
      if (editingDepotId === depotToDelete.id) {
        resetForm();
      }
      setDepotToDelete(null);
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  };

  // Check if current Supabase URL has common dashboard pattern
  const isSuspiciousUrl = Boolean(
    supabaseUrl && (supabaseUrl.includes('/dashboard/project/') || supabaseUrl.includes('@db.'))
  );

  const handleFixUrl = () => {
    if (!supabaseUrl) return;
    const fixed = normalizeSupabaseUrl(supabaseUrl);
    if (fixed && fixed !== supabaseUrl) {
      saveSupabaseConfig(fixed, safeGetSensitiveItem('tqt_company_key') || '');
      setSuccessMessage(
        tr(language, `URL Supabase corrigée automatiquement en : ${fixed}`, `Supabase URL automatically fixed to: ${fixed}`)
      );
      setIsNetworkError(false);
      setNetworkErrorMessage(null);
    }
  };

  // Sync all local depots into Supabase table
  const handleSyncAllToSupabase = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsNetworkError(false);
    setNetworkErrorMessage(null);
    setIsSyncingAll(true);

    const res = await syncDepotsWithSupabase();
    setIsSyncingAll(false);

    if (res.success) {
      setSuccessMessage(res.message);
      setSqlTableStatus(
        tr(language, `✅ Table SQL accessible (${res.count} dépôts à jour)`, `✅ SQL table accessible (${res.count} depots up to date)`)
      );
      setShowSqlGuide(false);
    } else {
      if (res.isNetworkError) {
        setIsNetworkError(true);
        setNetworkErrorMessage(res.message);
        setSqlTableStatus(
          tr(language, `⚠️ Serveur Supabase inaccessible ("Failed to fetch")`, `⚠️ Supabase server unreachable ("Failed to fetch")`)
        );
      } else {
        setErrorMessage(res.message);
        if (res.isTableMissing) {
          setShowSqlGuide(true);
        }
      }
    }
  };

  // Test whether the Supabase table exists
  const handleTestTable = async () => {
    setIsTestingTable(true);
    setSqlTableStatus(null);
    setIsNetworkError(false);
    setNetworkErrorMessage(null);
    setErrorMessage(null);

    const res = await testSupabaseDepotsTable();
    setIsTestingTable(false);

    if (res.exists) {
      setSqlTableStatus(
        tr(language, `✅ Table "${res.table}" trouvée dans Supabase (${res.count} enregistrement(s))`, `✅ Table "${res.table}" found in Supabase (${res.count} record(s))`)
      );
      setShowSqlGuide(false);
    } else if (res.isNetworkError) {
      setIsNetworkError(true);
      setNetworkErrorMessage(
        res.error ||
          (tr(language, 'Serveur Supabase inaccessible (Failed to fetch).', 'Supabase server unreachable (Failed to fetch).'))
      );
      setSqlTableStatus(
        tr(language, `⚠️ Serveur Supabase inaccessible ("Failed to fetch")`, `⚠️ Supabase server unreachable ("Failed to fetch")`)
      );
    } else {
      setSqlTableStatus(
        tr(language, `❌ Table "public.depots" introuvable dans Supabase. Veuillez exécuter le script SQL ci-dessous.`, `❌ Table "public.depots" not found in Supabase. Please run the SQL script below.`)
      );
      setShowSqlGuide(true);
    }
  };

  const sqlCreationScript = `-- =========================================================================
-- ARCHITECTURE SÉCURISÉE SUPABASE (RLS / RPC / ROLES / MULTI-TENANT)
-- Application -> Supabase -> RLS / RPC -> Vérification utilisateur + dépôt + rôle
-- =========================================================================

-- 1. Table des Dépôts / Magasins (table "depots")
CREATE TABLE IF NOT EXISTS public.depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  manager TEXT,
  phone TEXT,
  email TEXT,
  description TEXT,
  type TEXT DEFAULT 'FIXED', -- 'FIXED' ou 'VEHICLE'
  vehicle_type TEXT DEFAULT NULL, -- 'FOURGON', 'CAMIONNETTE', 'UTILITAIRE', 'POIDS_LOURD', etc.
  license_plate TEXT DEFAULT NULL,
  manager_id TEXT DEFAULT NULL,
  manager_name TEXT DEFAULT NULL,
  binome_ids JSONB DEFAULT '[]'::jsonb,
  binome_names JSONB DEFAULT '[]'::jsonb,
  department_id TEXT DEFAULT NULL,
  department_name TEXT DEFAULT NULL,
  pickup_zones JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Évolution et rétrocompatibilité des colonnes existantes
ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS license_plate TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS binome_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS binome_names JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS department_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS department_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pickup_zones JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Index de recherche rapide
CREATE INDEX IF NOT EXISTS idx_depots_name ON public.depots(name);
CREATE INDEX IF NOT EXISTS idx_depots_type ON public.depots(type);
CREATE INDEX IF NOT EXISTS idx_depots_manager ON public.depots(manager_id);
CREATE INDEX IF NOT EXISTS idx_depots_license_plate ON public.depots(license_plate);
CREATE INDEX IF NOT EXISTS idx_depots_company ON public.depots(company_id);

-- 2. Activation stricte du RLS (Row Level Security)
ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;

-- 3. Fonction RPC de vérification des permissions (Anti-tampering)
CREATE OR REPLACE FUNCTION public.check_user_depot_permission(
  p_depot_id TEXT,
  p_required_role INT DEFAULT 1 -- 0: Admin, 1: Manager, 2: Magasinier
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role INT;
  v_allowed_depots TEXT[];
BEGIN
  -- Récupération du profil utilisateur lié à Supabase Auth
  SELECT role_id, allowed_depots 
  INTO v_user_role, v_allowed_depots
  FROM public.users
  WHERE auth_user_id = auth.uid() OR id::text = auth.uid()::text;

  -- SuperAdmin ou Administrateur Système (accès universel)
  IF v_user_role = 0 THEN
    RETURN TRUE;
  END IF;

  -- Vérification du niveau de rôle
  IF v_user_role IS NOT NULL AND v_user_role > p_required_role THEN
    RETURN FALSE;
  END IF;

  -- Vérification des dépôts autorisés
  IF v_allowed_depots IS NULL OR array_length(v_allowed_depots, 1) = 0 OR p_depot_id = ANY(v_allowed_depots) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- 4. Politiques RLS Sécurisées (Lectures et Écritures contrôlées par RLS)
DROP POLICY IF EXISTS "Secure read depots" ON public.depots;
CREATE POLICY "Secure read depots"
  ON public.depots
  FOR SELECT
  TO authenticated, anon
  USING (
    is_active = true OR public.check_user_depot_permission(id, 1)
  );

DROP POLICY IF EXISTS "Secure write depots" ON public.depots;
CREATE POLICY "Secure write depots"
  ON public.depots
  FOR ALL
  TO authenticated
  USING (
    public.check_user_depot_permission(id, 1)
  )
  WITH CHECK (
    public.check_user_depot_permission(id, 1)
  );

-- 5. Données par défaut initiales
INSERT INTO public.depots (id, name, code, address, description)
VALUES ('dep-01', 'Dépôt Principal', 'DEP-01', 'Siège / Entrepôt Central', 'Stock central outillage et consommables')
ON CONFLICT (name) DO NOTHING;

-- 6. MODÈLE B : Contrôle inviolable du quota de dépôts côté base Client
CREATE TABLE IF NOT EXISTS public.license_config (
  id TEXT PRIMARY KEY DEFAULT 'active_license',
  license_key TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'free',
  max_depots INT NOT NULL DEFAULT 1,
  max_references INT NOT NULL DEFAULT 30,
  raw_token TEXT,
  signature TEXT,
  offline_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.check_license_depot_quota()
RETURNS TRIGGER AS $$
DECLARE
  v_max_depots INT;
  v_app_max_depots INT;
  v_count INT;
BEGIN
  IF NEW.is_active = false THEN
    RETURN NEW;
  END IF;
  -- Si le dépôt existe déjà (cas d'un UPSERT sur un dépôt existant), autoriser la mise à jour
  IF EXISTS (SELECT 1 FROM public.depots WHERE id = NEW.id OR LOWER(name) = LOWER(NEW.name)) THEN
    RETURN NEW;
  END IF;
  SELECT max_depots INTO v_max_depots FROM public.license_config WHERE id = 'active_license';
  BEGIN
    SELECT (value::jsonb->>'max_depots')::int INTO v_app_max_depots
    FROM public.app_settings WHERE key = 'company_license_info' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_app_max_depots := NULL;
  END;
  v_max_depots := GREATEST(COALESCE(v_max_depots, 1), COALESCE(v_app_max_depots, 1));
  IF v_max_depots >= 99999 THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.depots WHERE is_active = true AND id != NEW.id AND LOWER(name) != LOWER(NEW.name);
  IF v_count >= v_max_depots THEN
    RAISE EXCEPTION 'Quota de dépôts dépassé : Votre forfait autorise au maximum % dépôt(s) actif(s). Veuillez mettre à niveau votre licence TOT Stock.', v_max_depots;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_depots_quota ON public.depots;
CREATE TRIGGER trg_check_depots_quota
BEFORE INSERT ON public.depots
FOR EACH ROW EXECUTE FUNCTION public.check_license_depot_quota();
`;

  const handleCopySql = async () => {
    const ok = await copyToClipboard(sqlCreationScript);
    if (ok) {
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    }
  };

  // For transfer destination options
  const otherDepotOptions = depotToDelete
    ? depots.filter((d) => String(d.id) !== String(depotToDelete.id))
    : [];

  const productsInDepotToDelete = depotToDelete
    ? products.filter((p) => p.store_name?.toLowerCase() === depotToDelete.name.toLowerCase())
    : [];

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && depotsModalOpen) {
        if (depotToDelete) {
          setDepotToDelete(null);
        } else if (isFormOpen) {
          handleRequestBackToDepots();
        } else {
          setDepotsModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [depotsModalOpen, depotToDelete, isFormOpen, isDepotFormDirty]);

  if (!depotsModalOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleRequestCloseModal();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-4xl lg:max-w-5xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[94dvh] sm:max-h-[94vh] h-[92dvh] sm:h-[88vh] flex flex-col overflow-hidden">
        
        {isFormOpen ? (
          /* ================= CREATION / EDITION MODE (Plein écran scrollable, rien n'est masqué) ================= */
          <div className="flex flex-col h-full overflow-hidden animate-fadeIn">
            {/* Dedicated Header with back button */}
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={handleRequestBackToDepots}
                  className="py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-black text-xs flex items-center gap-1.5 transition cursor-pointer active:scale-95 shadow-2xs shrink-0"
                >
                  <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
                  <span>{tr(language, '← Revenir aux dépôts', '← Back to stores')}</span>
                </button>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold shrink-0">
                    <Warehouse className="w-4 h-4" />
                  </div>
                  <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                    {editingDepotId
                      ? tr(language, `Modifier : ${name || 'Dépôt'}`, `Edit: ${name || 'Depot'}`)
                      : tr(language, 'Nouveau Magasin / Dépôt', 'Create New Depot')}
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={handleRequestCloseModal}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer shrink-0"
                title={t('common_close')}
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>

            {/* Scrollable Form Body: 100% of height, smooth scrolling, all fields visible with pb-28 */}
            <div className="flex-1 overflow-y-auto mt-2 py-2 pr-1.5 space-y-3.5 text-xs pb-28">
              {isQuotaReached ? (
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-800 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
                    <span>
                      {language === 'fr' ? (
                        <>
                          Vous avez atteint le quota maximal de <strong>{maxDepots} dépôt(s)</strong> pour le forfait{' '}
                          <strong>{getPlanName(license?.plan_type, 'fr')}</strong>.
                        </>
                      ) : (
                        <>
                          You have reached the maximum quota of <strong>{maxDepots} depot(s)</strong> for the{' '}
                          <strong>{getPlanName(license?.plan_type, 'en')}</strong> plan.
                        </>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDepotsModalOpen(false);
                      setCompanySetupModalOpen(true);
                    }}
                    className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-700 transition shrink-0 cursor-pointer shadow-sm"
                  >
                    {tr(language, 'Passer au forfait Pro (10) ou Entreprise (∞)', 'Upgrade Plan')}
                  </button>
                </div>
              ) : (
                <form ref={depotFormRef} onSubmit={handleSubmit} className="space-y-3.5">
                  {/* Type de Dépôt : Fixe vs Véhicule */}
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2.5">
                    <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block">
                      {tr(language, 'Type de dépôt / emplacement *', 'Depot / Location Type *')}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setType('FIXED')}
                        className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-black transition cursor-pointer ${
                          type === 'FIXED'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Warehouse className="w-4 h-4" />
                        <span>{tr(language, '🏢 Dépôt Fixe', '🏢 Fixed Depot')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setType('VEHICLE')}
                        className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-black transition cursor-pointer ${
                          type === 'VEHICLE'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Truck className="w-4 h-4" />
                        <span>{tr(language, '🚚 Véhicule / Fourgon', '🚚 Vehicle / Van')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setType('CONTAINER')}
                        className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-black transition cursor-pointer ${
                          type === 'CONTAINER'
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Package className="w-4 h-4" />
                        <span>{tr(language, '📦 Conteneur Chantier', '📦 Site Container')}</span>
                      </button>
                    </div>

                    {/* Détails spécifiques Véhicule */}
                    {type === 'VEHICLE' && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-2.5 animate-fadeIn">
                        <div>
                          <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1">
                            {tr(language, 'Type de véhicule *', 'Vehicle Type *')}
                          </label>
                          <SearchableSelect
                            value={vehicleType}
                            onChange={(val) => setVehicleType(val)}
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-bold"
                          >
                            <option value="Fourgon">Fourgon d'intervention</option>
                            <option value="Camionnette">Camionnette atelier</option>
                            <option value="Utilitaire">Utilitaire léger (Kangoo / Berlingo)</option>
                            <option value="Poids Lourd">Poids Lourd / Camion benne</option>
                            <option value="Atelier Mobile">Atelier mobile spécialisé</option>
                            <option value="Break / Berline">Véhicule de liaison / Break</option>
                            <option value="Autre">Autre véhicule</option>
                          </SearchableSelect>
                        </div>
                        <div>
                          <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1">
                            {tr(language, 'Plaque d\'immatriculation', 'License Plate')}
                          </label>
                          <input
                            type="text"
                            value={licensePlate}
                            onChange={(e) => setLicensePlate(e.target.value)}
                            placeholder="Ex: AB-123-CD"
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-black uppercase tracking-wider"
                          />
                        </div>
                      </div>
                    )}

                    {/* Détails spécifiques Conteneur de chantier */}
                    {type === 'CONTAINER' && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-2.5 animate-fadeIn">
                        <div>
                          <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1">
                            {tr(language, 'N° / Réf. Conteneur', 'Container Ref / ID')}
                          </label>
                          <input
                            type="text"
                            value={containerRef}
                            onChange={(e) => setContainerRef(e.target.value)}
                            placeholder="Ex: CONT-042, BUNG-01"
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold uppercase"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1">
                            {tr(language, 'Chantier rattaché (Conducteur associé)', 'Associated Project / Site')}
                          </label>
                          <SearchableSelect
                            value={projectNumber}
                            onChange={(val) => setProjectNumber(val)}
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                          >
                            <option value="">{tr(language, '-- Sélectionner un chantier --', '-- Select project --')}</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.project_number}>
                                {p.project_number} - {p.project_name}
                              </option>
                            ))}
                          </SearchableSelect>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1">
                        {type === 'VEHICLE'
                          ? tr(language, 'Nom ou numéro du véhicule *', 'Vehicle Name or # *')
                          : tr(language, 'Nom du magasin / dépôt *', 'Store / Depot Name *')}
                      </label>
                      <input
                        ref={depotNameInputRef}
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={
                          type === 'VEHICLE'
                            ? tr(language, 'Ex: Fourgon Plomberie 01, Camionnette Marc...', 'Ex: Service Van 01...')
                            : tr(language, 'Ex: Dépôt Principal, Atelier Sud...', 'Ex: Main Depot...')
                        }
                        required
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1">
                        {tr(language, 'Code court', 'Short Code')}
                      </label>
                      <input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder={type === 'VEHICLE' ? 'Ex: VEH-01' : 'Ex: DEP-01'}
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-mono font-bold"
                      />
                    </div>
                  </div>

                  {/* Responsable & Département */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        <span>{type === 'VEHICLE' ? (tr(language, 'Chauffeur / Responsable du véhicule', 'Vehicle Driver / Manager')) : (tr(language, 'Responsable du dépôt', 'Depot Manager'))}</span>
                      </label>
                      <SearchableSelect
                        value={managerId}
                        onChange={(newMgrId) => {
                          setManagerId(newMgrId);
                          const newDriver = users.find((u) => String(u.id) === String(newMgrId));
                          if (newDriver?.department && newDriver.department !== 'Général') {
                            // Preselect department if not explicitly set
                            const matchingDept = departments.find(
                              (d) => d.name.toLowerCase().trim() === newDriver.department!.toLowerCase().trim()
                            );
                            if (matchingDept && !departmentId) {
                              setDepartmentId(String(matchingDept.id));
                            }
                            // Filter out existing binômes that are not in the new driver's department
                            setBinomeIds((prev) =>
                              prev.filter((bId) => {
                                const bUser = users.find((u) => String(u.id) === String(bId));
                                return (
                                  bUser &&
                                  String(bUser.id) !== String(newMgrId) &&
                                  bUser.department?.toLowerCase().trim() === newDriver.department!.toLowerCase().trim()
                                );
                              })
                            );
                          }
                        }}
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                      >
                        <option value="">{tr(language, '— Aucun / Non assigné —', '— None / Unassigned —')}</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.trigram}){u.department ? ` • ${u.department}` : ''}
                          </option>
                        ))}
                      </SearchableSelect>
                    </div>

                    <div>
                      <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>{tr(language, 'Département / Service de rattachement', 'Assigned Department')}</span>
                      </label>
                      <SearchableSelect
                        value={departmentId}
                        onChange={(val) => setDepartmentId(val)}
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                      >
                        <option value="">{tr(language, '— Direction générale / Global —', '— General / Global —')}</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </SearchableSelect>
                    </div>
                  </div>

                  {/* Section Responsables du dépôt (stk_depot_holders : Envoi can_send & Réception can_receive) */}
                  <DepotHoldersSection
                    language={language}
                    users={users}
                    holders={draftHolders}
                    onChange={setDraftHolders}
                    canEdit={canEditDepotHolders}
                    depotId={editingDepotId}
                    onSaveDirect={
                      editingDepotId !== null
                        ? (nextHolders) => saveDepotHolders(editingDepotId, nextHolders)
                        : undefined
                    }
                  />

                  {/* Binômes autorisés sur ce véhicule (Règle stricte Camionnette) */}
                  {type === 'VEHICLE' && (
                    <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 space-y-2 animate-fadeIn">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <label className="text-[11px] font-black text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>{tr(language, 'Binôme(s) / Équipiers autorisés sur cette camionnette', 'Authorized Vehicle Binômes / Teammates')}</span>
                        </label>
                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                          {binomeIds.length} {tr(language, 'binôme(s) associé(s)', 'binôme(s) paired')}
                        </span>
                      </div>

                      <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-emerald-100 dark:border-emerald-900/50 text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-2">
                        <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-emerald-900 dark:text-emerald-200 block font-bold">
                            {tr(language, 'Règle stricte d\'accès camionnette :', 'Strict vehicle access policy:')}
                          </strong>
                          <p className="text-[10.5px] mt-0.5 text-slate-600 dark:text-slate-400">
                            {tr(language, '• Seul le titulaire et ses binômes peuvent emprunter ou prélever du matériel dans cette camionnette.', '• Only the driver and their assigned binômes can borrow/withdraw material from this vehicle.')}
                            <br />
                            {tr(language, '• Le titulaire et ses binômes peuvent y entrer du stock (retours chantier, approvisionnement) même sans droit d\'entrée dans les autres dépôts.', '• The driver and binômes can enter stock here even without general inflow rights in other depots.')}
                          </p>
                        </div>
                      </div>

                      {(() => {
                        const selectedDriver = users.find((u) => String(u.id) === String(managerId));
                        return (
                          <div className="pt-1">
                            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                              <span className="text-[10.5px] font-bold text-slate-700 dark:text-slate-300">
                                {language === 'fr'
                                  ? `Équipiers éligibles ${selectedDriver?.department ? `(Département « ${selectedDriver.department} »)` : ''} :`
                                  : `Eligible teammates ${selectedDriver?.department ? `(Department « ${selectedDriver.department} »)` : ''}:`}
                              </span>
                              <span className="text-[10px] text-amber-700 dark:text-amber-300 font-bold bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                                {tr(language, '⚠️ Même département obligatoire', '⚠️ Same department required')}
                              </span>
                            </div>

                            {!managerId ? (
                              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                                <span>
                                  {tr(language, 'Veuillez d\'abord sélectionner le Chauffeur / Responsable ci-dessus. Les binômes doivent obligatoirement appartenir à son département.', 'Please select the vehicle driver above first. Binômes must belong to the driver\'s department.')}
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                                {users
                                  .filter((u) => {
                                    if (String(u.id) === String(managerId)) return false;
                                    if (!selectedDriver?.department || selectedDriver.department === 'Général') return true;
                                    return u.department && u.department.toLowerCase().trim() === selectedDriver.department.toLowerCase().trim();
                                  })
                                  .map((u) => {
                                    const isSelected = binomeIds.some((id) => String(id) === String(u.id));
                                    return (
                                      <button
                                        key={u.id}
                                        type="button"
                                        onClick={() => {
                                          if (isSelected) {
                                            setBinomeIds(binomeIds.filter((id) => String(id) !== String(u.id)));
                                          } else {
                                            setBinomeIds([...binomeIds, u.id]);
                                          }
                                        }}
                                        className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 cursor-pointer ${
                                          isSelected
                                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                      >
                                        <span>{u.name}</span>
                                        <span className={`text-[10px] font-mono px-1 rounded ${isSelected ? 'bg-emerald-700 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                          {u.trigram}
                                        </span>
                                        {isSelected ? '✓' : '+'}
                                      </button>
                                    );
                                  })}
                                {users.filter((u) => {
                                  if (String(u.id) === String(managerId)) return false;
                                  if (!selectedDriver?.department || selectedDriver.department === 'Général') return true;
                                  return u.department && u.department.toLowerCase().trim() === selectedDriver.department.toLowerCase().trim();
                                }).length === 0 && (
                                  <span className="text-xs text-slate-400 italic">
                                    {tr(language, `Aucun autre équipier disponible dans le département « ${selectedDriver?.department || 'Général'} ».`, `No other teammates in department "${selectedDriver?.department || 'General'}".`)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1">
                        {tr(language, 'Adresse / Emplacement physique', 'Address / Physical Location')}
                      </label>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={tr(language, 'Ex: Hangar 4, Z.I. Nord, 12 rue des Artisans...', 'Ex: Warehouse 4, North Industrial Park...')}
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 block mb-1">
                        {tr(language, 'Description / Notes d\'accès', 'Description / Notes')}
                      </label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={tr(language, 'Ex: Outillage, plomberie, consommables lourds...', 'Ex: Heavy equipment, consumables...')}
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                      />
                    </div>
                  </div>

                  {/* Statut En Activité / Fermeture temporaire */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {isActive ? (
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <Check className="w-5 h-5 stroke-[2.5]" />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                          <PauseCircle className="w-5 h-5" />
                        </div>
                      )}
                      <div>
                        <div className="font-black text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>
                            {isActive
                              ? tr(language, 'Magasin actif / Ouvert', 'Active Depot / Open')
                              : tr(language, 'Fermeture temporaire (Mise en veille)', 'Temporary Closure (Standby)')}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {isActive
                            ? tr(language, 'Les références de ce dépôt sont visibles et consultables dans la recherche et les commandes.', 'Items in this depot are visible and searchable in orders.')
                            : tr(language, 'Les outils et références de ce dépôt seront masqués pour les opérateurs lors des retraits.', 'Items in this depot will be hidden during collections.')}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (!canDeactivateDepots && isActive) {
                          setErrorMessage(
                            tr(language, 'La mise en veille / fermeture temporaire d’un magasin ou dépôt est réservée aux forfaits STANDARD et supérieurs.', 'Temporary depot standby is restricted to STANDARD and higher plans.')
                          );
                          return;
                        }
                        setIsActive((prev) => !prev);
                      }}
                      className={`py-2 px-3.5 rounded-xl text-xs font-black transition flex items-center gap-1.5 shrink-0 cursor-pointer shadow-2xs active:scale-95 ${
                        isActive
                          ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-amber-100 hover:text-amber-800'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {isActive ? (
                        <>
                          <PauseCircle className="w-4 h-4 text-amber-500" />
                          <span>{tr(language, 'Mettre en veille', 'Put on Standby')}</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>{tr(language, 'Réactiver le dépôt', 'Reactivate Depot')}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* 🎯 Zones de Retrait Préconfigurées pour ce Dépôt */}
                  <div className="p-4 rounded-2xl bg-purple-50/90 dark:bg-purple-950/30 border-2 border-purple-200 dark:border-purple-900/60 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <label className="text-xs font-black text-purple-950 dark:text-purple-200 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        <span>{tr(language, '🎯 Emplacements & Casiers de Retrait (Où les commandes sont mises à disposition)', '🎯 Pickup Locations & Storage Bins')}</span>
                      </label>
                      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-black bg-purple-200/80 dark:bg-purple-900/60 text-purple-900 dark:text-purple-200">
                        {pickupZones.length} {tr(language, 'emplacement(s)', 'location(s)')}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-tight">
                      {tr(language, 'Configurez ici les casiers de retrait, étagères, comptoirs ou zones Drive de ce magasin. Lors de la préparation d\'une commande, le magasinier sélectionne l\'emplacement où le demandeur doit venir récupérer son matériel.', 'Define specific bins, shelves, counters, or drive zones for this depot. Storekeepers select them with 1 tap when making orders ready.')}
                    </p>

                    {/* Existing zones tags */}
                    <div className="flex flex-wrap gap-2 min-h-[30px] p-2 rounded-xl bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800/60">
                      {pickupZones.length === 0 ? (
                        <span className="text-[11px] italic text-slate-400 my-auto">
                          {tr(language, 'Aucun casier configuré. Utilisez les suggestions ci-dessous ou ajoutez-en un.', 'No preconfigured zones.')}
                        </span>
                      ) : (
                        pickupZones.map((zone, zIdx) => (
                          <span
                            key={zIdx}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black bg-purple-100 dark:bg-purple-950 text-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-800 shadow-2xs"
                          >
                            <MapPin className="w-3.5 h-3.5 text-purple-600" />
                            <span>{zone}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveZone(zIdx)}
                              className="w-4 h-4 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer ml-1"
                              title="Supprimer cet emplacement"
                            >
                              <X className="w-3 h-3 stroke-[2.5]" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    {/* Add zone input + quick presets */}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={newZoneInput}
                        onChange={(e) => setNewZoneInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddZone();
                          }
                        }}
                        placeholder={tr(language, 'Ex: Casier 01, Étagère B3, Quai Retrait, Conteneur...', 'Ex: Bin A1, Shelf B2, Gate 3...')}
                        className="flex-1 px-3.5 py-2 text-xs bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-800 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddZone()}
                        className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs flex items-center gap-1.5 shadow-xs transition active:scale-95 cursor-pointer shrink-0"
                      >
                        <Plus className="w-4 h-4 stroke-[2.5]" />
                        <span>{tr(language, 'Ajouter', 'Add')}</span>
                      </button>
                    </div>

                    {/* Quick Preset Buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5 text-[11px]">
                      <span className="text-slate-500 dark:text-slate-400 font-bold">{tr(language, 'Suggestions rapides :', 'Suggestions:')}</span>
                      {['Casier 01', 'Casier 02', 'Étagère Retrait A', 'Comptoir Magasin', 'Zone Drive Quai', 'Conteneur Extérieur'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleAddZone(preset)}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800 hover:border-purple-500 text-purple-900 dark:text-purple-200 font-bold transition cursor-pointer active:scale-95 shadow-2xs"
                        >
                          + {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sticky Footer Form Buttons */}
                  <div className="sticky bottom-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5 z-20">
                    <button
                      type="button"
                      onClick={handleRequestBackToDepots}
                      className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-black text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      {tr(language, 'Annuler', 'Cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs flex items-center gap-2 shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      {editingDepotId ? (
                        <>
                          <Check className="w-4 h-4 stroke-[2.5]" />
                          <span>
                            {isSubmitting
                              ? tr(language, 'Enregistrement...', 'Saving...')
                              : tr(language, 'Mettre à jour le magasin', 'Update Store')}
                          </span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 stroke-[2.5]" />
                          <span>
                            {isSubmitting
                              ? tr(language, 'Création...', 'Creating...')
                              : tr(language, 'Créer le magasin', 'Create Store')}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : (
          /* ================= LIST MODE: 20% Top Controls / 80% Scrolling Depot List ================= */
          <div className="flex flex-col h-full overflow-hidden">
            {/* TOP CONTROLS SECTION: Strictly represents 20% of display */}
            <div className="shrink-0 space-y-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
              {/* Row 1: Header with Title, Plan & Actions */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold shrink-0">
                    <Warehouse className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex items-center gap-2">
                    <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                      {t('depots_title')}
                    </h2>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 shrink-0">
                      {getPlanName(license?.plan_type, language)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!isQuotaReached && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDepotId(null);
                        setName('');
                        setCode(`DEP-${String(depots.length + 1).padStart(2, '0')}`);
                        setAddress('');
                        setDescription('');
                        setPickupZones(['Casier 01', 'Casier 02']);
                        setIsFormOpen(true);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs flex items-center gap-1 shadow-xs transition shrink-0 cursor-pointer active:scale-95"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>{tr(language, '+ Nouveau', '+ New')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setDepotsModalOpen(false)}
                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer active:scale-95 shrink-0"
                    title={t('common_close')}
                    aria-label="Fermer"
                  >
                    <X className="w-4 h-4 stroke-[2.5]" />
                  </button>
                </div>
              </div>

              {/* Row 2: COMPACT SUPABASE & QUOTA BAR */}
              <div className="px-2.5 py-1.5 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isSupabaseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                  <span className="font-extrabold text-[11px] text-slate-800 dark:text-slate-200">
                    {isSupabaseConnected ? 'Supabase Connecté' : 'Supabase Local'}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                    public.depots
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                    Quota : <strong>{activeDepotsCount}</strong> / {isUnlimited ? '∞' : maxDepots}
                  </span>
                </div>

                {/* All buttons */}
                <div className="flex flex-wrap items-center gap-1">
                  {isSupabaseConnected ? (
                    <>
                      <button
                        type="button"
                        onClick={handleSyncAllToSupabase}
                        disabled={isSyncingAll}
                        className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10.5px] flex items-center gap-1 shadow-2xs transition cursor-pointer disabled:opacity-50 shrink-0"
                        title="Pousser tous les dépôts locaux dans la table SQL Supabase"
                      >
                        <RefreshCw className={`w-3 h-3 ${isSyncingAll ? 'animate-spin' : ''}`} />
                        <span>{isSyncingAll ? 'Sync...' : 'Pousser SQL'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleTestTable}
                        disabled={isTestingTable}
                        className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-[10.5px] border border-slate-200 dark:border-slate-600 transition cursor-pointer shrink-0"
                        title="Vérifier la table SQL public.depots"
                      >
                        <span>{isTestingTable ? 'Test...' : 'Tester table'}</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDepotsModalOpen(false);
                        setCompanySetupModalOpen(true);
                      }}
                      className="px-2 py-0.5 rounded-lg bg-amber-600 text-white font-bold text-[10.5px] flex items-center gap-1 transition cursor-pointer shrink-0"
                    >
                      <span>{t('depots_connect_supabase')}</span>
                    </button>
                  )}

                  {license?.plan_type !== 'ent' && (
                    <button
                      type="button"
                      onClick={() => {
                        setDepotsModalOpen(false);
                        setCompanySetupModalOpen(true);
                      }}
                      className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-[10.5px] border border-slate-200 dark:border-slate-600 flex items-center gap-0.5 transition cursor-pointer shrink-0"
                      title="Changer de forfait"
                    >
                      <Sparkles className="w-2.5 h-2.5 text-amber-500" />
                      <span>Plan</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowSqlGuide(!showSqlGuide)}
                    className="px-2 py-0.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-bold text-[10.5px] flex items-center gap-1 transition cursor-pointer shrink-0"
                    title={showSqlGuide ? 'Masquer script SQL' : 'Afficher script SQL'}
                  >
                    <Database className="w-2.5 h-2.5" />
                    <span>SQL</span>
                  </button>
                </div>
              </div>

              {/* Row 3: Compact Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={tr(language, `Rechercher parmi les ${depots.length} magasins / dépôts...`, `Search across ${depots.length} stores...`)}
                  className="w-full pl-8 pr-8 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Alerts */}
            {errorMessage && (
              <div className="mt-1.5 p-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 animate-fadeIn shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="flex-1">{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="cursor-pointer">✕</button>
              </div>
            )}
            {successMessage && (
              <div className="mt-1.5 p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2 animate-fadeIn shrink-0">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="flex-1">{successMessage}</span>
                <button onClick={() => setSuccessMessage(null)} className="cursor-pointer">✕</button>
              </div>
            )}

            {/* Delete Confirmation Modal / Card Overlay */}
            {depotToDelete && (
              <div className="mt-1.5 p-3 rounded-2xl bg-rose-50/95 dark:bg-rose-950/90 border-2 border-rose-300 dark:border-rose-800 text-xs shadow-lg animate-fadeIn shrink-0">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-rose-200 dark:bg-rose-900/80 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-black text-rose-900 dark:text-rose-100 text-sm">
                      {tr(language, `Supprimer le dépôt « ${depotToDelete.name} » ?`, `Delete depot "${depotToDelete.name}"?`)}
                    </h3>

                    {productsInDepotToDelete.length === 0 ? (
                      <p className="text-slate-600 dark:text-slate-300 mt-1">
                        {tr(language, "Aucune référence n'est rattachée à ce dépôt. La suppression sera immédiate et répercutée dans Supabase.", 'No items are linked to this depot. Deletion will take effect immediately and sync with Supabase.')}
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <p className="text-rose-800 dark:text-rose-200 font-semibold">
                          {language === 'fr' ? (
                            <>
                              Attention : <strong>{productsInDepotToDelete.length} référence(s)</strong> sont actuellement stockées dans ce dépôt.
                            </>
                          ) : (
                            <>
                              Warning: <strong>{productsInDepotToDelete.length} item(s)</strong> are currently stored in this depot.
                            </>
                          )}
                        </p>

                        <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-rose-200 dark:border-rose-900 space-y-2">
                          <div className="font-bold text-slate-800 dark:text-slate-200">
                            {tr(language, 'Que souhaitez-vous faire de ces références ?', 'What would you like to do with these items?')}
                          </div>

                          {otherDepotOptions.length > 0 && (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="reassignChoice"
                                checked={reassignAction === 'transfer'}
                                onChange={() => setReassignAction('transfer')}
                                className="text-amber-600 focus:ring-amber-500"
                              />
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {tr(language, 'Transférer vers un autre dépôt :', 'Transfer to another depot:')}
                              </span>
                              <SearchableSelect
                                value={targetTransferDepot}
                                disabled={reassignAction !== 'transfer'}
                                onChange={(val) => setTargetTransferDepot(val)}
                                recentKey="depots"
                                className="ml-1 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-bold text-xs outline-none focus:ring-1 focus:ring-amber-500"
                              >
                                {otherDepotOptions.map((opt) => (
                                  <option key={opt.id} value={opt.name}>
                                    {opt.name} {opt.code ? `(${opt.code})` : ''}
                                  </option>
                                ))}
                              </SearchableSelect>
                            </label>
                          )}

                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="reassignChoice"
                              checked={reassignAction === 'detach'}
                              onChange={() => setReassignAction('detach')}
                              className="text-amber-600 focus:ring-amber-500"
                            />
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {tr(language, 'Détacher les références (conserver le stock sans magasin attribué)', 'Detach items (keep stock with no assigned depot)')}
                            </span>
                          </label>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-rose-200/80 dark:border-rose-900/80">
                      <button
                        type="button"
                        onClick={() => setDepotToDelete(null)}
                        disabled={isDeleting}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs hover:bg-white dark:hover:bg-slate-800 transition cursor-pointer"
                      >
                        {tr(language, 'Annuler', 'Cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={executeDelete}
                        disabled={isDeleting}
                        className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs flex items-center gap-1.5 shadow transition cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>
                          {isDeleting
                            ? tr(language, 'Suppression en cours...', 'Deleting...')
                            : tr(language, 'Confirmer la suppression', 'Confirm Delete')}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Collapsible SQL Table Creation Guide */}
            {showSqlGuide && (
              <div className="mt-2 p-3 bg-slate-900 text-slate-200 rounded-2xl border border-slate-800 text-[11px] font-mono space-y-2 animate-fadeIn max-h-44 overflow-y-auto shrink-0">
                <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                  <span className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    <span>{tr(language, 'Script SQL Supabase (public.depots)', 'Supabase SQL (public.depots)')}</span>
                  </span>
                  <button
                    onClick={handleCopySql}
                    className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSql ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSql ? (tr(language, 'Copié !', 'Copied!')) : (tr(language, 'Copier tout', 'Copy All'))}</span>
                  </button>
                </div>
                <pre className="text-[10px] text-slate-300 overflow-x-auto whitespace-pre p-2 bg-slate-950/70 rounded-xl">
                  {sqlCreationScript}
                </pre>
              </div>
            )}

            {/* 80% SCROLLING DEPOT LIST: Maximum space, smooth scrolling */}
            <div className="flex-1 min-h-0 overflow-y-auto mt-2 space-y-2 pr-1 text-xs">
          {filteredDepots.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Warehouse className="w-10 h-10 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
              {searchQuery ? (
                <p>
                  {tr(language, `Aucun magasin/dépôt ne correspond à « ${searchQuery} »`, `No store/depot matches "${searchQuery}"`)}
                </p>
              ) : (
                <div className="space-y-2">
                  <p>{t('depots_empty')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDepotId(null);
                      setName(tr(language, 'Dépôt Principal', 'Main Depot'));
                      setCode('DEP-01');
                      setIsFormOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-amber-600 text-white font-bold text-xs inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('depots_create_first')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            filteredDepots.map((d) => {
              const productCount = products.filter(
                (p) => p.store_name?.toLowerCase() === d.name.toLowerCase()
              ).length;

              return (
                <div
                  key={d.id}
                  className={`p-3 sm:p-3.5 bg-white dark:bg-slate-900 border rounded-2xl flex flex-col sm:flex-row items-start justify-between gap-3 shadow-sm hover:border-amber-400 dark:hover:border-amber-600 transition ${
                    editingDepotId === d.id
                      ? 'border-amber-500 ring-2 ring-amber-500/20'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      d.type === 'VEHICLE'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                    }`}>
                      {d.type === 'VEHICLE' ? <Truck className="w-4 h-4" /> : <Warehouse className="w-4 h-4" />}
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-900 dark:text-white text-xs">
                          {d.name}
                        </span>
                        {d.code && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {d.code}
                          </span>
                        )}

                        {/* Type & Vehicle Badge */}
                        {d.type === 'VEHICLE' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-300 flex items-center gap-1 border border-emerald-300 dark:border-emerald-800">
                            <Truck className="w-3 h-3 text-emerald-600" />
                            <span>{d.vehicle_type || 'Véhicule'}</span>
                            {d.license_plate && <span className="font-mono bg-emerald-200/80 dark:bg-emerald-900/80 px-1 rounded text-[9.5px]">[{d.license_plate}]</span>}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center gap-1">
                            <Warehouse className="w-3 h-3 text-amber-600" />
                            <span>{tr(language, 'Dépôt Fixe', 'Fixed')}</span>
                          </span>
                        )}

                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100/70 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 flex items-center gap-1">
                          <Package className="w-3 h-3" />
                          {productCount} {tr(language, `référence${productCount > 1 ? 's' : ''}`, `item${productCount > 1 ? 's' : ''}`)}
                        </span>

                        {/* Status Badge */}
                        {d.is_active !== false ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 flex items-center gap-1 border border-emerald-300 dark:border-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            {t('depots_active_badge')}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 flex items-center gap-1 border border-amber-400 dark:border-amber-700">
                            <PauseCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                            {t('depots_closed_badge')}
                          </span>
                        )}
                      </div>

                      {/* Responsable & Service / Département */}
                      {(d.manager_name || d.department_name) && (
                        <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400 mt-1 flex-wrap">
                          {d.manager_name && (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3 text-amber-500 shrink-0" />
                              <span>{d.type === 'VEHICLE' ? (tr(language, 'Chauffeur titulaire :', 'Assigned Driver:')) : (tr(language, 'Responsable :', 'Manager:'))} <strong className="text-slate-800 dark:text-slate-200">{d.manager_name}</strong></span>
                            </span>
                          )}
                          {d.department_name && (
                            <span className="flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-blue-500 shrink-0" />
                              <span>{tr(language, 'Département :', 'Dept:')} <strong className="text-slate-800 dark:text-slate-200">{d.department_name}</strong></span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Responsables stk_depot_holders & avertissement si aucun responsable de réception */}
                      {(() => {
                        const dHolders = depotHolders.filter((h) => String(h.depot_id) === String(d.id));
                        const hasReceiver = dHolders.some((h) => Boolean(h.can_receive));
                        return (
                          <div className="flex items-center gap-2 text-[11px] mt-1 flex-wrap">
                            <span className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              <span>{tr(language, 'Responsables :', 'Holders:', 'Verantwoordelijken:')}</span>
                            </span>
                            {dHolders.length > 0 ? (
                              dHolders.map((h) => {
                                const hu = users.find((u) => String(u.id) === String(h.user_id));
                                return (
                                  <span
                                    key={String(h.user_id)}
                                    className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800"
                                  >
                                    {hu?.name || `#${h.user_id}`} ({h.can_send ? 'Env' : ''}
                                    {h.can_send && h.can_receive ? '/' : ''}
                                    {h.can_receive ? 'Réc' : ''})
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">
                                {tr(language, 'Aucun responsable configuré', 'No holder configured', 'Geen verantwoordelijke')}
                              </span>
                            )}
                            {!hasReceiver && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300 dark:border-amber-800 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                {tr(
                                  language,
                                  'Aucun responsable de réception',
                                  'No reception holder',
                                  'Geen ontvangstverantwoordelijke'
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      {/* Binômes assignés sur véhicule */}
                      {d.type === 'VEHICLE' && (
                        <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400 mt-1 flex-wrap">
                          <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                            <Users className="w-3 h-3" />
                            <span>{tr(language, 'Binôme(s) autorisés :', 'Authorized binômes:')}</span>
                          </span>
                          {d.binome_names && d.binome_names.length > 0 ? (
                            d.binome_names.map((bn, bIdx) => (
                              <span
                                key={bIdx}
                                className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                              >
                                {bn}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">
                              {tr(language, 'Aucun binôme assigné', 'No binômes assigned')}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 flex items-center gap-0.5 ml-1">
                            <Lock className="w-2.5 h-2.5 text-slate-400" />
                            <span>{tr(language, 'Accès strict titulaire & binômes', 'Strict access')}</span>
                          </span>
                        </div>
                      )}

                      {d.address && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          <MapPin className="w-3 h-3 shrink-0 text-slate-400" />
                          <span>{d.address}</span>
                        </div>
                      )}

                      {d.description && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                          {d.description}
                        </p>
                      )}

                      {/* Preconfigured Pickup Zones preview */}
                      <div className="flex items-center gap-1.5 flex-wrap mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800">
                        <span className="text-[10.5px] font-black text-purple-700 dark:text-purple-300 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                          <span>{tr(language, 'Emplacements de retrait :', 'Pickup locations:')}</span>
                        </span>
                        {d.pickup_zones && d.pickup_zones.length > 0 ? (
                          d.pickup_zones.map((zone, zIdx) => (
                            <span
                              key={zIdx}
                              className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-purple-50 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-2xs"
                            >
                              {zone}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">
                            {tr(language, 'Aucun casier configuré', 'No bins configured')}
                          </span>
                        )}
                        {canManageDepots && (
                          <button
                            type="button"
                            onClick={() => handleStartEdit(d)}
                            className="ml-auto text-[10.5px] text-purple-600 dark:text-purple-400 hover:text-purple-800 font-bold hover:underline cursor-pointer flex items-center gap-0.5"
                          >
                            <span>⚙️ {tr(language, 'Gérer les casiers', 'Manage bins')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {canManageDepots && (
                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-start flex-wrap">
                      {/* Quick Activate / Deactivate Toggle Button */}
                      <button
                        onClick={() => handleToggleStatus(d)}
                        disabled={togglingDepotId === d.id}
                        className={`px-2.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs disabled:opacity-50 ${
                          d.is_active !== false
                            ? 'bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        }`}
                        title={
                          d.is_active !== false
                            ? t('depots_deactivate_confirm')
                            : t('depots_reactivate_confirm')
                        }
                      >
                        {d.is_active !== false ? (
                          <>
                            <PauseCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                            <span className="hidden sm:inline">{t('depots_btn_deactivate')}</span>
                          </>
                        ) : (
                          <>
                            <PlayCircle className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{t('depots_btn_reactivate')}</span>
                          </>
                        )}
                      </button>

                      {d.type === 'VEHICLE' && (
                        <button
                          type="button"
                          onClick={() => {
                            setDepotsModalOpen(false);
                            openInventoryAuditForDepot(d.name);
                          }}
                          className="px-2.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                          title={tr(language, 'Lancer un comptage d’inventaire sur ce véhicule', 'Start vehicle inventory count')}
                        >
                          <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="hidden sm:inline">{tr(language, 'Inventaire', 'Audit')}</span>
                        </button>
                      )}

                      <button
                        onClick={() => handleStartEdit(d)}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                        title={tr(language, 'Modifier ce magasin / dépôt', 'Edit store / depot')}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => promptDelete(d)}
                        className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600 transition cursor-pointer"
                        title={tr(language, 'Supprimer définitivement ce magasin / dépôt', 'Permanently delete this depot')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
          </div>
        )}
      </div>

      {/* 🚚 Modal Prompt : Comptage contradictoire de véhicule proposé au changement de responsable */}
      {vehicleManagerChangeAuditPrompt && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border-2 border-emerald-500 rounded-3xl max-w-md w-full p-6 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 flex items-center justify-center text-2xl shadow-inner">
              🚚
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {tr(language, 'Comptage de Véhicule Recommandé', 'Vehicle Inventory Count Proposed')}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
                {language === 'fr' ? (
                  <>
                    Le responsable assigné au véhicule <strong>« {vehicleManagerChangeAuditPrompt.depotName} »</strong> a été modifié :
                    <br />
                    <span className="text-rose-500 line-through font-semibold">{vehicleManagerChangeAuditPrompt.oldManagerName}</span> ➜{' '}
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{vehicleManagerChangeAuditPrompt.newManagerName}</span>.
                    <br /><br />
                    Pour garantir la traçabilité lors de la passation des clés, souhaitez-vous lancer immédiatement un <strong>comptage contradictoire de l'inventaire embarqué</strong> ?
                  </>
                ) : (
                  <>
                    The vehicle manager for <strong>« {vehicleManagerChangeAuditPrompt.depotName} »</strong> was updated :
                    <br />
                    <span className="text-rose-500 line-through font-semibold">{vehicleManagerChangeAuditPrompt.oldManagerName}</span> ➜{' '}
                    <span className="text-emerald-600 font-bold">{vehicleManagerChangeAuditPrompt.newManagerName}</span>.
                    <br /><br />
                    Would you like to start a vehicle handover stock count now?
                  </>
                )}
              </p>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  const target = vehicleManagerChangeAuditPrompt.depotName;
                  setVehicleManagerChangeAuditPrompt(null);
                  setDepotsModalOpen(false);
                  openInventoryAuditForDepot(target);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-md active:scale-95"
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>{tr(language, 'Lancer le comptage véhicule', 'Start Vehicle Count')}</span>
              </button>
              <button
                type="button"
                onClick={() => setVehicleManagerChangeAuditPrompt(null)}
                className="py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition cursor-pointer"
              >
                {tr(language, 'Plus tard', 'Later')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
