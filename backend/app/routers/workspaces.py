import re
import uuid
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import User, Workspace, Member, ActivityLog, TransferRecord
from app.schemas import (
    CreateWorkspaceRequest, WorkspaceDto, AddMemberRequest,
    MemberDto, ActivityLogDto, RecordTransferRequest, TransferRecordDto
)
from app.security import get_current_user

router = APIRouter(prefix="/api/v1/workspaces", tags=["Workspaces"])

async def ensure_membership(db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Member:
    stmt = (
        select(Member)
        .where(Member.workspace_id == workspace_id, Member.user_id == user_id)
        .options(selectinload(Member.workspace), selectinload(Member.user))
    )
    result = await db.execute(stmt)
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Not a member of this workspace"
        )
    return member

async def log_activity(db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID, action: str, details: str):
    log = ActivityLog(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        user_id=user_id,
        action=action,
        details=details
    )
    db.add(log)

@router.post("", response_model=WorkspaceDto, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    request: CreateWorkspaceRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    slug = request.slug
    if not slug or not slug.strip():
        slug = re.sub(r"[^a-z0-9]", "-", request.name.lower()).strip("-")
    slug = slug.lower().strip()

    # Check if slug exists, if so append random suffix
    existing = await db.execute(select(Workspace).where(Workspace.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    workspace = Workspace(
        id=uuid.uuid4(),
        name=request.name.strip(),
        slug=slug,
        owner_id=current_user.id
    )
    db.add(workspace)
    await db.flush()

    member = Member(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        user_id=current_user.id,
        role="OWNER"
    )
    db.add(member)
    
    await log_activity(db, workspace.id, current_user.id, "WORKSPACE_CREATED", f"Workspace created: {workspace.name}")
    await db.commit()
    await db.refresh(workspace)

    return WorkspaceDto(
        id=workspace.id,
        name=workspace.name,
        slug=workspace.slug,
        ownerId=current_user.id,
        ownerName=current_user.full_name,
        currentUserRole="OWNER",
        memberCount=1,
        createdAt=workspace.created_at
    )

@router.get("", response_model=List[WorkspaceDto])
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(Member)
        .where(Member.user_id == current_user.id)
        .options(
            selectinload(Member.workspace).selectinload(Workspace.owner)
        )
    )
    result = await db.execute(stmt)
    memberships = result.scalars().all()

    dtos = []
    for m in memberships:
        ws = m.workspace
        # Count members
        count_res = await db.execute(select(func.count(Member.id)).where(Member.workspace_id == ws.id))
        count = count_res.scalar_one() or 1

        dtos.append(WorkspaceDto(
            id=ws.id,
            name=ws.name,
            slug=ws.slug,
            ownerId=ws.owner_id,
            ownerName=ws.owner.full_name if ws.owner else "Owner",
            currentUserRole=m.role,
            memberCount=count,
            createdAt=ws.created_at
        ))
    return dtos

@router.get("/{slug}", response_model=WorkspaceDto)
async def get_workspace(
    slug: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    try:
        ws_id = uuid.UUID(slug)
        stmt = select(Workspace).where((Workspace.slug == slug) | (Workspace.id == ws_id))
    except ValueError:
        stmt = select(Workspace).where(Workspace.slug == slug)

    ws_res = await db.execute(stmt.options(selectinload(Workspace.owner)))
    ws = ws_res.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Workspace not found with slug or ID: {slug}")

    member = await ensure_membership(db, ws.id, current_user.id)
    count_res = await db.execute(select(func.count(Member.id)).where(Member.workspace_id == ws.id))
    count = count_res.scalar_one() or 1

    return WorkspaceDto(
        id=ws.id,
        name=ws.name,
        slug=ws.slug,
        ownerId=ws.owner_id,
        ownerName=ws.owner.full_name if ws.owner else "Owner",
        currentUserRole=member.role,
        memberCount=count,
        createdAt=ws.created_at
    )

@router.get("/{workspace_id}/members", response_model=List[MemberDto])
async def get_members(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await ensure_membership(db, workspace_id, current_user.id)

    stmt = (
        select(Member)
        .where(Member.workspace_id == workspace_id)
        .options(selectinload(Member.user))
    )
    result = await db.execute(stmt)
    members = result.scalars().all()

    return [
        MemberDto(
            id=m.id,
            userId=m.user_id,
            email=m.user.email if m.user else "",
            fullName=m.user.full_name if m.user else "",
            role=m.role,
            joinedAt=m.joined_at
        )
        for m in members
    ]

@router.post("/{workspace_id}/members", response_model=MemberDto, status_code=status.HTTP_201_CREATED)
async def add_member(
    workspace_id: uuid.UUID,
    request: AddMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    caller = await ensure_membership(db, workspace_id, current_user.id)
    if caller.role not in ["OWNER", "ADMIN"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Action requires OWNER or ADMIN role"
        )

    target_user_res = await db.execute(select(User).where(User.email == request.email.lower().strip()))
    target_user = target_user_res.scalar_one_or_none()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No registered user found with email: {request.email}"
        )

    existing_mem = await db.execute(
        select(Member).where(Member.workspace_id == workspace_id, Member.user_id == target_user.id)
    )
    if existing_mem.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of this workspace"
        )

    new_member = Member(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        user_id=target_user.id,
        role=request.role or "MEMBER"
    )
    db.add(new_member)
    await log_activity(db, workspace_id, current_user.id, "MEMBER_ADDED", f"Added {target_user.email} as {new_member.role}")
    await db.commit()
    await db.refresh(new_member)

    return MemberDto(
        id=new_member.id,
        userId=target_user.id,
        email=target_user.email,
        fullName=target_user.full_name,
        role=new_member.role,
        joinedAt=new_member.joined_at
    )

@router.get("/{workspace_id}/activities", response_model=List[ActivityLogDto])
async def get_activities(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await ensure_membership(db, workspace_id, current_user.id)

    stmt = (
        select(ActivityLog)
        .where(ActivityLog.workspace_id == workspace_id)
        .options(selectinload(ActivityLog.user))
        .order_by(desc(ActivityLog.created_at))
        .limit(50)
    )
    result = await db.execute(stmt)
    logs = result.scalars().all()

    return [
        ActivityLogDto(
            id=log.id,
            userFullName=log.user.full_name if log.user else "System",
            userEmail=log.user.email if log.user else "system@hyperx.local",
            action=log.action,
            details=log.details,
            createdAt=log.created_at
        )
        for log in logs
    ]

@router.post("/{workspace_id}/transfers", status_code=status.HTTP_201_CREATED)
async def record_transfer(
    workspace_id: uuid.UUID,
    request: RecordTransferRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await ensure_membership(db, workspace_id, current_user.id)

    record = TransferRecord(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        sender_id=current_user.id,
        file_name=request.fileName,
        file_size=request.fileSize,
        checksum=request.checksum,
        status=request.status,
        completed_at=datetime.now(timezone.utc)
    )
    db.add(record)
    await log_activity(
        db,
        workspace_id,
        current_user.id,
        "FILE_STREAMED",
        f"Streamed file {request.fileName} ({request.fileSize} bytes)"
    )
    await db.commit()
    return {"status": "RECORDED"}

@router.get("/{workspace_id}/transfers", response_model=List[TransferRecordDto])
async def get_transfers(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await ensure_membership(db, workspace_id, current_user.id)

    stmt = (
        select(TransferRecord)
        .where(TransferRecord.workspace_id == workspace_id)
        .options(selectinload(TransferRecord.sender))
        .order_by(desc(TransferRecord.created_at))
        .limit(50)
    )
    result = await db.execute(stmt)
    transfers = result.scalars().all()

    return [
        TransferRecordDto(
            id=tr.id,
            senderId=tr.sender_id,
            senderFullName=tr.sender.full_name if tr.sender else "Anonymous Peer",
            fileName=tr.file_name,
            fileSize=tr.file_size,
            checksum=tr.checksum,
            status=tr.status,
            createdAt=tr.created_at,
            completedAt=tr.completed_at
        )
        for tr in transfers
    ]
