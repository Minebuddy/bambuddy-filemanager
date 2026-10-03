"""Regression coverage for inheritance and moves across group grants."""

import pytest
from fastapi import HTTPException
from sqlalchemy import insert

from backend.app.models.group import Group, user_groups
from backend.app.models.library import LibraryFolder, LibraryFolderShare
from backend.app.models.user import User
from backend.app.services.library_access import folder_access_roles, require_preserved_folder_access


async def test_deep_folder_inheritance_does_not_recurse(db_session):
    user = User(username="deep-tree-owner", password_hash="unused")
    db_session.add(user)
    await db_session.flush()
    # More levels than Python's recursion limit; insert deepest first so the
    # evaluator cannot depend on database row order or pre-cached parents.
    await db_session.execute(
        insert(LibraryFolder),
        [
            {
                "id": i,
                "name": f"level-{i}",
                "parent_id": i - 1 if i > 1 else None,
                "created_by_id": user.id if i == 1 else None,
            }
            for i in range(1200, 0, -1)
        ],
    )
    roles = await folder_access_roles(db_session, user)
    assert len(roles) == 1200
    assert roles[1200] == "manager"


async def test_moves_preserve_group_identity_not_just_current_members(db_session):
    user = User(username="shared-member", password_hash="unused")
    groups = [Group(name="Class A", permissions=[]), Group(name="Class B", permissions=[])]
    folders = [LibraryFolder(name="A"), LibraryFolder(name="B")]
    db_session.add_all([user, *groups, *folders])
    await db_session.flush()
    for group, folder in zip(groups, folders, strict=True):
        await db_session.execute(insert(user_groups).values(user_id=user.id, group_id=group.id))
        db_session.add(LibraryFolderShare(folder_id=folder.id, group_id=group.id, role="manager"))
    await db_session.flush()
    roles = await folder_access_roles(db_session, user)
    assert roles[folders[0].id] == roles[folders[1].id] == "manager"
    with pytest.raises(HTTPException) as error:
        await require_preserved_folder_access(db_session, folders[0].id, folders[1].id)
    assert error.value.status_code == 403
