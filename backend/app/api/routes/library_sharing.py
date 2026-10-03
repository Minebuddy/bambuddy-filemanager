"""Explicit file grants and bulk library access management."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.auth import require_permission_if_auth_enabled
from backend.app.core.database import get_db
from backend.app.core.permissions import Permission
from backend.app.models.group import Group
from backend.app.models.library import LibraryFile, LibraryFileShare, LibraryFolder, LibraryFolderShare
from backend.app.models.user import User
from backend.app.schemas.library import FolderShareUpsert
from backend.app.services.library_access import file_access_roles, folder_access_roles, navigation_folder_ids

router = APIRouter()
ShareUser = Depends(require_permission_if_auth_enabled(Permission.LIBRARY_SHARE))


async def managed_file(db, file_id, user):
    file = await db.get(LibraryFile, file_id)
    if file is None or file.deleted_at is not None:
        raise HTTPException(404, "File not found")
    if file.is_external:
        raise HTTPException(400, "External files cannot be shared")
    if user and not user.is_admin and file.created_by_id != user.id:
        raise HTTPException(403, "Only the owner or an administrator can manage access")
    return file


async def principal(db, data):
    model = User if data.principal_type == "user" else Group
    item = await db.get(model, data.principal_id)
    if item is None or (isinstance(item, User) and not item.is_active):
        raise HTTPException(404, "Principal not found")
    return item


async def shares_for(db, model, key, resource_ids):
    rows = (
        await db.execute(
            select(model, User.username, Group.name)
            .outerjoin(User, model.user_id == User.id)
            .outerjoin(Group, model.group_id == Group.id)
            .where(getattr(model, key).in_(resource_ids))
            .order_by(model.id)
        )
    ).all()
    result = {}
    for item, username, group_name in rows:
        resource_id = getattr(item, key)
        result.setdefault(resource_id, []).append(
            dict(
                id=item.id,
                principal_type="user" if item.user_id else "group",
                principal_id=item.user_id or item.group_id,
                principal_name=username or group_name or "Unknown",
                role=item.role,
                created_at=item.created_at,
                **{key: resource_id},
            )
        )
    return result


async def shares(db, model, key, resource_id):
    return (await shares_for(db, model, key, [resource_id])).get(resource_id, [])


async def set_share(db, model, key, resource_id, data, user):
    column = model.user_id if data.principal_type == "user" else model.group_id
    item = (
        await db.execute(select(model).where(getattr(model, key) == resource_id, column == data.principal_id))
    ).scalar_one_or_none()
    if item is None:
        item = model(
            **{key: resource_id, "user_id" if data.principal_type == "user" else "group_id": data.principal_id},
            role=data.role,
            created_by_id=user.id if user else None,
        )
        db.add(item)
    else:
        item.role = data.role
    return item


@router.get("/files/{file_id}/shares")
async def list_file_shares(file_id: int, db: AsyncSession = Depends(get_db), user: User | None = ShareUser):
    await managed_file(db, file_id, user)
    return await shares(db, LibraryFileShare, "file_id", file_id)


@router.get("/files/{file_id}/share-principals")
async def file_principals(file_id: int, db: AsyncSession = Depends(get_db), user: User | None = ShareUser):
    await managed_file(db, file_id, user)
    return await available_principals(db, user)


@router.get("/access/principals")
async def available_principals(db: AsyncSession = Depends(get_db), user: User | None = ShareUser):
    return {
        "users": [
            {"id": i, "name": n}
            for i, n in (
                await db.execute(select(User.id, User.username).where(User.is_active.is_(True)).order_by(User.username))
            ).all()
        ],
        "groups": [
            {"id": i, "name": n} for i, n in (await db.execute(select(Group.id, Group.name).order_by(Group.name))).all()
        ],
    }


@router.put("/files/{file_id}/shares")
async def upsert_file_share(
    file_id: int, data: FolderShareUpsert, db: AsyncSession = Depends(get_db), user: User | None = ShareUser
):
    await managed_file(db, file_id, user)
    await principal(db, data)
    item = await set_share(db, LibraryFileShare, "file_id", file_id, data, user)
    await db.commit()
    return next(s for s in await shares(db, LibraryFileShare, "file_id", file_id) if s["id"] == item.id)


@router.delete("/files/{file_id}/shares/{share_id}", status_code=204)
async def remove_file_share(
    file_id: int, share_id: int, db: AsyncSession = Depends(get_db), user: User | None = ShareUser
):
    await managed_file(db, file_id, user)
    item = await db.get(LibraryFileShare, share_id)
    if item is None or item.file_id != file_id:
        raise HTTPException(404, "Share not found")
    await db.delete(item)
    await db.commit()


@router.get("/access/resources")
async def access_resources(
    kind: Literal["file", "folder"] = "file",
    search: str = "",
    owner_id: int | None = None,
    unassigned: bool = False,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User | None = ShareUser,
):
    model = LibraryFile if kind == "file" else LibraryFolder
    query = (
        select(model, User.username).outerjoin(User, model.created_by_id == User.id).where(model.is_external.is_(False))
    )
    if kind == "file":
        query = query.where(LibraryFile.deleted_at.is_(None))
    if user and not user.is_admin:
        query = query.where(model.created_by_id == user.id)
    if owner_id is not None:
        query = query.where(model.created_by_id == owner_id)
    if unassigned:
        query = query.where(model.created_by_id.is_(None))
    name = model.filename if kind == "file" else model.name
    if search:
        query = query.where(name.ilike(f"%{search}%"))
    rows = (await db.execute(query.order_by(name, model.id).offset(offset).limit(limit + 1))).all()
    folders = {
        i: (n, p)
        for i, n, p in (await db.execute(select(LibraryFolder.id, LibraryFolder.name, LibraryFolder.parent_id))).all()
    }

    def path(fid):
        parts, seen = [], set()
        while fid in folders and fid not in seen:
            seen.add(fid)
            n, fid = folders[fid]
            parts.append(n)
        return " / ".join(reversed(parts))

    share_model, key = (LibraryFileShare, "file_id") if kind == "file" else (LibraryFolderShare, "folder_id")
    resource_shares = await shares_for(db, share_model, key, [r.id for r, _ in rows[:limit]])
    return {
        "items": [
            {
                "id": r.id,
                "kind": kind,
                "name": r.filename if kind == "file" else r.name,
                "path": path(r.folder_id if kind == "file" else r.parent_id),
                "owner_id": r.created_by_id,
                "owner_name": u,
                "shares": resource_shares.get(r.id, []),
            }
            for r, u in rows[:limit]
        ],
        "has_more": len(rows) > limit,
    }


class BulkAccess(BaseModel):
    kind: Literal["file", "folder"]
    ids: list[int] = Field(min_length=1, max_length=500)
    action: Literal["grant", "revoke", "owner"]
    principal_type: Literal["user", "group"] = "user"
    principal_id: int | None = Field(None, ge=1)
    role: Literal["viewer", "contributor", "manager"] = "viewer"
    owner_id: int | None = Field(None, ge=1)


@router.post("/access/bulk")
async def bulk_access(data: BulkAccess, db: AsyncSession = Depends(get_db), user: User | None = ShareUser):
    model, share_model, key = (
        (LibraryFile, LibraryFileShare, "file_id")
        if data.kind == "file"
        else (LibraryFolder, LibraryFolderShare, "folder_id")
    )
    if data.action == "owner" and "owner_id" not in data.model_fields_set:
        raise HTTPException(422, "Ownership assignment requires an explicit owner_id (or null)")
    if data.action == "owner" and user and not user.is_admin:
        raise HTTPException(403, "Only administrators can assign ownership")
    ids = set(data.ids)
    items = (await db.execute(select(model).where(model.id.in_(ids)))).scalars().all()
    if len(items) != len(ids):
        raise HTTPException(404, "One or more items were not found")
    for item in items:
        if item.is_external or (data.kind == "file" and item.deleted_at is not None):
            raise HTTPException(400, "External or trashed items cannot be managed here")
        if user and not user.is_admin and item.created_by_id != user.id:
            raise HTTPException(403, "Only the owner or an administrator can manage access")
    removed = 0
    retained_access = []
    if data.action == "owner":
        if data.owner_id is not None:
            await principal(db, FolderShareUpsert(principal_type="user", principal_id=data.owner_id, role="manager"))
        for item in items:
            item.created_by_id = data.owner_id
            if data.kind == "folder":
                item.ownership_reviewed = True
    else:
        if data.principal_id is None:
            raise HTTPException(422, "Select a user or group")
        grant = FolderShareUpsert(principal_type=data.principal_type, principal_id=data.principal_id, role=data.role)
        recipient = await principal(db, grant)
        for item in items:
            if data.action == "grant":
                await set_share(db, share_model, key, item.id, grant, user)
                if data.kind == "folder":
                    item.ownership_reviewed = True
            else:
                column = share_model.user_id if data.principal_type == "user" else share_model.group_id
                existing = (
                    await db.execute(
                        select(share_model).where(getattr(share_model, key) == item.id, column == data.principal_id)
                    )
                ).scalar_one_or_none()
                if existing:
                    await db.delete(existing)
                    removed += 1
        if data.action == "revoke" and data.principal_type == "user":
            await db.flush()
            roles = (
                await file_access_roles(db, recipient)
                if data.kind == "file"
                else await folder_access_roles(db, recipient)
            )
            navigation = await navigation_folder_ids(db, recipient) if data.kind == "folder" else set()
            for item in items:
                reason = None
                if recipient.is_admin or recipient.has_permission(Permission.LIBRARY_READ_ALL.value):
                    reason = "Global library access"
                elif item.created_by_id == recipient.id:
                    reason = "Ownership"
                elif item.id in roles:
                    reason = "Another user or group grant"
                elif item.id in navigation:
                    reason = "Navigation to accessible files or folders"
                if reason:
                    retained_access.append({"id": item.id, "reason": reason})
    await db.commit()
    return {
        "updated": removed if data.action == "revoke" else len(items),
        "removed": removed,
        "retained_access": retained_access,
    }
