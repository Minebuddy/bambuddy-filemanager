"""Integration tests for admin folder ownership repair (#3201)."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from backend.app.models.library import LibraryFile, LibraryFolder


@pytest.mark.asyncio
@pytest.mark.integration
async def test_admin_can_assign_legacy_folder_owner(
    async_client: AsyncClient, auth_setup, library_folder_factory, db_session
):
    folder = await library_folder_factory(name="LegacyUnassigned")

    response = await async_client.patch(
        f"/api/v1/library/folders/{folder.id}/owner",
        json={"created_by_id": auth_setup["operator_user"]["id"], "recursive": False},
        headers={"Authorization": f"Bearer {auth_setup['admin_token']}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": folder.id,
        "created_by_id": auth_setup["operator_user"]["id"],
        "updated_folders": 1,
    }

    db_session.expire_all()
    stored = (
        await db_session.execute(select(LibraryFolder).where(LibraryFolder.id == folder.id))
    ).scalar_one()
    assert stored.created_by_id == auth_setup["operator_user"]["id"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_admin_can_get_current_folder_owner(
    async_client: AsyncClient, auth_setup, library_folder_factory
):
    folder = await library_folder_factory(
        name="OwnedFolder",
        created_by_id=auth_setup["operator_user"]["id"],
    )

    response = await async_client.get(
        f"/api/v1/library/folders/{folder.id}/owner",
        headers={"Authorization": f"Bearer {auth_setup['admin_token']}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": folder.id,
        "created_by_id": auth_setup["operator_user"]["id"],
    }


@pytest.mark.asyncio
@pytest.mark.integration
async def test_admin_can_assign_folder_owner_recursively_without_changing_files(
    async_client: AsyncClient,
    auth_setup,
    library_folder_factory,
    library_file_factory,
    db_session,
):
    parent = await library_folder_factory(name="LegacyParent")
    child = await library_folder_factory(name="LegacyChild", parent_id=parent.id)
    owned_file = await library_file_factory(
        folder_id=child.id,
        created_by_id=auth_setup["operator2_user"]["id"],
    )

    response = await async_client.patch(
        f"/api/v1/library/folders/{parent.id}/owner",
        json={"created_by_id": auth_setup["operator_user"]["id"], "recursive": True},
        headers={"Authorization": f"Bearer {auth_setup['admin_token']}"},
    )

    assert response.status_code == 200
    assert response.json()["updated_folders"] == 2

    db_session.expire_all()
    folders = (
        await db_session.execute(
            select(LibraryFolder).where(LibraryFolder.id.in_([parent.id, child.id]))
        )
    ).scalars().all()
    assert {folder.created_by_id for folder in folders} == {
        auth_setup["operator_user"]["id"]
    }

    stored_file = (
        await db_session.execute(select(LibraryFile).where(LibraryFile.id == owned_file.id))
    ).scalar_one()
    assert stored_file.created_by_id == auth_setup["operator2_user"]["id"]


@pytest.mark.asyncio
@pytest.mark.integration
async def test_admin_can_clear_folder_owner(
    async_client: AsyncClient, auth_setup, library_folder_factory, db_session
):
    folder = await library_folder_factory(
        name="AssignedFolder",
        created_by_id=auth_setup["operator_user"]["id"],
    )

    response = await async_client.patch(
        f"/api/v1/library/folders/{folder.id}/owner",
        json={"created_by_id": None, "recursive": False},
        headers={"Authorization": f"Bearer {auth_setup['admin_token']}"},
    )

    assert response.status_code == 200
    assert response.json()["created_by_id"] is None

    db_session.expire_all()
    stored = (
        await db_session.execute(select(LibraryFolder).where(LibraryFolder.id == folder.id))
    ).scalar_one()
    assert stored.created_by_id is None


@pytest.mark.asyncio
@pytest.mark.integration
async def test_operator_cannot_reassign_folder_owner(
    async_client: AsyncClient, auth_setup, library_folder_factory
):
    folder = await library_folder_factory(
        name="OperatorFolder",
        created_by_id=auth_setup["operator_user"]["id"],
    )

    response = await async_client.patch(
        f"/api/v1/library/folders/{folder.id}/owner",
        json={"created_by_id": auth_setup["operator2_user"]["id"]},
        headers={"Authorization": f"Bearer {auth_setup['operator_token']}"},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.integration
async def test_admin_rejects_unknown_folder_owner(
    async_client: AsyncClient, auth_setup, library_folder_factory
):
    folder = await library_folder_factory(name="LegacyFolder")

    response = await async_client.patch(
        f"/api/v1/library/folders/{folder.id}/owner",
        json={"created_by_id": 999999},
        headers={"Authorization": f"Bearer {auth_setup['admin_token']}"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_admin_cannot_assign_owner_to_external_folder(
    async_client: AsyncClient, auth_setup, library_folder_factory
):
    folder = await library_folder_factory(
        name="ExternalMount",
        is_external=True,
        external_path="/mnt/models",
    )

    response = await async_client.patch(
        f"/api/v1/library/folders/{folder.id}/owner",
        json={"created_by_id": auth_setup["operator_user"]["id"]},
        headers={"Authorization": f"Bearer {auth_setup['admin_token']}"},
    )

    assert response.status_code == 400
