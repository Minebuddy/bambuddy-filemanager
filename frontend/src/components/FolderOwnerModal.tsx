import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Search, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, type LibraryFolderTree } from '../api/client';
import { libraryOwnershipApi } from '../api/libraryOwnership';
import { useToast } from '../contexts/ToastContext';
import { Button } from './Button';

const UNASSIGNED_OWNER = '__unassigned__';

interface FolderOwnerModalProps {
  folder: LibraryFolderTree;
  onClose: () => void;
}

export function FolderOwnerModal({ folder, onClose }: FolderOwnerModalProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedOwnerId, setSelectedOwnerId] = useState(
    folder.created_by_id === null || folder.created_by_id === undefined
      ? UNASSIGNED_OWNER
      : String(folder.created_by_id),
  );
  const [recursive, setRecursive] = useState(false);
  const [search, setSearch] = useState('');

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users', 'slim'],
    queryFn: () => api.getUsersSlim(),
    staleTime: 30_000,
  });

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => user.username.toLowerCase().includes(needle));
  }, [search, users]);

  const ownerName =
    users.find((user) => user.id === folder.created_by_id)?.username ??
    (folder.created_by_id == null
      ? t('common.unassigned')
      : `User #${folder.created_by_id}`);

  const mutation = useMutation({
    mutationFn: () =>
      libraryOwnershipApi.updateFolderOwner(folder.id, {
        created_by_id: selectedOwnerId === UNASSIGNED_OWNER ? null : Number(selectedOwnerId),
        recursive,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['library-folders'] });
      queryClient.invalidateQueries({ queryKey: ['library-files'] });
      showToast(
        result.updated_folders === 1
          ? t('fileManager.folderOwner.savedOne', {
              defaultValue: 'Folder owner updated.',
            })
          : t('fileManager.folderOwner.savedMany', {
              count: result.updated_folders,
              defaultValue: `Owner updated for ${result.updated_folders} folders.`,
            }),
        'success',
      );
      onClose();
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-bambu-dark-secondary rounded-lg w-full max-w-md border border-bambu-dark-tertiary">
        <div className="p-4 border-b border-bambu-dark-tertiary">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <User className="w-5 h-5 text-bambu-green" />
            {t('fileManager.folderOwner.manage', { defaultValue: 'Manage folder owner' })}
          </h2>
          <p className="text-sm text-bambu-gray mt-1 truncate" title={folder.name}>
            {folder.name}
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm">
            <span className="text-bambu-gray">
              {t('fileManager.folderOwner.current', { defaultValue: 'Current owner' })}:
            </span>{' '}
            <span className="text-white font-medium">{ownerName}</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-1">
              {t('fileManager.folderOwner.newOwner', { defaultValue: 'New owner' })}
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-bambu-gray" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('fileManager.folderOwner.searchUsers', {
                  defaultValue: 'Search users...',
                })}
                className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded pl-9 pr-3 py-2 text-sm text-white placeholder-bambu-gray focus:outline-none focus:border-bambu-green"
              />
            </div>

            <select
              size={Math.min(Math.max(filteredUsers.length + 1, 3), 7)}
              value={selectedOwnerId}
              onChange={(event) => setSelectedOwnerId(event.target.value)}
              disabled={mutation.isPending || usersLoading}
              aria-label={t('fileManager.folderOwner.newOwner', { defaultValue: 'New owner' })}
              className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-bambu-green"
            >
              <option value={UNASSIGNED_OWNER}>
                {t('fileManager.folderOwner.unassigned', {
                  defaultValue: 'Unassigned / admin-only',
                })}
              </option>
              {filteredUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2 text-sm text-white cursor-pointer">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(event) => setRecursive(event.target.checked)}
              disabled={mutation.isPending}
              className="mt-0.5 accent-bambu-green"
            />
            <span>
              {t('fileManager.folderOwner.applySubfolders', {
                defaultValue: 'Apply the same owner to all internal subfolders',
              })}
            </span>
          </label>

          <div className="flex gap-2 p-3 rounded border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {t('fileManager.folderOwner.warning', {
                defaultValue:
                  'This changes folder ownership only. Files keep their existing owners, and external folders are not reassigned.',
              })}
            </span>
          </div>
        </div>

        <div className="p-4 border-t border-bambu-dark-tertiary flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || usersLoading}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
