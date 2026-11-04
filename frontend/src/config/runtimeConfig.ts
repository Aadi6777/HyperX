/**
 * Nexora Runtime Configuration
 *
 * Resolves API Base URL and WebSocket Signaling URL dynamically:
 * 1. Query/hash parameter override (?backend=https://... or #...&backend=https://...)
 * 2. localStorage override ('nexora_api_base_url')
 * 3. Vite build-time environment variable (VITE_API_BASE_URL / VITE_SIGNALING_URL)
 * 4. Localhost/LAN fallback
 */

const STORAGE_KEY_API = 'nexora_api_base_url';
const STORAGE_KEY_SIGNALING = 'nexora_signaling_url';

export function getRuntimeApiBase(): string {
  if (typeof window === 'undefined') {
    return (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  }

  // 1. Query parameter override: ?backend=https://... or ?api=...
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const paramBackend = urlParams.get('backend') || urlParams.get('api');
    if (paramBackend) {
      const cleaned = paramBackend.trim().replace(/\/+$/, '');
      localStorage.setItem(STORAGE_KEY_API, cleaned);
      return cleaned;
    }

    // Also check hash (e.g., #room=ABC&backend=https://...)
    if (window.location.hash.includes('backend=')) {
      const hashContent = window.location.hash.replace(/^#/, '');
      const hashParams = new URLSearchParams(hashContent.includes('?') ? hashContent.split('?')[1] : hashContent);
      const hashBackend = hashParams.get('backend');
      if (hashBackend) {
        const cleaned = hashBackend.trim().replace(/\/+$/, '');
        localStorage.setItem(STORAGE_KEY_API, cleaned);
        return cleaned;
      }
    }
  } catch {
    // Ignore URL parse issues
  }

  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || /^192\.168\./.test(host) || /^10\./.test(host);
  const isVercel = host.includes('vercel.app');

  // Unified full-stack deployment (e.g. on Render, Fly, or Docker):
  // When frontend is served directly by the backend, prioritize same-origin relative path.
  // This guarantees zero-configuration, zero CORS issues, and no stale tunnel overrides.
  if (!isLocal && !isVercel) {
    return '';
  }

  // 2. LocalStorage override (for Vercel or separate frontend/backend deployments)
  try {
    const stored = localStorage.getItem(STORAGE_KEY_API);
    if (stored && stored.trim()) {
      return stored.trim().replace(/\/+$/, '');
    }
  } catch {
    // Ignore storage issues
  }

  // 3. Vite Environment Variable
  const envBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  if (envBase) return envBase;

  // 4. Localhost or Local IP fallback
  if (isLocal) {
    return `http://${host}:8080`;
  }

  return '';
}

export function setRuntimeApiBase(url: string): void {
  if (typeof window === 'undefined') return;
  const cleaned = url.trim().replace(/\/+$/, '');
  if (cleaned) {
    localStorage.setItem(STORAGE_KEY_API, cleaned);
  } else {
    localStorage.removeItem(STORAGE_KEY_API);
  }
}

export function getRuntimeSignalingUrl(): string {
  if (typeof window === 'undefined') {
    return import.meta.env.VITE_SIGNALING_URL || '';
  }

  // 1. Explicit search param: ?signaling=wss://...
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const paramSignaling = urlParams.get('signaling');
    if (paramSignaling) {
      const cleaned = paramSignaling.trim().replace(/\/+$/, '');
      localStorage.setItem(STORAGE_KEY_SIGNALING, cleaned);
      return cleaned;
    }
  } catch {
    // Ignore URL parse issues
  }

  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || /^192\.168\./.test(host) || /^10\./.test(host);
  const isVercel = host.includes('vercel.app');

  // Unified full-stack deployment on Render:
  // Automatically points to the secure WebSocket server on the exact same host & port
  if (!isLocal && !isVercel) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws/signaling`;
  }

  // 2. LocalStorage override
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SIGNALING);
    if (stored && stored.trim()) {
      return stored.trim().replace(/\/+$/, '');
    }
  } catch {
    // Ignore storage issues
  }

  // 3. Explicit env var
  const envSignaling = import.meta.env.VITE_SIGNALING_URL;
  if (envSignaling) return envSignaling;

  // 4. Converted from Runtime API Base
  const apiBase = getRuntimeApiBase();
  if (apiBase) {
    return apiBase.replace(/^http/, 'ws') + '/ws/signaling';
  }

  // 5. Same host fallback
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/signaling`;
}

export function setRuntimeSignalingUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const cleaned = url.trim().replace(/\/+$/, '');
  if (cleaned) {
    localStorage.setItem(STORAGE_KEY_SIGNALING, cleaned);
  } else {
    localStorage.removeItem(STORAGE_KEY_SIGNALING);
  }
}

