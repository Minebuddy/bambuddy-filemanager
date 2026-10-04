"""Direct grant and deep navigation regression tests."""

from sqlalchemy import delete, insert

from backend.app.models.group import Group, user_groups
from backend.app.models.library import LibraryFile, LibraryFileShare, LibraryFolder, LibraryFolderShare
from backend.app.models.user import User
from backend.app.services.library_access import file_access_roles, folder_access_roles, navigation_folder_ids


async def test_deep_navigation_does_not_inherit_access_or_recurse(db_session):
    user = User(username="deep-tree-owner", password_hash="unused")
    db_session.add(user)
    await db_session.flush()
    await db_session.execute(
        insert(LibraryFolder),
        [
            {"id": i, "name": f"level-{i}", "parent_id": i - 1 if i > 1 else None, "created_by_id": None}
            for i in range(1200, 0, -1)
        ],
    )
    db_session.add(LibraryFolderShare(folder_id=1200, user_id=user.id, role="viewer"))
    await db_session.flush()
    assert await folder_access_roles(db_session, user) == {1200: "viewer"}
    assert await navigation_folder_ids(db_session, user) == set(range(1, 1201))


async def test_group_file_access_revokes_with_membership(db_session):
    user = User(username="shared-member", password_hash="unused")
    group = Group(name="Class A", permissions=[])
    folder = LibraryFolder(name="Private folder")
    db_session.add_all([user, group, folder])
    await db_session.flush()
    file = LibraryFile(
        filename="private.stl", file_path="private.stl", file_type="stl", file_size=1, folder_id=folder.id
    )
    db_session.add(file)
    await db_session.flush()
    await db_session.execute(insert(user_groups).values(user_id=user.id, group_id=group.id))
    db_session.add(LibraryFileShare(file_id=file.id, group_id=group.id, role="viewer"))
    await db_session.flush()
    assert await file_access_roles(db_session, user) == {file.id: "viewer"}
    assert await folder_access_roles(db_session, user) == {}
    assert await navigation_folder_ids(db_session, user) == {folder.id}
    await db_session.execute(delete(user_groups).where(user_groups.c.user_id == user.id))
    assert await file_access_roles(db_session, user) == {}
    assert await navigation_folder_ids(db_session, user) == set()
