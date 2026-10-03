"""Effective access calculation for shared library folders."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.group import user_groups
from backend.app.models.library import LibraryFile, LibraryFileShare, LibraryFolder, LibraryFolderShare
from backend.app.models.user import User

ROLE_RANK: dict[str, int] = {
    "viewer": 1,
    "contributor": 2,
    "manager": 3,
}


def stronger_role(*roles: str | None) -> str | None:
    """Return the strongest non-null folder role."""

    valid = [role for role in roles if role in ROLE_RANK]
    if not valid:
        return None
    return max(valid, key=ROLE_RANK.__getitem__)


def role_allows(role: str | None, required: str) -> bool:
    """Return whether a role meets or exceeds the required role."""

    return ROLE_RANK.get(role or "", 0) >= ROLE_RANK[required]


async def _user_group_ids(db: AsyncSession, user_id: int) -> set[int]:
    rows = await db.execute(select(user_groups.c.group_id).where(user_groups.c.user_id == user_id))
    return {int(group_id) for (group_id,) in rows.all()}


async def folder_access_roles(db: AsyncSession, user: User) -> dict[int, str]:
    """Return direct folder ownership and grants; descendants never inherit."""
    return await _direct_roles(db, user, LibraryFolder, LibraryFolderShare, "folder_id")


async def _direct_roles(db, user, model, share_model, resource_key):
    roles = {
        int(fid): "manager"
        for fid in (await db.execute(select(model.id).where(model.created_by_id == user.id))).scalars()
    }
    groups = await _user_group_ids(db, user.id)
    filters = [share_model.user_id == user.id]
    if groups:
        filters.append(share_model.group_id.in_(groups))
    rows = (await db.execute(select(getattr(share_model, resource_key), share_model.role).where(or_(*filters)))).all()
    for resource_id, role in rows:
        roles[resource_id] = stronger_role(roles.get(resource_id), role) or role
    return roles


async def file_access_roles(db: AsyncSession, user: User) -> dict[int, str]:
    """Files require their own ownership or direct user/group grant."""
    return await _direct_roles(db, user, LibraryFile, LibraryFileShare, "file_id")


async def effective_file_role(db: AsyncSession, file_id: int, user: User) -> str | None:
    return (await file_access_roles(db, user)).get(file_id)


async def navigation_folder_ids(db: AsyncSession, user: User) -> set[int]:
    """Include ancestors as navigation only, without granting resource access."""
    ids = set(await folder_access_roles(db, user))
    file_ids = set(await file_access_roles(db, user))
    ids.update(
        fid
        for fid in (
            await db.execute(
                select(LibraryFile.folder_id).where(LibraryFile.id.in_(file_ids), LibraryFile.deleted_at.is_(None))
            )
        ).scalars()
        if fid is not None
    )
    parents = dict((await db.execute(select(LibraryFolder.id, LibraryFolder.parent_id))).all())
    pending = list(ids)
    while pending:
        parent = parents.get(pending.pop())
        if parent is not None and parent not in ids:
            ids.add(parent)
            pending.append(parent)
    return ids


async def accessible_folder_ids(
    db: AsyncSession,
    user: User,
    required_role: str = "viewer",
) -> set[int]:
    """Return folder IDs where the user has at least the required role."""

    roles = await folder_access_roles(db, user)
    return {folder_id for folder_id, role in roles.items() if role_allows(role, required_role)}


async def effective_folder_role(
    db: AsyncSession,
    folder_id: int,
    user: User,
) -> str | None:
    """Return the effective role for one folder."""

    return (await folder_access_roles(db, user)).get(folder_id)


async def effective_role_for_any_folder(
    db: AsyncSession,
    folder_ids: Iterable[int],
    user: User,
) -> dict[int, str]:
    """Return effective roles for the requested IDs only."""

    wanted = set(folder_ids)
    roles = await folder_access_roles(db, user)
    return {folder_id: role for folder_id, role in roles.items() if folder_id in wanted}
