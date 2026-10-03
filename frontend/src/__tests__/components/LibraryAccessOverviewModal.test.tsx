import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { LibraryAccessOverviewModal } from '../../components/LibraryAccessOverviewModal';
import type { LibraryFolderTree } from '../../api/client';
import { server } from '../mocks/server';
import { render } from '../utils';

const folder: LibraryFolderTree = {
  id: 12,
  name: 'Legacy student work',
  parent_id: 3,
  created_by_id: null,
  project_id: null,
  archive_id: null,
  project_name: null,
  archive_name: null,
  is_external: false,
  external_path: null,
  external_readonly: false,
  file_count: 3,
  latest_activity_at: null,
  children: [],
};

describe('LibraryAccessOverviewModal', () => {
  it('shows legacy ownership evidence and opens the existing owner workflow', async () => {
    server.use(
      http.get('/api/v1/library/access-overview/folders', () =>
        HttpResponse.json([
          {
            id: 12,
            name: 'Legacy student work',
            path: 'Teacher project / Legacy student work',
            parent_id: 3,
            created_by_id: null,
            owner_name: null,
            file_count: 3,
            distinct_file_owners: 2,
            ownerless_file_count: 1,
            is_ambiguous: true,
            direct_shares: [
              {
                source_folder_id: 12,
                source_folder_name: 'Legacy student work',
                principal_type: 'group',
                principal_id: 8,
                principal_name: 'Class 3B',
                role: 'viewer',
              },
            ],
            inherited_shares: [
              {
                source_folder_id: 3,
                source_folder_name: 'Teacher project',
                principal_type: 'user',
                principal_id: 7,
                principal_name: 'teacher',
                role: 'contributor',
              },
            ],
          },
        ]),
      ),
    );

    const user = userEvent.setup();
    const onManageOwner = vi.fn();
    render(
      <LibraryAccessOverviewModal
        folders={[folder]}
        onManageOwner={onManageOwner}
        onManageAccess={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('Legacy student work')).toBeInTheDocument();
    expect(screen.getByText('Mixed or unknown file owners')).toBeInTheDocument();
    expect(screen.getByText('Class 3B (viewer)')).toBeInTheDocument();
    expect(screen.getByText('teacher (contributor)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Manage owner' }));
    expect(onManageOwner).toHaveBeenCalledWith(folder);
  });
});
