import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { AlertTriangle, Loader2, Search, Share2, User, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LibraryFolderTree } from '../api/client';
import { libraryOwnershipApi, type FolderAccessOverviewShare } from '../api/libraryOwnership';
import { Button } from './Button';

interface LibraryAccessOverviewModalProps {
  folders: LibraryFolderTree[];
  onManageOwner: (folder: LibraryFolderTree) => void;
  onManageAccess: (folder: LibraryFolderTree) => void;
  onClose: () => void;
}

function shareSummary(
  shares: FolderAccessOverviewShare[],
  t: TFunction,
): string {
  if (shares.length === 0) {
    return t('fileManager.accessOverview.none', { defaultValue: 'None' });
  }
  return shares
    .map(
      (share) =>
        `${share.principal_name} (${t(`fileManager.sharing.roles.${share.role}`, {
          defaultValue: share.role,
        })})`,
    )
    .join(', ');
}

export function LibraryAccessOverviewModal({
  folders,
  onManageOwner,
  onManageAccess,
  onClose,
}: LibraryAccessOverviewModalProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const overviewQuery = useQuery({
    queryKey: ['library-folder-access-overview'],
    queryFn: () => libraryOwnershipApi.getAccessOverview(),
  });

  const foldersById = useMemo(() => {
    const result = new Map<number, LibraryFolderTree>();
    const stack = [...folders];
    while (stack.length > 0) {
      const folder = stack.pop()!;
      result.set(folder.id, folder);
      stack.push(...folder.children);
    }
    return result;
  }, [folders]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (overviewQuery.data ?? []).filter((item) => {
      if (!needle) return true;
      return [
        item.path,
        item.owner_name ?? '',
        ...item.direct_shares.map((share) => share.principal_name),
        ...item.inherited_shares.map((share) => share.principal_name),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [overviewQuery.data, search]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-bambu-dark-secondary rounded-lg w-full max-w-5xl border border-bambu-dark-tertiary max-h-[88vh] flex flex-col">
        <div className="p-4 border-b border-bambu-dark-tertiary">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Share2 className="w-5 h-5 text-bambu-green" />
            {t('fileManager.accessOverview.title', {
              defaultValue: 'Library access review',
            })}
          </h2>
          <p className="text-sm text-bambu-gray mt-1">
            {t('fileManager.accessOverview.description', {
              defaultValue:
                'Review unassigned folders and folders with mixed or ownerless files. Ownership is never inferred here; assign it only after review.',
            })}
          </p>
        </div>

        <div className="p-4 border-b border-bambu-dark-tertiary">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-bambu-gray" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('fileManager.accessOverview.search', {
                defaultValue: 'Search folders, owners, or shares',
              })}
              className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded pl-9 pr-3 py-2 text-sm text-white placeholder-bambu-gray focus:outline-none focus:border-bambu-green"
            />
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-3">
          {overviewQuery.isLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-bambu-green" />
            </div>
          ) : overviewQuery.error ? (
            <div role="alert" className="text-sm text-red-300">
              {(overviewQuery.error as Error).message}
            </div>
          ) : visibleRows.length === 0 ? (
            <p className="text-sm text-bambu-gray py-6 text-center">
              {t('fileManager.accessOverview.empty', {
                defaultValue: search
                  ? 'No folders match this search.'
                  : 'No unassigned or ambiguous folders need review.',
              })}
            </p>
          ) : (
            visibleRows.map((item) => {
              const folder = foldersById.get(item.id);
              return (
                <article
                  key={item.id}
                  className="rounded border border-bambu-dark-tertiary bg-bambu-dark/30 p-3 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white break-words">
                        {item.name}
                      </div>
                      <div className="text-xs text-bambu-gray mt-0.5 break-all">
                        {item.path}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-bambu-gray">
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3.5 h-3.5" />
                          {item.owner_name ??
                            t('fileManager.accessOverview.unassigned', {
                              defaultValue: 'Unassigned',
                            })}
                        </span>
                        <span>
                          {t('fileManager.accessOverview.fileEvidence', {
                            count: item.file_count,
                            defaultValue: '{{count}} active files in this folder tree',
                          })}
                        </span>
                      </div>
                    </div>
                    {item.is_ambiguous && (
                      <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t('fileManager.accessOverview.ambiguous', {
                          defaultValue: 'Mixed or unknown file owners',
                        })}
                      </span>
                    )}
                  </div>

                  {item.is_ambiguous && (
                    <p className="text-xs text-amber-100/80">
                      {t('fileManager.accessOverview.evidence', {
                        owners: item.distinct_file_owners,
                        ownerless: item.ownerless_file_count,
                        defaultValue:
                          '{{owners}} distinct file owners; {{ownerless}} files have no owner. Review before assigning a folder owner.',
                      })}
                    </p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div className="rounded bg-bambu-dark p-2 min-w-0">
                      <div className="text-bambu-gray mb-1">
                        {t('fileManager.accessOverview.directShares', {
                          defaultValue: 'Direct shares',
                        })}
                      </div>
                      <div className="text-white break-words">
                        {shareSummary(item.direct_shares, t)}
                      </div>
                    </div>
                    <div className="rounded bg-bambu-dark p-2 min-w-0">
                      <div className="text-bambu-gray mb-1">
                        {t('fileManager.accessOverview.inheritedShares', {
                          defaultValue: 'Inherited from parent folders',
                        })}
                      </div>
                      <div className="text-white break-words">
                        {shareSummary(item.inherited_shares, t)}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!folder}
                      onClick={() => folder && onManageAccess(folder)}
                    >
                      <Users className="w-4 h-4 mr-1.5" />
                      {t('fileManager.sharing.manage', {
                        defaultValue: 'Manage access',
                      })}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!folder}
                      onClick={() => folder && onManageOwner(folder)}
                    >
                      <User className="w-4 h-4 mr-1.5" />
                      {t('fileManager.folderOwner.manage', {
                        defaultValue: 'Manage owner',
                      })}
                    </Button>
                  </div>
                </article>
              );
            })
          )}
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
