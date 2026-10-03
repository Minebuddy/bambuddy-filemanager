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
  updateFolderOwner: (folderId: number, data: FolderOwnerUpdate) =>
    request<FolderOwnerUpdateResult>(`/library/folders/${folderId}/owner`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};
