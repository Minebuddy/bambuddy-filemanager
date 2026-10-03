"""Effective access calculation for shared library folders."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.group import user_groups
from backend.app.models.library import LibraryFolder, LibraryFolderShare
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
    rows = await db.execute(
        select(user_groups.c.group_id).where(user_groups.c.user_id == user_id)
    )
    return {int(group_id) for (group_id,) in rows.all()}


async def folder_access_roles(db: AsyncSession, user: User) -> dict[int, str]:
    """Return every folder accessible to a user and its strongest role.

    Ownership is manager access on that exact folder. Shares inherit down the
    folder tree. Ownership itself does not inherit. When multiple direct or
    inherited user/group shares apply, the strongest role wins.
    """

    folder_rows = (
        await db.execute(
            select(
                LibraryFolder.id,
                LibraryFolder.parent_id,
                LibraryFolder.created_by_id,
            )
        )
    ).all()
    if not folder_rows:
        return {}

    group_ids = await _user_group_ids(db, user.id)
    principal_filters = [LibraryFolderShare.user_id == user.id]
    if group_ids:
        principal_filters.append(LibraryFolderShare.group_id.in_(group_ids))

    share_rows = (
        await db.execute(
            select(LibraryFolderShare.folder_id, LibraryFolderShare.role).where(
                or_(*principal_filters)
            )
        )
    ).all()

    direct_share_roles: dict[int, str] = {}
    for folder_id, role in share_rows:
        fid = int(folder_id)
        direct_share_roles[fid] = stronger_role(
            direct_share_roles.get(fid),
            role,
        ) or role

    parents: dict[int, int | None] = {}
    owners: dict[int, int | None] = {}
    for folder_id, parent_id, owner_id in folder_rows:
        fid = int(folder_id)
        parents[fid] = int(parent_id) if parent_id is not None else None
        owners[fid] = int(owner_id) if owner_id is not None else None

    inherited_cache: dict[int, str | None] = {}

    def inherited_share_role(folder_id: int, visiting: set[int]) -> str | None:
        if folder_id in inherited_cache:
            return inherited_cache[folder_id]
        if folder_id in visiting:
            inherited_cache[folder_id] = None
            return None

        visiting.add(folder_id)
        parent_id = parents.get(folder_id)
        parent_role = (
            inherited_share_role(parent_id, visiting)
            if parent_id is not None and parent_id in parents
            else None
        )
        result = stronger_role(parent_role, direct_share_roles.get(folder_id))
        visiting.remove(folder_id)
        inherited_cache[folder_id] = result
        return result

    effective: dict[int, str] = {}
    for folder_id in parents:
        share_role = inherited_share_role(folder_id, set())
        owner_role = "manager" if owners.get(folder_id) == user.id else None
        role = stronger_role(owner_role, share_role)
        if role is not None:
            effective[folder_id] = role

    return effective


async def accessible_folder_ids(
    db: AsyncSession,
    user: User,
    required_role: str = "viewer",
) -> set[int]:
    """Return folder IDs where the user has at least the required role."""

    roles = await folder_access_roles(db, user)
    return {
        folder_id
        for folder_id, role in roles.items()
        if role_allows(role, required_role)
    }


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
    return {
        folder_id: role
        for folder_id, role in roles.items()
        if folder_id in wanted
    }
