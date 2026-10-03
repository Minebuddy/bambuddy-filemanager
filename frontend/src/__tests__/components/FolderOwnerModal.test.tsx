import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { FolderOwnerModal } from '../../components/FolderOwnerModal';
import { server } from '../mocks/server';
import { render } from '../utils';

const folder = {
  id: 12,
  name: 'Legacy class folder',
  parent_id: null,
  created_by_id: null,
  project_id: null,
  archive_id: null,
  project_name: null,
  archive_name: null,
  is_external: false,
  external_path: null,
  external_readonly: false,
  file_count: 2,
  latest_activity_at: null,
  children: [],
};

describe('FolderOwnerModal', () => {
  it('assigns a selected user without changing files', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/v1/users/slim', () =>
        HttpResponse.json([
          { id: 7, username: 'student-a' },
          { id: 8, username: 'student-b' },
        ]),
      ),
      http.patch('/api/v1/library/folders/:id/owner', async ({ request, params }) => {
        body = await request.json();
        return HttpResponse.json({
          id: Number(params.id),
          created_by_id: 7,
          updated_folders: 1,
        });
      }),
    );

    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FolderOwnerModal folder={folder} onClose={onClose} />);

    const select = await screen.findByRole('listbox', { name: 'New owner' });
    await user.selectOptions(select, '7');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(body).toEqual({ created_by_id: 7, recursive: false });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('can clear ownership and apply it recursively', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/v1/users/slim', () =>
        HttpResponse.json([{ id: 7, username: 'student-a' }]),
      ),
      http.patch('/api/v1/library/folders/:id/owner', async ({ request, params }) => {
        body = await request.json();
        return HttpResponse.json({
          id: Number(params.id),
          created_by_id: null,
          updated_folders: 3,
        });
      }),
    );

    const user = userEvent.setup();
    render(
      <FolderOwnerModal
        folder={{ ...folder, created_by_id: 7 }}
        onClose={() => undefined}
      />,
    );

    const select = await screen.findByRole('listbox', { name: 'New owner' });
    await user.selectOptions(select, '');
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Apply the same owner to all internal subfolders',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(body).toEqual({ created_by_id: null, recursive: true });
    });
  });

  it('filters the user picker by username', async () => {
    server.use(
      http.get('/api/v1/users/slim', () =>
        HttpResponse.json([
          { id: 7, username: 'student-a' },
          { id: 8, username: 'student-b' },
        ]),
      ),
    );

    const user = userEvent.setup();
    render(<FolderOwnerModal folder={folder} onClose={() => undefined} />);

    await user.type(await screen.findByPlaceholderText('Search users...'), 'student-b');

    const select = screen.getByRole('listbox', { name: 'New owner' });
    expect(screen.queryByRole('option', { name: 'student-a' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'student-b' })).toBeInTheDocument();
    expect(select).toBeInTheDocument();
  });
});
