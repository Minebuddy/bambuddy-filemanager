"""Tests for legacy library-folder ownership inference (#3201)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from backend.app.core.database import _migrate_library_folder_owners


@pytest.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with eng.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE library_folders ("
                "id INTEGER PRIMARY KEY, "
                "name VARCHAR(255) NOT NULL, "
                "parent_id INTEGER NULL, "
                "is_external BOOLEAN NOT NULL DEFAULT 0, "
                "created_by_id INTEGER NULL, "
                "ownership_reviewed BOOLEAN NOT NULL DEFAULT FALSE"
                ")"
            )
        )
        await conn.execute(
            text(
                "CREATE TABLE library_files ("
                "id INTEGER PRIMARY KEY, "
                "folder_id INTEGER NULL, "
                "created_by_id INTEGER NULL"
                ")"
            )
        )
    yield eng
    await eng.dispose()


async def _folder(conn, folder_id: int, *, parent_id=None, external=False, owner=None):
    await conn.execute(
        text(
            "INSERT INTO library_folders "
            "(id, name, parent_id, is_external, created_by_id) "
            "VALUES (:id, :name, :parent_id, :external, :owner)"
        ),
        {
            "id": folder_id,
            "name": f"folder-{folder_id}",
            "parent_id": parent_id,
            "external": external,
            "owner": owner,
        },
    )


async def _file(conn, file_id: int, folder_id: int, owner):
    await conn.execute(
        text("INSERT INTO library_files (id, folder_id, created_by_id) VALUES (:id, :folder_id, :owner)"),
        {"id": file_id, "folder_id": folder_id, "owner": owner},
    )


async def _owners(conn) -> dict[int, int | None]:
    rows = (await conn.execute(text("SELECT id, created_by_id FROM library_folders ORDER BY id"))).fetchall()
    return {int(folder_id): owner for folder_id, owner in rows}


@pytest.mark.asyncio
async def test_single_file_owner_backfills_folder(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1)
        await _file(conn, 1, 1, 42)
        assert await _migrate_library_folder_owners(conn) == 1

    async with engine.connect() as conn:
        assert await _owners(conn) == {1: 42}


@pytest.mark.asyncio
async def test_parent_inherits_unambiguous_descendant_file_owner(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1)
        await _folder(conn, 2, parent_id=1)
        await _file(conn, 1, 2, 42)
        assert await _migrate_library_folder_owners(conn) == 2

    async with engine.connect() as conn:
        assert await _owners(conn) == {1: 42, 2: 42}


@pytest.mark.asyncio
async def test_mixed_user_subtree_stays_unowned(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1)
        await _file(conn, 1, 1, 42)
        await _file(conn, 2, 1, 84)
        assert await _migrate_library_folder_owners(conn) == 0

    async with engine.connect() as conn:
        assert await _owners(conn) == {1: None}


@pytest.mark.asyncio
async def test_ownerless_file_makes_subtree_ambiguous(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1)
        await _file(conn, 1, 1, 42)
        await _file(conn, 2, 1, None)
        assert await _migrate_library_folder_owners(conn) == 0

    async with engine.connect() as conn:
        assert await _owners(conn) == {1: None}


@pytest.mark.asyncio
async def test_empty_legacy_folder_is_not_guessed(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1)
        assert await _migrate_library_folder_owners(conn) == 0

    async with engine.connect() as conn:
        assert await _owners(conn) == {1: None}


@pytest.mark.asyncio
async def test_external_folder_is_not_inferred(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1, external=True)
        await _file(conn, 1, 1, 42)
        assert await _migrate_library_folder_owners(conn) == 0

    async with engine.connect() as conn:
        assert await _owners(conn) == {1: None}


@pytest.mark.asyncio
async def test_existing_folder_owner_is_never_overwritten(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1, owner=99)
        await _file(conn, 1, 1, 42)
        assert await _migrate_library_folder_owners(conn) == 0

    async with engine.connect() as conn:
        assert await _owners(conn) == {1: 99}


@pytest.mark.asyncio
async def test_backfill_is_idempotent(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1)
        await _file(conn, 1, 1, 42)
        assert await _migrate_library_folder_owners(conn) == 1
        assert await _migrate_library_folder_owners(conn) == 0

    async with engine.connect() as conn:
        assert await _owners(conn) == {1: 42}


@pytest.mark.asyncio
async def test_explicit_unassigned_owner_survives_repeated_backfill(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1)
        await _file(conn, 1, 1, 42)
        await conn.execute(text("UPDATE library_folders SET ownership_reviewed = TRUE WHERE id = 1"))
        assert await _migrate_library_folder_owners(conn) == 0
        assert await _migrate_library_folder_owners(conn) == 0
        assert await _owners(conn) == {1: None}


@pytest.mark.asyncio
async def test_old_schema_adds_file_owner_before_folder_backfill():
    from backend.app.core.database import _migrate_library_ownership_schema

    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with eng.begin() as conn:
            await conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            await conn.execute(
                text(
                    "CREATE TABLE library_folders (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER, is_external BOOLEAN NOT NULL DEFAULT FALSE)"
                )
            )
            await conn.execute(text("CREATE TABLE library_files (id INTEGER PRIMARY KEY, folder_id INTEGER)"))
            await conn.execute(text("INSERT INTO library_folders (id, name) VALUES (1, 'legacy')"))
            await conn.execute(text("INSERT INTO library_files (id, folder_id) VALUES (1, 1)"))
            assert await _migrate_library_ownership_schema(conn) == 0
            assert (await conn.execute(text("SELECT created_by_id FROM library_files"))).scalar() is None
            assert await _owners(conn) == {1: None}
            await conn.execute(text("INSERT INTO users (id) VALUES (42)"))
            await conn.execute(text("UPDATE library_files SET created_by_id = 42"))
            assert await _migrate_library_ownership_schema(conn) == 1
            assert await _owners(conn) == {1: 42}
            assert await _migrate_library_ownership_schema(conn) == 0
    finally:
        await eng.dispose()


@pytest.mark.asyncio
async def test_backfill_handles_1200_level_tree_iteratively(engine):
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO library_folders (id, name, parent_id) VALUES (:id, :name, :parent)"),
            [{"id": i, "name": f"folder-{i}", "parent": i - 1 if i > 1 else None} for i in range(1, 1201)],
        )
        await _file(conn, 1, 1200, 42)
        assert await _migrate_library_folder_owners(conn) == 1200
        assert set((await _owners(conn)).values()) == {42}
        assert await _migrate_library_folder_owners(conn) == 0


@pytest.mark.asyncio
async def test_cycles_are_skipped_without_blocking_valid_subtrees(engine):
    async with engine.begin() as conn:
        await _folder(conn, 1, parent_id=2)
        await _folder(conn, 2, parent_id=1)
        await _folder(conn, 3, parent_id=2)
        await _folder(conn, 4)
        await _file(conn, 1, 3, 42)
        await _file(conn, 2, 4, 42)
        assert await _migrate_library_folder_owners(conn) == 2
        assert await _owners(conn) == {1: None, 2: None, 3: 42, 4: 42}
