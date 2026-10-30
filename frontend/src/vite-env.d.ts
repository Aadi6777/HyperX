/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SIGNALING_URL?: string;
  readonly VITE_ICE_SERVERS?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  readonly VITE_BACKEND_PROXY_URL?: string;
  readonly VITE_WS_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
