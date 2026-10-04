import { getAuthToken } from './client';

const API_BASE = '/api/v1';

export interface FolderOwnerUpdate {
  created_by_id: number | null;
  recursive: boolean;
}

export interface FolderOwnerUpdateResult {
  id: number;
  created_by_id: number | null;
  updated_folders: number;
}

export interface FolderAccessOverviewShare {
  source_folder_id: number;
  source_folder_name: string;
  principal_type: 'user' | 'group';
  principal_id: number;
  principal_name: string;
  role: 'viewer' | 'contributor' | 'manager';
}

export interface FolderAccessOverviewItem {
  id: number;
  name: string;
  path: string;
  parent_id: number | null;
  created_by_id: number | null;
  owner_name: string | null;
  file_count: number;
  distinct_file_owners: number;
  ownerless_file_count: number;
  is_ambiguous: boolean;
  direct_shares: FolderAccessOverviewShare[];
  inherited_shares: FolderAccessOverviewShare[];
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
  return response.json() as Promise<T>;
}

export const libraryOwnershipApi = {
  getAccessOverview: () =>
    request<FolderAccessOverviewItem[]>('/library/access-overview/folders'),

  updateFolderOwner: (folderId: number, data: FolderOwnerUpdate) =>
    request<FolderOwnerUpdateResult>(`/library/folders/${folderId}/owner`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};
