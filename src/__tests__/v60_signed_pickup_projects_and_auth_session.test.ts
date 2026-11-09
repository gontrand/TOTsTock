import { describe, expect, it, vi } from 'vitest';
import {
  canUserValidateOrderPickup,
  canUserViewOrderSignature,
  getOrderPickupReservedMessage,
  isValidPickupSignature,
  ORDER_PICKUP_QR_UNAUTHORIZED_MESSAGE,
  buildOrderTraceabilityDetails,
} from '../services/orderTraceabilityService';
import {
  canUserManageProjectStatus,
  closeProjectViaRpc,
  reopenProjectViaRpc,
  filterProjectsByStatusTab,
  filterProjectsForSelection,
  formatClosedProjectBadgeText,
  formatProjectOptionLabel,
  getClosedProjectContainerAlertsForUser,
  getNonFinalOrdersForProject,
  isProjectClosed,
  validateProjectForOutflowOrOrder,
} from '../services/projectStatusService';
import {
  formatPostgresErrorMessage,
  NO_AUTH_SESSION_BANNER_MESSAGE,
  PERMISSION_DENIED_READABLE_MESSAGE,
  translatePermissionDeniedError,
  upsertOrderToSupabase,
} from '../services/clientSupabase';
import {
  clearSyncErrorBannerOnSuccess,
  getSyncBannerState,
  isMissingSql12TableOrFunctionError,
} from '../services/userPreferencesService';
import { generateOrderSlipHtml } from '../utils/printHelper';
import { Department, Depot, MaterialOrder, Project, User } from '../types';

const VALID_SIGNATURE = 'data:image/png;base64,' + 'A'.repeat(260);
const DOT_SIGNATURE = 'data:image/png;base64,short';

