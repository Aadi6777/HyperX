import { getStoredToken } from './authService';
import { getRuntimeApiBase } from '../config/runtimeConfig';

export interface CrdtDocument {
  roomId: string;
  title: string;
  content: string;
  version: number;
  lastModifiedBy: string;
  lastModifiedPeerId?: string;
  updatedAt: string;
}

const getApiBase = () => getRuntimeApiBase();

export async function fetchCrdtDoc(roomId: string): Promise<CrdtDocument | null> {
  const token = getStoredToken();
  try {
    const res = await fetch(`${getApiBase()}/api/v1/crdt/${roomId}`, {
      headers: {
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[CRDT] Could not fetch remote doc, using local state:', err);
    return null;
  }
}

export async function saveCrdtDoc(
  roomId: string,
  payload: { content: string; title?: string; modifiedBy?: string; peerId?: string; version?: number }
): Promise<CrdtDocument | null> {
  const token = getStoredToken();
  try {
    const res = await fetch(`${getApiBase()}/api/v1/crdt/${roomId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[CRDT] Error syncing to server:', err);
    return null;
  }
}

