from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, ConfigDict

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    fullName: str = Field(..., min_length=1)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class UserDto(BaseModel):
    id: UUID
    email: str
    fullName: str
    role: str
    createdAt: datetime

    model_config = ConfigDict(from_attributes=True)

class AuthResponse(BaseModel):
    token: str
    tokenType: str = "Bearer"
    user: UserDto

class CreateWorkspaceRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    slug: Optional[str] = None

class WorkspaceDto(BaseModel):
    id: UUID
    name: str
    slug: str
    ownerId: UUID
    ownerName: str
    currentUserRole: Optional[str] = "MEMBER"
    memberCount: int = 1
    createdAt: datetime

    model_config = ConfigDict(from_attributes=True)

class AddMemberRequest(BaseModel):
    email: EmailStr
    role: str = "MEMBER"

class MemberDto(BaseModel):
    id: UUID
    userId: UUID
    email: str
    fullName: str
    role: str
    joinedAt: datetime

    model_config = ConfigDict(from_attributes=True)

class ActivityLogDto(BaseModel):
    id: UUID
    userFullName: str
    userEmail: str
    action: str
    details: Optional[str] = None
    createdAt: datetime

    model_config = ConfigDict(from_attributes=True)

class RecordTransferRequest(BaseModel):
    fileName: str
    fileSize: int
    checksum: Optional[str] = None
    status: str = "COMPLETED"

class TransferRecordDto(BaseModel):
    id: UUID
    senderId: Optional[UUID] = None
    senderFullName: str
    fileName: str
    fileSize: int
    checksum: Optional[str] = None
    status: str
    createdAt: datetime
    completedAt: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class HealthResponseDto(BaseModel):
    status: str
    service: str
    version: str
    database: str
    timestamp: datetime