describe('v60 — Section 8 : Retrait signé (demandeur ou délégué uniquement, signature obligatoire & confidentialité)', () => {
  const sampleOrder: MaterialOrder = {
    id: 'ord_v60_1',
    order_number: 'CMD-2026-060',
    requester_id: 'u_req',
    requester_name: 'Alice Demandeur',
    pickup_delegate_id: 'u_del',
    pickup_delegate_name: 'Bob Délégué',
    preparer_id: 'u_prep',
    preparer_name: 'Charlie Préparateur',
    requester_department: 'Électricité',
    site_number: 'CH-100',
    status: 'READY',
    items: [],
    total_cost: 120,
    created_at: '2026-04-10T08:00:00.000Z',
  };

  it('autorise uniquement le demandeur (requester_id) ou le délégué (pickup_delegate_id) à valider le retrait', () => {
    expect(canUserValidateOrderPickup({ id: 'u_req', role_id: 4 }, sampleOrder)).toBe(true);
    expect(canUserValidateOrderPickup({ id: 'u_del', role_id: 4 }, sampleOrder)).toBe(true);
    // Même un préparateur ou un admin qui n'est ni demandeur ni délégué ne peut pas valider le retrait
    expect(canUserValidateOrderPickup({ id: 'u_prep', role_id: 2 }, sampleOrder)).toBe(false);
    expect(canUserValidateOrderPickup({ id: 'u_admin', role_id: 0 }, sampleOrder)).toBe(false);
    expect(canUserValidateOrderPickup(null, sampleOrder)).toBe(false);

    expect(getOrderPickupReservedMessage(sampleOrder)).toBe(
      'Retrait réservé au demandeur (Alice Demandeur) ou à son délégué (Bob Délégué)'
    );
    expect(ORDER_PICKUP_QR_UNAUTHORIZED_MESSAGE).toBe(
      'Seul le demandeur ou son délégué peut valider ce retrait'
    );
  });

  it('refuse une signature vide ou réduite à un simple point', () => {
    expect(isValidPickupSignature('')).toBe(false);
    expect(isValidPickupSignature(null)).toBe(false);
    expect(isValidPickupSignature('   ')).toBe(false);
    expect(isValidPickupSignature(DOT_SIGNATURE)).toBe(false);
    expect(isValidPickupSignature(VALID_SIGNATURE)).toBe(true);
  });

  it('envoie status=COLLECTED et signature_data dans la même requête UPDATE sans appeler transition_order_status', async () => {
    const upsertSpy = vi.fn().mockResolvedValue({ error: null });
    const rpcSpy = vi.fn().mockResolvedValue({ error: null });
    const fakeClient: any = {
      from: vi.fn((table: string) => ({
        upsert: table === 'stk_material_orders' ? upsertSpy : vi.fn().mockResolvedValue({ error: null }),
      })),
      rpc: rpcSpy,
    };

    const collectedOrder: MaterialOrder = {
      ...sampleOrder,
      status: 'COLLECTED',
      signature_data: VALID_SIGNATURE,
      collected_by: 'Alice Demandeur',
      collected_at: '2026-04-10T10:30:00.000Z',
    };

    const res = await upsertOrderToSupabase(fakeClient, collectedOrder);
    expect(res.success).toBe(true);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const rawArg = upsertSpy.mock.calls[0][0];
    const payload = Array.isArray(rawArg) ? rawArg[0] : rawArg;
    expect(payload.status).toBe('COLLECTED');
    expect(payload.signature_data).toBe(VALID_SIGNATURE);
    expect(payload.collected_by).toBe('Alice Demandeur');
    expect(payload.collected_at).toBe('2026-04-10T10:30:00.000Z');
    // Ne doit jamais appeler transition_order_status pour COLLECTED
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('remonte telle quelle une erreur SQL 42501 ou 23514 lors du retrait', async () => {
    const fakeClient: any = {
      from: vi.fn(() => ({
        upsert: vi.fn().mockResolvedValue({
          error: {
            code: '23514',
            message: 'Signature obligatoire pour valider le retrait de la commande',
          },
        }),
      })),
      rpc: vi.fn(),
    };

    const res = await upsertOrderToSupabase(fakeClient, {
      ...sampleOrder,
      status: 'COLLECTED',
      signature_data: '',
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Signature obligatoire pour valider le retrait de la commande');
  });

  it("restreint la consultation de l'image de signature aux personnes habilitées et masque l'image aux autres", () => {
    const departments: Department[] = [
      {
        id: 1,
        name: 'Électricité',
        manager_id: 'u_dep_mgr',
        deputy_manager_ids: ['u_dep_dep'],
      },
    ];
    const projects: Project[] = [
      {
        id: 10,
        project_number: 'CH-100',
        project_name: 'Tour Nord',
        department_id: 1,
        manager_id: 'u_proj_mgr',
        deputy_manager_ids: ['u_proj_dep'],
      },
    ];
    const users: User[] = [
      { id: 'u_req', name: 'Alice Demandeur', trigram: 'ALI', role_id: 4, department: 'Électricité', is_blocked: false },
      { id: 'u_other', name: 'Paul Externe', trigram: 'PAU', role_id: 4, department: 'Plomberie', is_blocked: false },
    ];
    const collectedOrder: MaterialOrder = {
      ...sampleOrder,
      status: 'COLLECTED',
      signature_data: VALID_SIGNATURE,
      collected_by: 'Alice Demandeur',
      collected_at: '2026-04-10T11:00:00.000Z',
    };

    // Habilités : demandeur, délégué, préparateur, resp dép + suppléant, conducteur + suppléant, rôles 0 et 1
    expect(canUserViewOrderSignature({ id: 'u_req', role_id: 4 }, collectedOrder, departments, projects, users)).toBe(true);
    expect(canUserViewOrderSignature({ id: 'u_del', role_id: 4 }, collectedOrder, departments, projects, users)).toBe(true);
    expect(canUserViewOrderSignature({ id: 'u_prep', role_id: 3 }, collectedOrder, departments, projects, users)).toBe(true);
    expect(canUserViewOrderSignature({ id: 'u_dep_mgr', role_id: 3 }, collectedOrder, departments, projects, users)).toBe(true);
    expect(canUserViewOrderSignature({ id: 'u_dep_dep', role_id: 3 }, collectedOrder, departments, projects, users)).toBe(true);
    expect(canUserViewOrderSignature({ id: 'u_proj_mgr', role_id: 3 }, collectedOrder, departments, projects, users)).toBe(true);
    expect(canUserViewOrderSignature({ id: 'u_proj_dep', role_id: 3 }, collectedOrder, departments, projects, users)).toBe(true);
    expect(canUserViewOrderSignature({ id: 'u_admin', role_id: 1 }, collectedOrder, departments, projects, users)).toBe(true);
    expect(canUserViewOrderSignature({ id: 'u_super', role_id: 0 }, collectedOrder, departments, projects, users)).toBe(true);

    // Non habilité : autre collaborateur
    expect(canUserViewOrderSignature({ id: 'u_other', role_id: 4 }, collectedOrder, departments, projects, users)).toBe(false);

    // Détail de traçabilité : pas d'image pour un utilisateur non habilité
    const traceUnauthorized = buildOrderTraceabilityDetails(collectedOrder, {
      currentUser: { id: 'u_other', role_id: 4 },
      departments,
      projects,
      users,
    });
    expect(traceUnauthorized.hasSignature).toBe(true);
    expect(traceUnauthorized.canViewSignature).toBe(false);
    expect(traceUnauthorized.signatureData).toBeNull();

    // Bon imprimé : inclut l'image uniquement si canIncludeSignature est true
    const htmlAllowed = generateOrderSlipHtml(collectedOrder, 'TOT', 'EUR', undefined, {
      canIncludeSignature: true,
    });
    expect(htmlAllowed).toContain(VALID_SIGNATURE);
    expect(htmlAllowed).toContain('Signé par Alice Demandeur');

    const htmlForbidden = generateOrderSlipHtml(collectedOrder, 'TOT', 'EUR', undefined, {
      canIncludeSignature: false,
    });
    expect(htmlForbidden).not.toContain(VALID_SIGNATURE);
    expect(htmlForbidden).toContain('Retrait signé');
  });
});

describe('v60 — Section 9 : Projets en cours (IN_PROGRESS) / terminés (CLOSED)', () => {
  const departments: Department[] = [
    {
      id: 1,
      name: 'Génie Civil',
      manager_id: 'u_dep_mgr',
      deputy_manager_ids: ['u_dep_dep'],
    },
  ];

  const openProject: Project = {
    id: 1,
    project_number: 'PRJ-OPEN',
    project_name: 'Chantier Actif',
    department_id: 1,
    manager_id: 'u_site_mgr',
    deputy_manager_ids: ['u_site_dep'],
    status: 'IN_PROGRESS',
  };

  const closedProject: Project = {
    id: 2,
    project_number: 'PRJ-CLOSED',
    project_name: 'Chantier Clôturé',
    department_id: 1,
    manager_id: 'u_site_mgr',
    status: 'CLOSED',
    closed_at: '2026-04-08T15:00:00.000Z',
    closed_by: 'u_dep_mgr',
    closed_by_name: 'Marc Resp',
    close_note: 'Réception définitive',
  };

  const projects = [openProject, closedProject];

  it('filtre les projets par statut (En cours par défaut) et formate le badge Terminé', () => {
    expect(isProjectClosed(openProject)).toBe(false);
    expect(isProjectClosed(closedProject)).toBe(true);

    expect(filterProjectsByStatusTab(projects, 'IN_PROGRESS')).toEqual([openProject]);
    expect(filterProjectsByStatusTab(projects, 'CLOSED')).toEqual([closedProject]);
    expect(filterProjectsByStatusTab(projects, 'ALL')).toHaveLength(2);

    const badge = formatClosedProjectBadgeText(closedProject);
    expect(badge).toContain('Terminé le');
    expect(badge).toContain('par Marc Resp');
  });

  it('autorise uniquement admin (0/1), resp dép + suppléants, conducteur + suppléants à terminer/rouvrir un projet', () => {
    expect(canUserManageProjectStatus({ id: 'u_admin', role_id: 0 }, openProject, departments)).toBe(true);
    expect(canUserManageProjectStatus({ id: 'u_admin1', role_id: 1 }, openProject, departments)).toBe(true);
    expect(canUserManageProjectStatus({ id: 'u_dep_mgr', role_id: 3 }, openProject, departments)).toBe(true);
    expect(canUserManageProjectStatus({ id: 'u_dep_dep', role_id: 3 }, openProject, departments)).toBe(true);
    expect(canUserManageProjectStatus({ id: 'u_site_mgr', role_id: 3 }, openProject, departments)).toBe(true);
    expect(canUserManageProjectStatus({ id: 'u_site_dep', role_id: 3 }, openProject, departments)).toBe(true);
    expect(canUserManageProjectStatus({ id: 'u_tech', role_id: 4 }, openProject, departments)).toBe(false);
  });

  it('exclut les projets CLOSED des sélecteurs de sortie/commande/conteneur mais les garde en entrée avec mention retour uniquement', () => {
    expect(filterProjectsForSelection(projects, 'ORDER')).toEqual([openProject]);
    expect(filterProjectsForSelection(projects, 'OUT')).toEqual([openProject]);
    expect(filterProjectsForSelection(projects, 'CONTAINER')).toEqual([openProject]);
    expect(filterProjectsForSelection(projects, 'IN')).toHaveLength(2);

    expect(formatProjectOptionLabel(closedProject, 'IN')).toContain(
      'Projet terminé — retour uniquement'
    );

    const outCheck = validateProjectForOutflowOrOrder(projects, 'PRJ-CLOSED');
    expect(outCheck.allowed).toBe(false);
    expect(outCheck.errorMessage).toBe('Le projet PRJ-CLOSED est terminé : sortie impossible');

    const okCheck = validateProjectForOutflowOrOrder(projects, 'PRJ-OPEN');
    expect(okCheck.allowed).toBe(true);
  });

  it('appelle les RPC close_project et reopen_project et détecte les commandes non finales bloquantes', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const fakeClient: any = { rpc: rpcMock };

    const closeRes = await closeProjectViaRpc(fakeClient, 'PRJ-OPEN', 'Fin des travaux');
    expect(closeRes.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('close_project', {
      p_project_number: 'PRJ-OPEN',
      p_note: 'Fin des travaux',
    });

    const reopenRes = await reopenProjectViaRpc(fakeClient, 'PRJ-CLOSED', 'Avenant');
    expect(reopenRes.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('reopen_project', {
      p_project_number: 'PRJ-CLOSED',
      p_note: 'Avenant',
    });

    const orders: MaterialOrder[] = [
      {
        id: 'o1',
        order_number: 'CMD-1',
        requester_id: 'u1',
        requester_name: 'Jean',
        site_number: 'PRJ-OPEN',
        status: 'PREPARING',
        items: [],
        total_cost: 10,
        created_at: '2026-04-10T00:00:00Z',
      },
      {
        id: 'o2',
        order_number: 'CMD-2',
        requester_id: 'u1',
        requester_name: 'Jean',
        site_number: 'PRJ-OPEN',
        status: 'COLLECTED',
        items: [],
        total_cost: 10,
        created_at: '2026-04-10T00:00:00Z',
      },
    ];
    const blocking = getNonFinalOrdersForProject(orders, 'PRJ-OPEN');
    expect(blocking).toHaveLength(1);
    expect(blocking[0].id).toBe('o1');
  });

  it('génère une alerte PROJECT_CLOSED:<project_number> pour les conteneurs/véhicules rattachés à un projet terminé', () => {
    const depots: Depot[] = [
      {
        id: 'd_cont',
        name: 'Conteneur Nord',
        type: 'CONTAINER',
        project_number: 'PRJ-CLOSED',
      },
    ];

    const alertsForMgr = getClosedProjectContainerAlertsForUser(
      { id: 'u_site_mgr', role_id: 3 },
      projects,
      depots,
      departments
    );
    expect(alertsForMgr).toHaveLength(1);
    expect(alertsForMgr[0].notifKey).toBe('PROJECT_CLOSED:PRJ-CLOSED');
    expect(alertsForMgr[0].message).toBe('Projet terminé : pensez à rapatrier le matériel');

    const alertsForRandomTech = getClosedProjectContainerAlertsForUser(
      { id: 'u_random', role_id: 4 },
      projects,
      depots,
      departments
    );
    expect(alertsForRandomTech).toHaveLength(0);
  });
});

describe('v60 — Section 10 : Erreurs permission denied & bandeau script SQL 12', () => {
  it('ne déclenche PAS le bandeau "script SQL 12 manquant" sur 42501 / permission denied, mais uniquement sur 42P01 / PGRST202 / 42883', () => {
    expect(
      isMissingSql12TableOrFunctionError({
        code: '42501',
        message: 'permission denied for table core_user_preferences',
      })
    ).toBe(false);
    expect(
      isMissingSql12TableOrFunctionError({
        code: '42501',
        message: 'new row violates row-level security policy for table "core_user_preferences"',
      })
    ).toBe(false);
    expect(
      isMissingSql12TableOrFunctionError({
        code: '42P01',
        message: 'relation "public.core_user_preferences" does not exist',
      })
    ).toBe(true);
    expect(
      isMissingSql12TableOrFunctionError({
        code: 'PGRST202',
        message: 'Could not find the function public.upsert_my_preferences',
      })
    ).toBe(true);

    clearSyncErrorBannerOnSuccess();
    expect(getSyncBannerState().visible).toBe(false);
  });

  it('traduit "permission denied for table|function X" en message clair et conserve les messages métier 42501/23514/22023', () => {
    expect(translatePermissionDeniedError('permission denied for table stk_depots')).toBe(
      PERMISSION_DENIED_READABLE_MESSAGE
    );
    expect(
      formatPostgresErrorMessage({
        code: '42501',
        message: 'permission denied for function close_project',
      })
    ).toBe(PERMISSION_DENIED_READABLE_MESSAGE);

    // Un message métier explicite levé par un trigger/RPC (42501 / 23514 / 22023) est affiché tel quel
    expect(
      formatPostgresErrorMessage({
        code: '42501',
        message: 'Seul le demandeur ou son délégué peut valider ce retrait',
      })
    ).toBe('Seul le demandeur ou son délégué peut valider ce retrait');

    expect(NO_AUTH_SESSION_BANNER_MESSAGE).toBe(
      "Session serveur absente : connectez-vous avec un compte lié à Supabase Auth (e-mail confirmé). Les enregistrements sont refusés tant que ce n'est pas fait."
    );
  });
});
