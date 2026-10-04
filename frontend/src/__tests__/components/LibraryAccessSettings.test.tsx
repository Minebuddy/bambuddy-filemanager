import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { FolderSharingModal } from '../../components/FolderSharingModal';
import { LibraryAccessSettings } from '../../components/LibraryAccessSettings';
import { server } from '../mocks/server';
import { render } from '../utils';

function handlers() {
  server.use(
    http.get('/api/v1/library/access/resources', () => HttpResponse.json({items: [1, 2].map(id => ({id, kind: 'file', name: `model-${id}.stl`, path: 'klas / LADTEA54 / Project Turbo', owner_id: 7, owner_name: 'Alice', shares: []})), has_more: false})),
    http.get('/api/v1/library/access/principals', () => HttpResponse.json({users: [{id: 7, name: 'Alice'}], groups: [{id: 9, name: 'Class A'}]})),
  );
}

describe('LibraryAccessSettings', () => {
  it('grants access only to selected rows and shows the full folder path', async () => {
    handlers();
    let body: unknown;
    server.use(http.post('/api/v1/library/access/bulk', async ({request}) => {body = await request.json(); return HttpResponse.json({updated: 1});}));
    render(<LibraryAccessSettings />);
    expect(await screen.findAllByText('klas / LADTEA54 / Project Turbo')).toHaveLength(2);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Select model-2.stl'));
    await user.selectOptions(screen.getByLabelText('Principal type'), 'group');
    await user.selectOptions(screen.getByLabelText('User or group'), '9');
    await user.click(screen.getByRole('button', {name: 'Apply to 1 selected'}));
    await waitFor(() => expect(body).toEqual({kind: 'file', ids: [2], action: 'grant', principal_type: 'group', principal_id: 9, role: 'viewer'}));
    expect(await screen.findByText('0 selected on this page')).toBeInTheDocument();
  });

  it('keeps selection when a bulk action fails', async () => {
    handlers();
    server.use(http.post('/api/v1/library/access/bulk', () => HttpResponse.json({detail: 'One item is protected'}, {status: 403})));
    render(<LibraryAccessSettings />);
    await screen.findByText('model-1.stl');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Select model-1.stl'));
    await user.selectOptions(screen.getByLabelText('User or group'), '7');
    await user.click(screen.getByRole('button', {name: 'Apply to 1 selected'}));
    expect(await screen.findByText('One item is protected')).toBeInTheDocument();
    expect(screen.getByLabelText('Select model-1.stl')).toBeChecked();
  });
  it('uses direct file endpoints for the file share picker', async () => {
    let body: unknown;
    server.use(
      http.get('/api/v1/library/files/12/shares', () => HttpResponse.json([])),
      http.get('/api/v1/library/files/12/share-principals', () => HttpResponse.json({users: [{id: 7, name: 'Alice'}], groups: []})),
      http.put('/api/v1/library/files/12/shares', async ({request}) => {body = await request.json(); return HttpResponse.json({id: 1, file_id: 12, principal_type: 'user', principal_id: 7, principal_name: 'Alice', role: 'viewer', created_at: new Date().toISOString()});}),
    );
    render(<FolderSharingModal folder={{id: 12, name: 'model.stl'}} kind="files" onClose={vi.fn()} />);
    await screen.findByText('Alice');
    expect(screen.getByText('Access applies only to this item')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getAllByRole('combobox')[1], '7');
    await user.click(screen.getByRole('button', {name: 'Add access'}));
    await waitFor(() => expect(body).toEqual({principal_type: 'user', principal_id: 7, role: 'viewer'}));
  });

  it('explains ownership access after revoking a direct share', async () => {
    handlers();
    server.use(http.post('/api/v1/library/access/bulk', () => HttpResponse.json({updated: 1, removed: 1, retained_access: [{id: 1, reason: 'Ownership'}]})));
    render(<LibraryAccessSettings />);
    await screen.findByText('model-1.stl');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Select model-1.stl'));
    await user.selectOptions(screen.getByLabelText('Bulk action'), 'revoke');
    await user.selectOptions(screen.getByLabelText('User or group'), '7');
    await user.click(screen.getByRole('button', {name: 'Apply to 1 selected'}));
    expect(await screen.findByText('1 selected items remain visible to this user.')).toBeInTheDocument();
    expect(screen.getByText('Ownership')).toBeInTheDocument();
  });

});
