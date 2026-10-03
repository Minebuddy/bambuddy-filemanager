import { getAuthToken } from './client';

const API_BASE = '/api/v1';

export type FolderShareRole = 'viewer' | 'contributor' | 'manager';
export type FolderSharePrincipalType = 'user' | 'group';

export interface FolderShare {
  id: number;
  folder_id?: number;
  file_id?: number;
  principal_type: FolderSharePrincipalType;
  principal_id: number;
  principal_name: string;
  role: FolderShareRole;
  created_at: string;
}

export interface FolderSharePrincipal {
  id: number;
  name: string;
}

export interface FolderSharePrincipals {
  users: FolderSharePrincipal[];
  groups: FolderSharePrincipal[];
}

export interface FolderShareUpsert {
  principal_type: FolderSharePrincipalType;
  principal_id: number;
  role: FolderShareRole;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: 'no-store',
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface AccessResource {
  id: number;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  owner_id: number | null;
  owner_name: string | null;
  shares: FolderShare[];
}
export interface BulkAccessRequest {
  kind: 'file' | 'folder';
  ids: number[];
  action: 'grant' | 'revoke' | 'owner';
  principal_type?: FolderSharePrincipalType;
  principal_id?: number;
  role?: FolderShareRole;
  owner_id?: number | null;
}
export interface BulkAccessResult {
  updated: number;
  removed?: number;
  retained_access?: {id: number; reason: string}[];
}
export const librarySharingApi = {
  getAccessResources: (params: URLSearchParams) => request<{items: AccessResource[]; has_more: boolean}>(`/library/access/resources?${params}`),
  getAccessPrincipals: () => request<FolderSharePrincipals>('/library/access/principals'),
  bulkAccess: (data: BulkAccessRequest) => request<BulkAccessResult>('/library/access/bulk', {method: 'POST', body: JSON.stringify(data)}),
  getShares: (folderId: number, kind: 'folders' | 'files' = 'folders') =>
    request<FolderShare[]>(`/library/${kind}/${folderId}/shares`),

  getPrincipals: (folderId: number, kind: 'folders' | 'files' = 'folders') =>
    request<FolderSharePrincipals>(
      `/library/${kind}/${folderId}/share-principals`,
    ),

  upsertShare: (folderId: number, data: FolderShareUpsert, kind: 'folders' | 'files' = 'folders') =>
    request<FolderShare>(`/library/${kind}/${folderId}/shares`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteShare: (folderId: number, shareId: number, kind: 'folders' | 'files' = 'folders') =>
    request<void>(`/library/${kind}/${folderId}/shares/${shareId}`, {
      method: 'DELETE',
    }),
};
