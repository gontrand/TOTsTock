import type { SupabaseClient } from '@supabase/supabase-js';
import { TABLES } from '../constants/tables';
import { getClientSupabase } from './clientSupabase';

export const TOT_FILES_BUCKET = 'tot-files' as const;

export const ALLOWED_SUITE_FILE_APPS = [
  'core',
  'stock',
  'habilitation',
  'report',
  'tools',
] as const;

export type SuiteFileApp = (typeof ALLOWED_SUITE_FILE_APPS)[number];

export const ALLOWED_DOC_CATEGORIES = [
  'certificat',
  'permis',
  'attestation',
  'visite_medicale',
  'carte',
  'photo',
  'fiche_technique',
  'rapport',
  'autre',
] as const;

export type SuiteDocCategory = (typeof ALLOWED_DOC_CATEGORIES)[number];

export interface SuiteFileRecord {
  id: string;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  checksum_sha256: string | null;
  app: SuiteFileApp;
  entity_type: string;
  entity_id: string;
  subject_user_id: string | null;
  doc_category: SuiteDocCategory | null;
  title: string | null;
  valid_from: string | null;
  valid_until: string | null;
  version: number;
  replaces_file_id: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  meta?: Record<string, unknown>;
}

export interface UploadSuiteFileParams {
  app: SuiteFileApp;
  entityType: string;
  entityId: string;
  file: File | (Blob & { name?: string });
  subjectUserId?: string | null;
  docCategory?: SuiteDocCategory | null;
  title?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  replacesFileId?: string | null;
  client?: SupabaseClient | null;
  uploadedByUserId?: string | null;
}

export interface ListSuiteFilesParams {
  app: SuiteFileApp;
  entityType: string;
  entityId: string;
  client?: SupabaseClient | null;
}

export function isValidSuiteFileApp(app: string): app is SuiteFileApp {
  return (ALLOWED_SUITE_FILE_APPS as readonly string[]).includes(app);
}

