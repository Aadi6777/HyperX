export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  database: string;
  timestamp: string;
}

export interface ClientProbeCapabilities {
  webRtcSupported: boolean;
  dataChannelSupported: boolean;
  indexedDbSupported: boolean;
  webCryptoSupported: boolean;
  streamSupported: boolean;
}

/**
 * Fetch health status from HyperX backend.
 * Falls back gracefully to diagnostics if backend is starting or offline.
 */
export async function fetchBackendHealth(): Promise<HealthResponse> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const endpoint = `${baseUrl}/api/v1/health`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      status: 'STANDALONE_MODE',
      service: 'HyperX Web Client',
      version: '1.0.0-client',
      database: `BACKEND_UNREACHABLE (${message})`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Inspect browser capabilities for HyperX Zero-RAM P2P engine.
 */
export function probeBrowserCapabilities(): ClientProbeCapabilities {
  const hasWindow = typeof window !== 'undefined';

  const webRtcSupported = hasWindow && ('RTCPeerConnection' in window);
  const dataChannelSupported = hasWindow && webRtcSupported && ('RTCDataChannel' in window);
  const indexedDbSupported = hasWindow && ('indexedDB' in window);
  const webCryptoSupported = hasWindow && ('crypto' in window) && ('subtle' in window.crypto);
  const streamSupported = hasWindow && ('ReadableStream' in window) && ('WritableStream' in window);

  return {
    webRtcSupported,
    dataChannelSupported,
    indexedDbSupported,
    webCryptoSupported,
    streamSupported,
  };
}
