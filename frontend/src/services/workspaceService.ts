import { getStoredToken } from './authService';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  ownerName: string;
  currentUserRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  memberCount: number;
  createdAt: string;
}

export interface Member {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  joinedAt: string;
}

export interface ActivityLog {
  id: string;
  userFullName: string;
  userEmail: string;
  action: string;
  details: string;
  createdAt: string;
}

export interface TransferRecord {
  id: string;
  senderId?: string;
  senderFullName: string;
  fileName: string;
  fileSize: number;
  checksum?: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

const getApiBase = () => import.meta.env.VITE_API_BASE_URL || '';

function authHeaders(): HeadersInit {
  const token = getStoredToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(`${getApiBase()}/api/v1/workspaces`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load workspaces');
  return res.json();
}

export async function createWorkspace(name: string, slug?: string): Promise<Workspace> {
  const res = await fetch(`${getApiBase()}/api/v1/workspaces`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, slug }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Failed to create workspace');
  }
  return res.json();
}

export async function fetchWorkspaceMembers(workspaceId: string): Promise<Member[]> {
  const res = await fetch(`${getApiBase()}/api/v1/workspaces/${workspaceId}/members`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load members');
  return res.json();
}

export async function addWorkspaceMember(workspaceId: string, email: string, role: string): Promise<Member> {
  const res = await fetch(`${getApiBase()}/api/v1/workspaces/${workspaceId}/members`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Failed to add member');
  }
  return res.json();
}

export async function fetchWorkspaceActivities(workspaceId: string): Promise<ActivityLog[]> {
  const res = await fetch(`${getApiBase()}/api/v1/workspaces/${workspaceId}/activities`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load activity logs');
  return res.json();
}

export async function fetchWorkspaceTransfers(workspaceId: string): Promise<TransferRecord[]> {
  const res = await fetch(`${getApiBase()}/api/v1/workspaces/${workspaceId}/transfers`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load transfer history');
  return res.json();
}

export async function recordTransfer(
  workspaceId: string,
  fileName: string,
  fileSize: number,
  checksum?: string
): Promise<void> {
  try {
    await fetch(`${getApiBase()}/api/v1/workspaces/${workspaceId}/transfers`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ fileName, fileSize, checksum, status: 'COMPLETED' }),
    });
  } catch (err) {
    console.warn('Could not record transfer on server:', err);
  }
}