export function isValidSuiteDocCategory(category: string): category is SuiteDocCategory {
  return (ALLOWED_DOC_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Nettoie un nom de fichier pour construire un segment de chemin sûr dans Supabase Storage.
 */
export function sanitizeSuiteFileName(rawName: string): string {
  const base = String(rawName || 'document')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  return base || 'document';
}

function sanitizePathSegment(rawSegment: string, label: string): string {
  const cleaned = String(rawSegment || '')
    .trim()
    .replace(/\/+/g, '')
    .replace(/\.\.+/g, '');
  if (!cleaned) {
    throw new Error(`Paramètre ${label} invalide ou vide.`);
  }
  return cleaned;
}

/**
 * Construit le chemin `{app}/{entityType}/{entityId}/{uuid}-{nomNettoyé}`.
 * Le premier dossier est obligatoirement égal à `app` (`split_part(storage_path, '/', 1) = app`).
 * Cas particulier Habilitation : un employé peut déposer son propre document dans
 * `habilitation/self/{son id core_users}/{uuid}-{nomNettoyé}` avec `subject_user_id` = son id.
 */
export function buildSuiteFileStoragePath(params: {
  app: SuiteFileApp;
  entityType: string;
  entityId: string;
  fileName: string;
  uuid?: string;
  subjectUserId?: string | null;
}): string {
  const { app, entityType, entityId, fileName, uuid, subjectUserId } = params;

  if (!isValidSuiteFileApp(app)) {
    throw new Error(
      `Application "${String(app)}" non autorisée pour les fichiers de la suite TOT. Valeurs permises : ${ALLOWED_SUITE_FILE_APPS.join(', ')}.`
    );
  }

  const safeEntityType = sanitizePathSegment(entityType, 'entityType');
  const resolvedEntityId =
    app === 'habilitation' && safeEntityType === 'self' && subjectUserId
      ? String(subjectUserId)
      : String(entityId);
  const safeEntityId = sanitizePathSegment(resolvedEntityId, 'entityId');

  if (
    app === 'habilitation' &&
    safeEntityType === 'self' &&
    subjectUserId &&
    String(subjectUserId).trim() !== safeEntityId
  ) {
    throw new Error(
      "Pour un dépôt personnel dans habilitation/self/{id}, entityId et subjectUserId doivent correspondre à l'identifiant core_users de l'employé."
    );
  }

  const fileUuid = uuid || crypto.randomUUID();
  const cleanName = sanitizeSuiteFileName(fileName);
  const storagePath = `${app}/${safeEntityType}/${safeEntityId}/${fileUuid}-${cleanName}`;

  if (storagePath.split('/')[0] !== app) {
    throw new Error(`Chemin de stockage invalide : le premier dossier doit être "${app}".`);
  }

  return storagePath;
}

/**
 * Calcule l'empreinte SHA-256 hexadécimale d'un fichier via Web Crypto (`crypto.subtle`).
 */
export async function computeFileSha256Hex(
  input: Blob | ArrayBuffer | Uint8Array
): Promise<string> {
  let arrayBuffer: ArrayBuffer;
  if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
  } else if (input instanceof Uint8Array) {
    arrayBuffer = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength
    ) as ArrayBuffer;
  } else if (typeof (input as Blob).arrayBuffer === 'function') {
    arrayBuffer = await (input as Blob).arrayBuffer();
  } else {
    arrayBuffer = await new Response(input as Blob).arrayBuffer();
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Résout l'identifiant `core_users.id` de l'utilisateur actuellement connecté.
 */
export async function resolveConnectedCoreUserId(
  client: SupabaseClient,
  explicitUserId?: string | null
): Promise<string | null> {
  try {
    if (client.auth && typeof client.auth.getUser === 'function') {
      const { data: authData } = await client.auth.getUser();
      const authUid = authData?.user?.id;
      if (authUid) {
        const { data: userRow } = await client
          .from(TABLES.users)
          .select('id')
          .eq('auth_user_id', authUid)
          .maybeSingle();
        if (userRow?.id !== undefined && userRow?.id !== null && String(userRow.id).trim() !== '') {
          return String(userRow.id);
        }
      }
    }
  } catch {
    // Repli sur explicitUserId si la résolution directe échoue
  }

  if (explicitUserId !== undefined && explicitUserId !== null && String(explicitUserId).trim() !== '') {
    return String(explicitUserId);
  }
  return null;
}

/**
 * Envoie un fichier dans le bucket privé `tot-files` et enregistre ses métadonnées dans `public.core_files`.
 * Si l'insertion dans `core_files` échoue, supprime immédiatement l'objet envoyé dans le bucket
 * pour ne jamais laisser de fichier orphelin.
 */
export async function uploadSuiteFile(
  params: UploadSuiteFileParams
): Promise<SuiteFileRecord> {
  const {
    app,
    entityType,
    entityId,
    file,
    subjectUserId,
    docCategory,
    title,
    validFrom,
    validUntil,
    replacesFileId,
    client,
    uploadedByUserId,
  } = params;

  if (!isValidSuiteFileApp(app)) {
    throw new Error(
      `Application "${String(app)}" non autorisée. Valeurs autorisées : ${ALLOWED_SUITE_FILE_APPS.join(', ')}.`
    );
  }

  const effectiveDocCategory: SuiteDocCategory = docCategory ?? 'autre';
  if (!isValidSuiteDocCategory(effectiveDocCategory)) {
    throw new Error(
      `Catégorie de document "${String(docCategory)}" non autorisée. Valeurs autorisées : ${ALLOWED_DOC_CATEGORIES.join(', ')}.`
    );
  }

  const activeClient = client ?? getClientSupabase();
  if (!activeClient) {
    throw new Error('Client Supabase non configuré.');
  }

  const uploadedBy = await resolveConnectedCoreUserId(activeClient, uploadedByUserId);

  const effectiveSubjectUserId =
    app === 'habilitation' && entityType.trim() === 'self'
      ? String(subjectUserId || uploadedBy || entityId)
      : subjectUserId ?? null;

  const effectiveEntityId =
    app === 'habilitation' && entityType.trim() === 'self'
      ? String(effectiveSubjectUserId || entityId)
      : String(entityId);

  const fileName =
    (typeof (file as File).name === 'string' && (file as File).name.trim()) || 'document';
  const mimeType =
    (typeof file.type === 'string' && file.type.trim()) || 'application/octet-stream';
  const sizeBytes = typeof file.size === 'number' ? file.size : 0;

  const storagePath = buildSuiteFileStoragePath({
    app,
    entityType,
    entityId: effectiveEntityId,
    fileName,
    subjectUserId: effectiveSubjectUserId,
  });

  const checksumSha256 = await computeFileSha256Hex(file);

  const { error: uploadError } = await activeClient.storage
    .from(TOT_FILES_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: mimeType,
    });

  if (uploadError) {
    throw new Error(`Échec de l'envoi dans le bucket ${TOT_FILES_BUCKET} : ${uploadError.message}`);
  }

  const rowToInsert = {
    bucket: TOT_FILES_BUCKET,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    checksum_sha256: checksumSha256,
    app,
    entity_type: entityType.trim(),
    entity_id: effectiveEntityId,
    subject_user_id: effectiveSubjectUserId,
    doc_category: effectiveDocCategory,
    title: title ?? null,
    valid_from: validFrom ?? null,
    valid_until: validUntil ?? null,
    replaces_file_id: replacesFileId ?? null,
    uploaded_by: uploadedBy,
  };

  const { data: insertedRow, error: insertError } = await activeClient
    .from(TABLES.files)
    .insert([rowToInsert])
    .select('*')
    .single();

  if (insertError || !insertedRow) {
    try {
      await activeClient.storage.from(TOT_FILES_BUCKET).remove([storagePath]);
    } catch {
      // Nettoyage best-effort pour éviter un fichier orphelin
    }
    throw new Error(
      `Échec de l'enregistrement dans ${TABLES.files} : ${insertError?.message || 'Aucune ligne retournée'}`
    );
  }

  return insertedRow as SuiteFileRecord;
}

/**
 * Génère une URL signée temporaire (`createSignedUrl`) pour consulter un fichier privé.
 * Ne génère jamais d'URL publique.
 */
export async function getSuiteFileUrl(
  fileId: string,
  expiresInSeconds = 300,
  options?: { client?: SupabaseClient | null }
): Promise<string> {
  const activeClient = options?.client ?? getClientSupabase();
  if (!activeClient) {
    throw new Error('Client Supabase non configuré.');
  }

  const { data: row, error: fetchError } = await activeClient
    .from(TABLES.files)
    .select('id, bucket, storage_path, deleted_at')
    .eq('id', fileId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Impossible de récupérer le fichier ${fileId} : ${fetchError.message}`);
  }
  if (!row || row.deleted_at) {
    throw new Error(`Fichier ${fileId} introuvable ou archivé.`);
  }

  const bucketName = row.bucket || TOT_FILES_BUCKET;
  const { data: signedData, error: signedError } = await activeClient.storage
    .from(bucketName)
    .createSignedUrl(row.storage_path, expiresInSeconds);

  if (signedError || !signedData?.signedUrl) {
    throw new Error(
      `Impossible de générer l'URL signée : ${signedError?.message || 'URL signée absente'}`
    );
  }

  return signedData.signedUrl;
}

