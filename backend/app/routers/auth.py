import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import User, Workspace, Member
from app.schemas import RegisterRequest, LoginRequest, AuthResponse, UserDto
from app.security import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])

@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db)):
    clean_email = request.email.lower().strip()
    
    # Check if user already exists
    existing = await db.execute(select(User).where(User.email == clean_email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Email is already registered: {clean_email}"
        )
    
    user = User(
        id=uuid.uuid4(),
        email=clean_email,
        password_hash=hash_password(request.password),
        full_name=request.fullName.strip(),
        role="MEMBER"
    )
    db.add(user)
    await db.flush()

    # Auto-provision initial personal workspace
    email_name = clean_email.split("@")[0]
    base_slug = re.sub(r"[^a-z0-9]", "-", email_name.lower()).strip("-") or "personal"
    slug = f"{base_slug}-workspace"
    suffix = 1
    
    while True:
        existing_ws = await db.execute(select(Workspace).where(Workspace.slug == slug))
        if not existing_ws.scalar_one_or_none():
            break
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    workspace = Workspace(
        id=uuid.uuid4(),
        name=f"{user.full_name}'s Workspace",
        slug=slug,
        owner_id=user.id
    )
    db.add(workspace)
    await db.flush()

    member = Member(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        user_id=user.id,
        role="OWNER"
    )
    db.add(member)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.email)
    
    return AuthResponse(
        token=token,
        tokenType="Bearer",
        user=UserDto(
            id=user.id,
            email=user.email,
            fullName=user.full_name,
            role=user.role,
            createdAt=user.created_at
        )
    )

@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    clean_email = request.email.lower().strip()
    result = await db.execute(select(User).where(User.email == clean_email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"}
        )

    token = create_access_token(user.id, user.email)

    return AuthResponse(
        token=token,
        tokenType="Bearer",
        user=UserDto(
            id=user.id,
            email=user.email,
            fullName=user.full_name,
            role=user.role,
            createdAt=user.created_at
        )
    )

@router.get("/me", response_model=UserDto)
async def me(current_user: User = Depends(get_current_user)):
    return UserDto(
        id=current_user.id,
        email=current_user.email,
        fullName=current_user.full_name,
        role=current_user.role,
        createdAt=current_user.created_at
    )
