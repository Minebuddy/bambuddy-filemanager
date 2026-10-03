import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Loader2,
  Share2,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LibraryFolderTree } from '../api/client';
import {
  librarySharingApi,
  type FolderShare,
  type FolderSharePrincipalType,
  type FolderShareRole,
} from '../api/librarySharing';
import { useToast } from '../contexts/ToastContext';
import { Button } from './Button';

interface FolderSharingModalProps {
  folder: LibraryFolderTree;
  onClose: () => void;
}

const ROLE_OPTIONS: Array<{
  value: FolderShareRole;
  label: string;
  description: string;
}> = [
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Can see and use files, but cannot change the folder.',
  },
  {
    value: 'contributor',
    label: 'Contributor',
    description: 'Can view and add files or subfolders.',
  },
  {
    value: 'manager',
    label: 'Manager',
    description: 'Can view, add, rename, move, and delete shared content.',
  },
];

export function FolderSharingModal({ folder, onClose }: FolderSharingModalProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [principalType, setPrincipalType] =
    useState<FolderSharePrincipalType>('user');
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<FolderShareRole>('viewer');

  const sharesQuery = useQuery({
    queryKey: ['library-folder-shares', folder.id],
    queryFn: () => librarySharingApi.getShares(folder.id),
  });
  const principalsQuery = useQuery({
    queryKey: ['library-folder-share-principals', folder.id],
    queryFn: () => librarySharingApi.getPrincipals(folder.id),
  });

  const existingKeys = useMemo(
    () =>
      new Set(
        (sharesQuery.data ?? []).map(
          (share) => `${share.principal_type}:${share.principal_id}`,
        ),
      ),
    [sharesQuery.data],
  );

  const availablePrincipals = (
    principalType === 'user'
      ? principalsQuery.data?.users
      : principalsQuery.data?.groups
  )?.filter(
    (principal) => !existingKeys.has(`${principalType}:${principal.id}`),
  ) ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: ['library-folder-shares', folder.id],
    });
    queryClient.invalidateQueries({ queryKey: ['library-folders'] });
    queryClient.invalidateQueries({ queryKey: ['library-files'] });
  };

  const upsertMutation = useMutation({
    mutationFn: (data: {
      principal_type: FolderSharePrincipalType;
      principal_id: number;
      role: FolderShareRole;
    }) => librarySharingApi.upsertShare(folder.id, data),
    onSuccess: () => {
      refresh();
      setPrincipalId('');
      showToast(
        t('fileManager.sharing.saved', {
          defaultValue: 'Folder access updated.',
        }),
        'success',
      );
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: (shareId: number) =>
      librarySharingApi.deleteShare(folder.id, shareId),
    onSuccess: () => {
      refresh();
      showToast(
        t('fileManager.sharing.removed', {
          defaultValue: 'Folder access removed.',
        }),
        'success',
      );
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const loading = sharesQuery.isLoading || principalsQuery.isLoading;
  const error = sharesQuery.error ?? principalsQuery.error;

  const updateExistingRole = (share: FolderShare, nextRole: FolderShareRole) => {
    upsertMutation.mutate({
      principal_type: share.principal_type,
      principal_id: share.principal_id,
      role: nextRole,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-bambu-dark-secondary rounded-lg w-full max-w-2xl border border-bambu-dark-tertiary max-h-[85vh] flex flex-col">
        <div className="p-4 border-b border-bambu-dark-tertiary">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Share2 className="w-5 h-5 text-bambu-green" />
            {t('fileManager.sharing.manage', {
              defaultValue: 'Manage access',
            })}
          </h2>
          <p className="text-sm text-bambu-gray mt-1 truncate" title={folder.name}>
            {folder.name}
          </p>
        </div>

        <div className="p-4 space-y-5 overflow-y-auto">
          <div className="rounded border border-bambu-dark-tertiary bg-bambu-dark/40 p-3">
            <div className="text-sm font-medium text-white mb-1">
              {t('fileManager.sharing.inheritanceTitle', {
                defaultValue: 'Access is inherited by subfolders',
              })}
            </div>
            <p className="text-xs text-bambu-gray">
              {t('fileManager.sharing.inheritanceBody', {
                defaultValue:
                  'These grants apply to this folder and its descendants. Sharing does not transfer ownership of folders or files.',
              })}
            </p>
          </div>

          <section>
            <h3 className="text-sm font-semibold text-white mb-2">
              {t('fileManager.sharing.directAccess', {
                defaultValue: 'Direct access',
              })}
            </h3>

            {loading ? (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-bambu-green" />
              </div>
            ) : error ? (
              <div className="text-sm text-red-300">
                {(error as Error).message}
              </div>
            ) : (sharesQuery.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-bambu-gray py-2">
                {t('fileManager.sharing.none', {
                  defaultValue: 'This folder has no direct shares.',
                })}
              </p>
            ) : (
              <div className="space-y-2">
                {sharesQuery.data?.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center gap-3 rounded border border-bambu-dark-tertiary p-3"
                  >
                    {share.principal_type === 'group' ? (
                      <Users className="w-4 h-4 text-bambu-green flex-shrink-0" />
                    ) : (
                      <User className="w-4 h-4 text-bambu-green flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">
                        {share.principal_name}
                      </div>
                      <div className="text-xs text-bambu-gray capitalize">
                        {share.principal_type}
                      </div>
                    </div>
                    <select
                      value={share.role}
                      onChange={(event) =>
                        updateExistingRole(
                          share,
                          event.target.value as FolderShareRole,
                        )
                      }
                      disabled={upsertMutation.isPending}
                      className="bg-bambu-dark border border-bambu-dark-tertiary rounded px-2 py-1.5 text-sm text-white"
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(share.id)}
                      disabled={removeMutation.isPending}
                      className="p-2 rounded text-bambu-gray hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                      title={t('common.remove', { defaultValue: 'Remove' })}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="border-t border-bambu-dark-tertiary pt-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              {t('fileManager.sharing.add', {
                defaultValue: 'Add access',
              })}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_10rem] gap-2">
              <select
                value={principalType}
                onChange={(event) => {
                  setPrincipalType(
                    event.target.value as FolderSharePrincipalType,
                  );
                  setPrincipalId('');
                }}
                className="bg-bambu-dark border border-bambu-dark-tertiary rounded px-2 py-2 text-sm text-white"
              >
                <option value="user">
                  {t('common.user', { defaultValue: 'User' })}
                </option>
                <option value="group">
                  {t('common.group', { defaultValue: 'Group' })}
                </option>
              </select>

              <select
                value={principalId}
                onChange={(event) => setPrincipalId(event.target.value)}
                disabled={loading}
                className="bg-bambu-dark border border-bambu-dark-tertiary rounded px-2 py-2 text-sm text-white"
              >
                <option value="">
                  {principalType === 'user'
                    ? t('fileManager.sharing.chooseUser', {
                        defaultValue: 'Choose a user...',
                      })
                    : t('fileManager.sharing.chooseGroup', {
                        defaultValue: 'Choose a group...',
                      })}
                </option>
                {availablePrincipals.map((principal) => (
                  <option key={principal.id} value={principal.id}>
                    {principal.name}
                  </option>
                ))}
              </select>

              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as FolderShareRole)
                }
                className="bg-bambu-dark border border-bambu-dark-tertiary rounded px-2 py-2 text-sm text-white"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2 text-xs text-bambu-gray">
              {ROLE_OPTIONS.find((option) => option.value === role)?.description}
            </div>

            <div className="mt-3">
              <Button
                onClick={() =>
                  upsertMutation.mutate({
                    principal_type: principalType,
                    principal_id: Number(principalId),
                    role,
                  })
                }
                disabled={
                  !principalId ||
                  upsertMutation.isPending ||
                  principalsQuery.isLoading
                }
              >
                {upsertMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  t('fileManager.sharing.addButton', {
                    defaultValue: 'Add access',
                  })
                )}
              </Button>
            </div>
          </section>

          <div className="flex gap-2 p-3 rounded border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {t('fileManager.sharing.warning', {
                defaultValue:
                  'The strongest matching user or group grant wins. Removing a group member immediately removes access that came only from that group.',
              })}
            </span>
          </div>
        </div>

        <div className="p-4 border-t border-bambu-dark-tertiary flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
