import React, { useEffect, useState } from 'react';
import { Server, RefreshCw, CheckCircle2, XCircle, Activity, Globe } from 'lucide-react';
import { fetchBackendHealth, probeBrowserCapabilities, HealthResponse, ClientProbeCapabilities } from '../services/api';

export const DiagnosticCard: React.FC = () => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [capabilities, setCapabilities] = useState<ClientProbeCapabilities | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastChecked, setLastChecked] = useState<string>('');

  const runDiagnostics = async () => {
    setLoading(true);
    const [healthData, caps] = await Promise.all([
      fetchBackendHealth(),
      Promise.resolve(probeBrowserCapabilities()),
    ]);
    setHealth(healthData);
    setCapabilities(caps);
    setLastChecked(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const isConnected = health?.status === 'UP';

  return (
    <div className="grid-columns">
      {/* Backend Diagnostics Card */}
      <article className="glass-panel card-content" id="backend-health-card">
        <header className="card-header">
          <div className="icon-box cyan">
            <Server size={22} />
          </div>
          <span className={`status-indicator ${isConnected ? 'status-online' : 'status-degraded'}`}>
            <span className="pulse-dot" />
            {isConnected ? 'Backend: Connected' : 'Standalone Client'}
          </span>
        </header>

        <h2 className="card-title">Backend Control Plane</h2>
        <p className="card-desc">
          Spring Boot 3.3 signaling node providing authentication, workspace boundaries, and session telemetry.
        </p>

        <div style={{ margin: '1.25rem 0' }}>
          <div className="telemetry-row">
            <span className="telemetry-label">Status</span>
            <span className="telemetry-val" style={{ color: isConnected ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
              {health ? health.status : 'PROBING...'}
            </span>
          </div>

          <div className="telemetry-row">
            <span className="telemetry-label">Service</span>
            <span className="telemetry-val">{health?.service || 'hyperx-backend'}</span>
          </div>

          <div className="telemetry-row">
            <span className="telemetry-label">Version</span>
            <span className="telemetry-val">{health?.version || '1.0.0'}</span>
          </div>

          <div className="telemetry-row">
            <span className="telemetry-label">Database</span>
            <span className="telemetry-val" style={{ color: health?.database === 'CONNECTED' ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
              {health?.database || 'CHECKING...'}
            </span>
          </div>

          <div className="telemetry-row">
            <span className="telemetry-label">Last Polled</span>
            <span className="telemetry-val" style={{ color: 'var(--text-muted)' }}>
              {lastChecked || 'Initial probe'}
            </span>
          </div>
        </div>

        <button
          id="btn-refresh-health"
          className="btn-primary"
          onClick={runDiagnostics}
          disabled={loading}
          style={{ width: '100%' }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Probing Nodes...' : 'Refresh Diagnostics'}
        </button>
      </article>

      {/* Browser Streaming Capability Card */}
      <article className="glass-panel card-content" id="client-capabilities-card">
        <header className="card-header">
          <div className="icon-box purple">
            <Activity size={22} />
          </div>
          <span className="status-indicator status-online">
            <span className="pulse-dot" />
            Hardware Acceleration Ready
          </span>
        </header>

        <h2 className="card-title">Browser Engine Probes</h2>
        <p className="card-desc">
          Zero-RAM streaming prerequisites validated directly against the client runtime environment.
        </p>

        <div style={{ margin: '1.25rem 0' }}>
          <div className="telemetry-row">
            <span className="telemetry-label">WebRTC PeerConnection</span>
            <span className="telemetry-val" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: capabilities?.webRtcSupported ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
              {capabilities?.webRtcSupported ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {capabilities?.webRtcSupported ? 'Available' : 'Missing'}
            </span>
          </div>

          <div className="telemetry-row">
            <span className="telemetry-label">RTCDataChannel (Binary)</span>
            <span className="telemetry-val" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: capabilities?.dataChannelSupported ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
              {capabilities?.dataChannelSupported ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {capabilities?.dataChannelSupported ? 'Available' : 'Missing'}
            </span>
          </div>

          <div className="telemetry-row">
            <span className="telemetry-label">IndexedDB Storage Cache</span>
            <span className="telemetry-val" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: capabilities?.indexedDbSupported ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
              {capabilities?.indexedDbSupported ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {capabilities?.indexedDbSupported ? 'Available' : 'Missing'}
            </span>
          </div>

          <div className="telemetry-row">
            <span className="telemetry-label">Web Crypto API (Subtle)</span>
            <span className="telemetry-val" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: capabilities?.webCryptoSupported ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
              {capabilities?.webCryptoSupported ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {capabilities?.webCryptoSupported ? 'Hardware Ready' : 'Disabled'}
            </span>
          </div>

          <div className="telemetry-row">
            <span className="telemetry-label">Streams API (Backpressure)</span>
            <span className="telemetry-val" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: capabilities?.streamSupported ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
              {capabilities?.streamSupported ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {capabilities?.streamSupported ? 'Supported' : 'Missing'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div className="btn-ghost" style={{ width: '100%', cursor: 'default' }}>
            <Globe size={16} className="text-cyan" />
            <span>Vercel Edge Ready</span>
          </div>
        </div>
      </article>
    </div>
  );
};
