"""Effective access calculation for shared library folders."""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
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


async def folder_access_grants(db: AsyncSession, folder_id: int | None) -> dict[tuple[str, int], str]:
    """Describe inherited grants without expanding groups into current members.

    Move checks compare these grants so future membership changes cannot turn
    an apparently safe move into a new disclosure. Owners are manager grants.
    """
    grants: dict[tuple[str, int], str] = {}
    visited: set[int] = set()
    while folder_id is not None:
        if folder_id in visited:
            raise HTTPException(409, "Cannot move content through a cyclic folder tree")
        visited.add(folder_id)
        folder = await db.get(LibraryFolder, folder_id)
        if folder is None:
            raise HTTPException(404, "Folder not found")
        if folder.created_by_id is not None:
            grants[("user", folder.created_by_id)] = "manager"
        shares = (
            await db.execute(select(LibraryFolderShare).where(LibraryFolderShare.folder_id == folder_id))
        ).scalars()
        for share in shares:
            principal = ("user", share.user_id) if share.user_id is not None else ("group", share.group_id)
            grants[principal] = stronger_role(grants.get(principal), share.role) or share.role
        if folder.is_external:
            break
        folder_id = folder.parent_id
    return grants


async def require_preserved_folder_access(
    db: AsyncSession,
    source_id: int | None,
    destination_id: int | None,
) -> None:
    """Managers may reorganize others' content only within the same access context."""
    if source_id == destination_id:
        return
    if await folder_access_grants(db, source_id) != await folder_access_grants(db, destination_id):
        raise HTTPException(403, "Moving another user's content cannot change inherited access; ask an administrator")


async def folder_tree_ids(db: AsyncSession, folder_id: int) -> set[int]:
    """Collect a subtree, rejecting malformed cycles before changing content."""
    visited: set[int] = set()
    pending = [folder_id]
    while pending:
        current = pending.pop()
        if current in visited:
            raise HTTPException(409, "Cyclic folder tree")
        visited.add(current)
        rows = await db.execute(select(LibraryFolder.id).where(LibraryFolder.parent_id == current))
        pending.extend(rows.scalars().all())
    return visited


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
    """Return every folder accessible to a user and its strongest role.

    Ownership is manager access on a folder and its descendants. Shares also
    inherit down the folder tree. This preserves the parent owner's authority
    when a contributor creates a child folder with their own created_by_id.
    When multiple ownership/user/group paths apply, the strongest role wins.
    """

    folder_rows = (
        await db.execute(
            select(
                LibraryFolder.id,
                LibraryFolder.parent_id,
                LibraryFolder.created_by_id,
                LibraryFolder.is_external,
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
        await db.execute(select(LibraryFolderShare.folder_id, LibraryFolderShare.role).where(or_(*principal_filters)))
    ).all()

    direct_share_roles: dict[int, str] = {}
    for folder_id, role in share_rows:
        fid = int(folder_id)
        direct_share_roles[fid] = (
            stronger_role(
                direct_share_roles.get(fid),
                role,
            )
            or role
        )

    parents: dict[int, int | None] = {}
    owners: dict[int, int | None] = {}
    external_ids: set[int] = set()
    for folder_id, parent_id, owner_id, is_external in folder_rows:
        if is_external:
            external_ids.add(int(folder_id))
        fid = int(folder_id)
        parents[fid] = int(parent_id) if parent_id is not None else None
        owners[fid] = int(owner_id) if owner_id is not None else None

    inherited_cache: dict[int, str | None] = {}

    effective: dict[int, str] = {}
    for folder_id in parents:
        path: list[int] = []
        visiting: set[int] = set()
        current: int | None = folder_id
        while current is not None and current in parents and current not in inherited_cache:
            if current in visiting:
                raise HTTPException(409, "Cyclic folder tree")
            visiting.add(current)
            path.append(current)
            current = None if current in external_ids else parents[current]
        role = inherited_cache.get(current) if current is not None else None
        for child_id in reversed(path):
            role = stronger_role(
                role,
                direct_share_roles.get(child_id),
                "manager" if owners.get(child_id) == user.id else None,
            )
            inherited_cache[child_id] = role
        role = inherited_cache.get(folder_id)
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
