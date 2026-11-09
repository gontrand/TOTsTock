export interface Product {
  id: string;
  reference: string;
  manufacturer_ref?: string;
  barcode?: string;
  qr_code?: string;
  brand: string;
  model: string;
  sub_category_id?: number | null;
  unit_price: number;
  description?: string;
  tags?: string;
  supplier_1_name?: string;
  ref_supplier_1?: string;
  supplier_2_name?: string;
  ref_supplier_2?: string;
  store_name?: string;
  room_name?: string;
  shelf_name?: string;
  rack_location?: string;
  quantity: number;
  min_stock_alert: number;
  created_at?: string;
}

export type MovementType = 'IN' | 'OUT';

export interface StockMovement {
  id: string;
  product_id: string;
  product_ref?: string;
  user_id?: string | number | null;
  user_name?: string;
  movement_type: MovementType;
  quantity_changed: number;
  site_number?: string | null;
  department_name?: string | null;
  total_cost?: number;
  order_number?: string | null; // N° de commande magasin si rattaché à une commande
  created_at: string;
  depot_name?: string | null;
  dest_depot_name?: string | null;
  dest_rack?: string | null;
  batch_id?: string | null;
  type?: MovementType | string;
  action?: string;
  quantity?: number;
  reason?: string | null;
  project_name?: string | null;
  department?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Role {
  id: number;
  name: string;
  permissions: string[];
}

export interface User {
  id: string | number;
  auth_user_id?: string;
  name: string;
  trigram: string;
  email?: string;
  department?: string;
  pin?: string; // Optional: legacy or local unlock only (not in DB after script 02)
  pin_hash?: string;
  role_id: number;
  is_blocked: boolean;
  allowed_depots?: string[]; // List of depot names or IDs, or undefined/['*'] for all
  must_change_pin?: boolean; // Requires password/PIN change on next login
  is_preparer?: boolean; // If department has is_preparer_dept, can manage/pick orders
  binome_id?: string | number | null; // Binôme attitré (autre technicien/équipier)
  binome_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Department {
  id: number;
  name: string;
  manager_id?: string | number | null;
  deputy_manager_ids?: (string | number)[];
  allow_global_kpis?: boolean;
  is_preparer_dept?: boolean; // Option Préparateurs: allows assigning preparer role to users
  require_order_approval?: boolean; // Validation hiérarchique débrayable
  order_approval_threshold?: number; // Seuil en € déclenchant la validation (ex: 300 €)
}

export type ProjectStatus = 'IN_PROGRESS' | 'CLOSED';

export interface Project {
  id: number;
  department_id: number;
  project_number: string;
  project_name: string;
  manager_id?: string | number | null;
  deputy_manager_ids?: (string | number)[];
  status?: ProjectStatus;
  closed_at?: string | null;
  closed_by?: string | number | null;
  closed_by_name?: string | null;
  close_note?: string | null;
}

export type CurrencyCode = 'EUR' | 'USD' | 'CHF' | 'GBP' | 'CAD' | 'XOF' | 'MAD' | 'DZD' | 'TND';

export interface SubCategory {
  id: number;
  name: string;
}

export interface StockLevel {
  id?: string;
  product_id: string;
  depot_name: string;
  quantity: number;
  min_alert?: number;
  rack_location?: string;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Depot {
  id: string | number;
  name: string;
  code?: string;
  address?: string;
  description?: string;
  is_active?: boolean;
  type?: 'FIXED' | 'VEHICLE' | 'CONTAINER';
  vehicle_type?: string; // Fourgon, Camionnette, Utilitaire, Poids Lourd, etc.
  license_plate?: string;
  container_ref?: string; // Référence / numéro du conteneur de chantier
  project_number?: string; // Chantier rattaché (projects.project_number)
  manager_id?: string | number | null;
  manager_name?: string | null;
  binome_ids?: (string | number)[]; // Binômes autorisés à emprunter et entrer du stock
  binome_names?: string[];
  department_id?: string | number | null;
  department_name?: string | null;
  pickup_zones?: string[]; // Zones de retrait préconfigurées pour ce dépôt
  created_at?: string;
  updated_at?: string;
}

export interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from_email: string;
  from_name: string;
}

export interface AppSetting {
  key: string;
  value: string;
}

export interface BatchCartItem {
  product: Product;
  qtyActual: number;
  targetDepotName?: string;
}

export interface OrderBasket {
  id: string;
  name: string;
  depot_name?: string;
  site_number?: string;
  notes?: string;
  items: MaterialOrderItem[];
  created_at: string;
}

export interface BatchBasket {
  id: string;
  name: string;
  mode?: MovementType;
  items: BatchCartItem[];
  created_at: string;
}

export type OrderStatus =
  | 'WAITING_APPROVAL'
  | 'PENDING'
  | 'PREPARING'
  | 'READY'
  | 'COLLECTED'
  | 'CANCELLED'
  | 'REJECTED';

export interface MaterialOrderItem {
  product_id: string | number;
  product_ref: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price?: number;
  brand?: string;
  picked?: boolean;
  picked_quantity?: number; // Quantité physique préparée et encodée par le préparateur
  scanned_barcode?: string; // Code scanné par le préparateur pour validation
  scanned_at?: string; // Date et heure de validation par scan
  unavailable?: boolean;
  unavailable_comment?: string;
  depot_name?: string; // Dépôt d'origine pour restriction de commande mono-dépôt
  rack_location?: string; // Emplacement rayon / travée / étagère
  substituted?: boolean;
  substituted_with_id?: string | number;
  substituted_with_ref?: string;
  substituted_with_name?: string;
}

export interface MaterialOrder {
  id: string;
  order_number: string; // Auto-generated with site number prefix e.g. "CH-2026-01-CMD-261002-001"
  site_number: string;
  site_name?: string;
  depot_id?: string | number | null;
  depot_name?: string;
  requester_id: string | number;
  requester_name: string;
  requester_department?: string;
  status: OrderStatus;
  items: MaterialOrderItem[];
  notes?: string;
  total_cost?: number; // Montant total de la commande
  approved_by?: string | null;
  approved_at?: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  assigned_at?: string | null;
  preparer_id?: string | number | null;
  preparer_name?: string | null;
  ready_at?: string | null;
  collected_at?: string | null;
  collected_by?: string | null;
  pickup_zone?: string | null; // Emplacement de retrait / étagère / casier
  ready_qr_code?: string | null; // Payload ou URL QR Code pour le retrait
  signature_data?: string | null; // Émargement / signature tactile
  proof_photo_url?: string | null; // Photo de preuve lors du retrait
  is_edited?: boolean; // Indicateur si modifiée par le demandeur
  // Délégation / Transfert de retrait à un collègue du département
  pickup_delegate_id?: string | number | null;
  pickup_delegate_name?: string | null;
  pickup_delegate_department?: string | null;
  pickup_delegate_at?: string | null;
  pickup_delegate_by?: string | null;
  pickup_delegate_notes?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  updated_at?: string;
}

export interface ReleaseNote {
  id?: string | number;
  version: string;
  release_date?: string;
  date?: string;
  title?: string;
  description?: string;
}

export type CanonicalLicensePlan = 'free' | 'sta' | 'pro' | 'ent';
export type LicensePlan =
  | CanonicalLicensePlan
  | 'artisan'
  | 'pme'
  | 'enterprise'
  | 'starter'
  | 'standard'
  | 'professionnel'
  | 'entreprise';

export const PLAN_LABELS: Record<CanonicalLicensePlan, string> = {
  free: 'Free',
  sta: 'STA',
  pro: 'PRO',
  ent: 'ENT',
};

export type LicenseModule = 'stock' | 'outils' | 'formation' | 'rapports';

export const ALL_LICENSE_MODULES: LicenseModule[] = ['stock', 'outils', 'formation', 'rapports'];

export interface PlanLimits {
  plan: CanonicalLicensePlan;
  max_references: number;
  max_depots: number;
  max_users: number;
  default_modules: LicenseModule[];
}

const RECOGNIZED_PLAN_CODES = new Set([
  'free',
  'gratuit',
  'sta',
  'pro',
  'ent',
  'artisan',
  'starter',
  'standard',
  'pme',
  'professionnel',
  'enterprise',
  'entreprise',
]);

/**
 * Vérifie si la chaîne de formule brute correspond à un code canonique ou à un alias supporté en lecture.
 */
export function isRecognizedLicensePlan(plan?: string | null): boolean {
  const p = (plan || '').toLowerCase().trim();
  return RECOGNIZED_PLAN_CODES.has(p);
}

export function normalizeToCanonicalPlan(plan?: string, licenseKey?: string): CanonicalLicensePlan {
  const p = (plan || '').toLowerCase().trim();
  if (p === 'ent' || p === 'enterprise' || p === 'entreprise') return 'ent';
  if (p === 'pro' || p === 'pme' || p === 'professionnel') return 'pro';
  if (p === 'sta' || p === 'artisan' || p === 'standard' || p === 'starter') return 'sta';
  if (p === 'free' || p === 'gratuit') return 'free';

  const keyUpper = (licenseKey || '').toUpperCase();
  if (keyUpper.includes('-ENT-') || keyUpper.includes('-ENTERPRISE-')) return 'ent';
  if (keyUpper.includes('-PRO-') || keyUpper.includes('-PME-')) return 'pro';
  if (keyUpper.includes('-STA-') || keyUpper.includes('-ARTISAN-')) return 'sta';

  return 'free';
}

/**
 * Fonction unique définissant les plafonds techniques par formule.
 * Copie identique de supabase-master/schema_master_licenses.sql (source de vérité).
 * Les plafonds techniques ne sont jamais stockés par client.
 */
export function plan_limits(plan?: LicensePlan | string): PlanLimits {
  const canonical = normalizeToCanonicalPlan(plan);
  switch (canonical) {
    case 'ent':
      return {
        plan: 'ent',
        max_references: 99999,
        max_depots: 99999,
        max_users: 99999,
        default_modules: ['stock', 'outils', 'formation', 'rapports'],
      };
    case 'pro':
      return {
        plan: 'pro',
        max_references: 1000,
        max_depots: 10,
        max_users: 99999,
        default_modules: ['stock', 'outils', 'rapports'],
      };
    case 'sta':
      return {
        plan: 'sta',
        max_references: 300,
        max_depots: 3,
        max_users: 99999,
        default_modules: ['stock'],
      };
    case 'free':
    default:
      return {
        plan: 'free',
        max_references: 50,
        max_depots: 1,
        max_users: 99999,
        default_modules: ['stock'],
      };
  }
}

export interface PlanFeature {
  code: CanonicalLicensePlan;
  name: string;
  tag: string;
  maxReferences: number;
  maxDepots: number;
  modules: LicenseModule[];
  description: string;
  recommended?: boolean;
}

const STA_TIER: PlanFeature = {
  code: 'sta',
  name: PLAN_LABELS.sta,
  tag: 'STA',
  maxReferences: plan_limits('sta').max_references,
  maxDepots: plan_limits('sta').max_depots,
  modules: plan_limits('sta').default_modules,
  description: '300 références, jusqu\'à 3 dépôts/chantiers, utilisateurs illimités, module stock & QR codes',
};

const PRO_TIER: PlanFeature = {
  code: 'pro',
  name: PLAN_LABELS.pro,
  tag: 'PRO',
  maxReferences: plan_limits('pro').max_references,
  maxDepots: plan_limits('pro').max_depots,
  modules: plan_limits('pro').default_modules,
  description: '1000 références, jusqu\'à 10 dépôts & chantiers, utilisateurs illimités, modules stock, outils & rapports',
  recommended: true,
};

const ENT_TIER: PlanFeature = {
  code: 'ent',
  name: PLAN_LABELS.ent,
  tag: 'ENT',
  maxReferences: plan_limits('ent').max_references,
  maxDepots: plan_limits('ent').max_depots,
  modules: plan_limits('ent').default_modules,
  description: 'Références, dépôts et utilisateurs illimités, tous les modules (stock, outils, formation, rapports)',
};

export const PLAN_TIERS: Record<string, PlanFeature> = {
  free: {
    code: 'free',
    name: PLAN_LABELS.free,
    tag: 'FREE',
    maxReferences: plan_limits('free').max_references,
    maxDepots: plan_limits('free').max_depots,
    modules: plan_limits('free').default_modules,
    description: '50 références catalogue, 1 dépôt, utilisateurs illimités, module stock inclus',
  },
  sta: STA_TIER,
  pro: PRO_TIER,
  ent: ENT_TIER,
  // Rétrocompatibilité d'affichage en lecture avec les alias
  artisan: STA_TIER,
  pme: PRO_TIER,
  enterprise: ENT_TIER,
};

export function getMaxDepotsForPlan(plan?: LicensePlan | string): number {
  return plan_limits(plan).max_depots;
}

export function getPlanName(plan?: LicensePlan | string, _lang: 'fr' | 'en' | 'nl' = 'fr'): string {
  const canonical = normalizeToCanonicalPlan(plan);
  return PLAN_LABELS[canonical];
}

export interface SignedLicenseToken {
  kid: string;
  license_key: string;
  organization_name?: string;
  client_project_ref?: string;
  client_supabase_url?: string;
  plan: CanonicalLicensePlan;
  plan_type?: CanonicalLicensePlan;
  modules: LicenseModule[];
  max_depots: number;
  issued_at: string;
  expires_at?: string | null;
  offline_until: string; // Autorisation offline valide jusqu'à cette date (+7 jours)
  signature: string;
  token_version: number;
  raw_token: string;
}

export interface LicenseInfo {
  id?: string;
  license_key: string;
  organization_name?: string;
  client_supabase_url?: string;
  contact_email?: string;
  billing_cycle?: 'annual' | 'monthly';
  plan?: CanonicalLicensePlan;
  plan_type: LicensePlan;
  modules?: LicenseModule[];
  max_depots?: number;
  max_references?: number; // Calculé dynamiquement via plan_limits(plan), jamais stocké par client
  is_active: boolean;
  expires_at?: string | null;
  created_at?: string;
  last_verified_at: string;
  offline_until?: string;
  signed_token?: SignedLicenseToken;
  status: 'valid' | 'expired' | 'inactive' | 'offline_grace' | 'none';
}

export interface LicenseVerificationResult {
  success: boolean;
  license?: LicenseInfo;
  message: string;
}

export interface DepotHolder {
  depot_id: string | number;
  user_id: string | number;
  can_send: boolean;
  can_receive: boolean;
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
}

export type StockTransferStatus =
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'AWAITING_SENDER'
  | 'PARTIALLY_RECEIVED'
  | 'DISPUTED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'RETURNED_TO_STOCK';

export interface StockTransferLine {
  product_id: string;
  product_ref: string;
  product_name?: string;
  unit_price?: number;
  quantity?: number;
  quantity_sent: number;
  quantity_received?: number | null;
  quantity_accepted?: number | null;
  quantity_pending?: number;
  dest_rack?: string | null;
  line_status?: string;
  accepted?: boolean | null;
  receiver_reason?: string | null;
  receiver_comment?: string | null;
  sender_confirmed?: boolean | null;
  sender_comment?: string | null;
  dispute_resolution?: 'RETURN_TO_SOURCE' | 'WRITE_OFF' | string | null;
  dispute_comment?: string | null;
  movement_id?: string | null;
}

export interface StockTransferCommentEntry {
  at: string;
  role: 'SENDER' | 'RECEIVER' | 'LOGISTICS' | string;
  user_id?: string;
  user_name?: string;
  action: string;
  comment: string;
}

export interface StockTransferRecord {
  id: string;
  transfer_number: string;
  batch_id: string;
  source_depot_id?: string | null;
  source_depot: string;
  dest_depot_id?: string | null;
  dest_depot: string;
  status: StockTransferStatus;
  items: StockTransferLine[];
  reason?: string | null;
  total_pieces?: number;
  total_cost?: number;
  total_items?: number;
  total_quantity_sent?: number;
  total_quantity_received?: number;
  sender_id: string | number | null;
  sender_name?: string | null;
  sender_trigram?: string | null;
  receiver_id?: string | number | null;
  receiver_name?: string | null;
  receiver_note?: string | null;
  sender_confirmed_by?: string | null;
  sender_confirmed_by_name?: string | null;
  sender_confirmed_at?: string | null;
  sender_comment?: string | null;
  resolved_by?: string | null;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  resolution_action?: 'RETURN_TO_SOURCE' | 'WRITE_OFF' | string | null;
  resolution_note?: string | null;
  returned_by?: string | null;
  returned_by_name?: string | null;
  returned_at?: string | null;
  return_comment?: string | null;
  comments?: StockTransferCommentEntry[];
  comments_history?: StockTransferCommentEntry[];
  created_at: string;
  received_at?: string | null;
  updated_at?: string;
}

export interface StockLevelsReportRow {
  product_id: string;
  reference: string;
  brand: string;
  model: string;
  sub_category_id?: number | null;
  depot_name: string;
  rack_location: string;
  quantity: number;
  min_stock_alert: number;
  unit_price: number;
  total_value: number;
  in_transit_qty: number;
  is_low_stock: boolean;
  is_out_of_stock: boolean;
}

export type { ActivityCategory, ActivityType, ActivityItem } from './services/activityService';