/**
 * Liste les fichiers actifs (`deleted_at IS NULL`) rattachés à une entité d'une application de la suite TOT.
 */
export async function listSuiteFiles(
  params: ListSuiteFilesParams
): Promise<SuiteFileRecord[]> {
  const { app, entityType, entityId, client } = params;

  if (!isValidSuiteFileApp(app)) {
    throw new Error(
      `Application "${String(app)}" non autorisée. Valeurs autorisées : ${ALLOWED_SUITE_FILE_APPS.join(', ')}.`
    );
  }

  const activeClient = client ?? getClientSupabase();
  if (!activeClient) {
    return [];
  }

  const { data, error } = await activeClient
    .from(TABLES.files)
    .select('*')
    .eq('app', app)
    .eq('entity_type', entityType.trim())
    .eq('entity_id', String(entityId))
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  if (error) {
    throw new Error(`Erreur lors de la lecture de ${TABLES.files} : ${error.message}`);
  }

  return (data || []) as SuiteFileRecord[];
}

/**
 * Archive logiquement un fichier (`deleted_at = now()`, `deleted_by = id core_users`).
 * N'exécute jamais de `DELETE` physique (interdit aux utilisateurs par la base de données).
 */
export async function archiveSuiteFile(
  fileId: string,
  options?: { client?: SupabaseClient | null; deletedByUserId?: string | null }
): Promise<SuiteFileRecord> {
  const activeClient = options?.client ?? getClientSupabase();
  if (!activeClient) {
    throw new Error('Client Supabase non configuré.');
  }

  const deletedBy = await resolveConnectedCoreUserId(activeClient, options?.deletedByUserId);
  const nowIso = new Date().toISOString();

  const { data, error } = await activeClient
    .from(TABLES.files)
    .update({
      deleted_at: nowIso,
      deleted_by: deletedBy,
    })
    .eq('id', fileId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      `Impossible d'archiver le fichier ${fileId} : ${error?.message || 'Aucune ligne retournée'}`
    );
  }

  return data as SuiteFileRecord;
}
