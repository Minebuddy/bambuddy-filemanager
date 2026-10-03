import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { librarySharingApi, type BulkAccessRequest, type FolderShareRole } from '../api/librarySharing';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from './Button';
import { FolderSharingModal } from './FolderSharingModal';

export function LibraryAccessSettings() {
  const { isAdmin, authEnabled } = useAuth();
  const { showToast } = useToast();
  const client = useQueryClient();
  const [kind, setKind] = useState<'file' | 'folder'>('file');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [action, setAction] = useState<BulkAccessRequest['action']>('grant');
  const [principalType, setPrincipalType] = useState<'user' | 'group'>('user');
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<FolderShareRole>('viewer');
  const [ownerId, setOwnerId] = useState('');
  const [editing, setEditing] = useState<{id: number; name: string} | null>(null);
  const params = new URLSearchParams({kind, search, offset: String(offset)});
  if (ownerFilter === 'unassigned') params.set('unassigned', 'true');
  else if (ownerFilter) params.set('owner_id', ownerFilter);
  const resources = useQuery({queryKey: ['library-access-resources', params.toString()], queryFn: () => librarySharingApi.getAccessResources(params)});
  const principals = useQuery({queryKey: ['library-access-principals'], queryFn: librarySharingApi.getAccessPrincipals});
  const mutation = useMutation({
    mutationFn: librarySharingApi.bulkAccess,
    onSuccess: (result) => {
      showToast(`Updated ${result.updated} selected items.`, 'success');
      setSelected([]);
      for (const key of ['library-access-resources', 'library-folders', 'library-files', 'library-stats', 'library-folder-access-overview', 'library-resource-shares']) client.invalidateQueries({queryKey: [key]});
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });
  const rows = resources.data?.items ?? [];
  const picker = principalType === 'user' ? principals.data?.users : principals.data?.groups;
  const control = 'rounded border border-bambu-dark-tertiary bg-bambu-dark p-2 text-white';
  const reset = () => { setOffset(0); setSelected([]); };
  return <section className="space-y-4">
    <h2 className="text-xl font-semibold">Library access</h2>
    <p className="text-sm text-bambu-gray">Manage ownership and direct user/group access. Sharing a folder does not share its files or subfolders. Parent folders appear only as navigation.</p>
    <div className="flex flex-wrap gap-3">
      <select aria-label="Item type" className={control} value={kind} onChange={e => {setKind(e.target.value as typeof kind); setRole('viewer'); reset();}}><option value="file">Files</option><option value="folder">Folders</option></select>
      <input aria-label="Search library items" className={control} placeholder="Search names" value={search} onChange={e => {setSearch(e.target.value); reset();}} />
      <select aria-label="Filter by owner" className={control} value={ownerFilter} onChange={e => {setOwnerFilter(e.target.value); reset();}}><option value="">All owners</option><option value="unassigned">Unassigned</option>{principals.data?.users.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </div>
    {resources.isError && <p role="alert">{resources.error.message}</p>}
    {principals.isError && <p role="alert">{principals.error.message}</p>}
    <div className="rounded border border-bambu-dark-tertiary p-3 space-y-3">
      <p>{selected.length} selected on this page</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Bulk action" className={control} value={action} onChange={e => setAction(e.target.value as typeof action)}><option value="grant">Grant / update access</option><option value="revoke">Revoke access</option>{(isAdmin || !authEnabled) && <option value="owner">Assign ownership</option>}</select>
        {action === 'owner' ? <select aria-label="New owner" className={control} value={ownerId} onChange={e => setOwnerId(e.target.value)}><option value="">Unassigned</option>{principals.data?.users.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <>
          <select aria-label="Principal type" className={control} value={principalType} onChange={e => {setPrincipalType(e.target.value as typeof principalType); setPrincipalId('');}}><option value="user">User</option><option value="group">Group</option></select>
          <select aria-label="User or group" className={control} value={principalId} onChange={e => setPrincipalId(e.target.value)}><option value="">Select a {principalType}</option>{picker?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {action === 'grant' && <select aria-label="Access role" className={control} value={role} onChange={e => setRole(e.target.value as FolderShareRole)}><option value="viewer">Viewer</option>{kind === 'folder' && <option value="contributor">Contributor</option>}<option value="manager">Manager</option></select>}
        </>}
        <Button disabled={!selected.length || mutation.isPending || (action !== 'owner' && !principalId)} onClick={() => mutation.mutate({kind, ids: selected, action, ...(action === 'owner' ? {owner_id: ownerId ? Number(ownerId) : null} : {principal_type: principalType, principal_id: Number(principalId), role})})}>{mutation.isPending ? 'Applying…' : `Apply to ${selected.length} selected`}</Button>
      </div>
      <p className="text-xs text-bambu-gray">Only selected items change. Ownership assignment preserves existing shares. Revoking a grant does not remove access through ownership or another user/group grant.</p>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="p-2"><input type="checkbox" aria-label="Select this page" checked={!!rows.length && selected.length === rows.length} onChange={e => setSelected(e.target.checked ? rows.map(r => r.id) : [])} /></th><th>Name / path</th><th>Owner</th><th>Direct access</th><th /></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-bambu-dark-tertiary"><td className="p-2"><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)} onChange={e => setSelected(e.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} /></td><td className="p-2"><div>{row.name}</div><div className="text-xs text-bambu-gray">{row.path || 'Library'}</div></td><td>{row.owner_name || 'Unassigned'}</td><td>{row.shares.map(s => `${s.principal_name} (${s.principal_type}, ${s.role})`).join(', ') || 'None'}</td><td><Button variant="secondary" size="sm" onClick={() => setEditing(row)}>Manage access</Button></td></tr>)}</tbody></table></div>
    {resources.isPending ? <p>Loading…</p> : !rows.length && !resources.isError ? <p>No matching items.</p> : null}
    <div className="flex gap-2"><Button variant="secondary" disabled={!offset || resources.isFetching} onClick={() => {setOffset(Math.max(0, offset - 100)); setSelected([]);}}>Previous</Button><Button variant="secondary" disabled={!resources.data?.has_more || resources.isFetching} onClick={() => {setOffset(offset + 100); setSelected([]);}}>Next</Button></div>
    {editing && <FolderSharingModal folder={editing} kind={kind === 'file' ? 'files' : 'folders'} onClose={() => setEditing(null)} />}
  </section>;
}
