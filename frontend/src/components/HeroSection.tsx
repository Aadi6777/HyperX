import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';

interface HeroSectionProps {
  onSelectSend?: () => void;
  onSelectReceive?: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onSelectSend, onSelectReceive }) => {
  return (
    <div className="bauhaus-hero-grid glass-panel" style={{ padding: 0, overflow: 'hidden', marginBottom: '2.5rem', border: '1px solid var(--border-subtle)' }}>
      {/* Left Column: Bold Typography & Tagline */}
      <div className="hero-left-pane">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ height: '4px', width: '48px', background: 'var(--bauhaus-red)' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
            P2P Encrypted Protocol
          </span>
        </div>

        <h1 className="bauhaus-title">
          SECURE.<br />
          <span className="bauhaus-title-blue">DIRECT.</span><br />
          FAST.
        </h1>

        <p className="bauhaus-subtitle">
          Direct peer-to-peer encrypted file transfer. No servers. Just geometry, streams, and code. Drag, drop, and stream 50GB+ with zero browser RAM spikes.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '2rem' }}>
          <div style={{ position: 'relative', display: 'flex', width: '12px', height: '12px' }}>
            <span className="pulse-ping" />
            <span className="pulse-dot" />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            WebRTC Ready // 256-bit AES-GCM // Supabase Live
          </span>
        </div>
      </div>

      {/* Right Column: Bauhaus Geometry & Big SEND/RECEIVE Action Blocks */}
      <div className="hero-right-pane">
        {/* Interactive Bauhaus Geometric Sculpture */}
        <div className="bauhaus-art-box">
          <div className="bauhaus-art-container">
            <div className="art-circle-blue" />
            <div className="art-triangle-red" />
            <div className="art-square-yellow" />
          </div>
          <div style={{ position: 'absolute', bottom: '1rem', right: '1.25rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>
            HYPERX // ENGINE_v2
          </div>
        </div>

        {/* Dual Split Action Blocks */}
        <div className="action-blocks-grid">
          <button
            type="button"
            className="action-btn send-btn"
            onClick={onSelectSend}
            id="hero-send-action"
          >
            <div className="action-btn-overlay" />
            <ArrowUp size={36} className="action-icon" />
            <div>
              <div className="action-btn-title">SEND</div>
              <div className="action-btn-sub">Drag &amp; Drop (Zero-RAM)</div>
            </div>
          </button>

          <button
            type="button"
            className="action-btn receive-btn"
            onClick={onSelectReceive}
            id="hero-receive-action"
          >
            <div className="action-btn-overlay" />
            <ArrowDown size={36} className="action-icon" />
            <div>
              <div className="action-btn-title">RECEIVE</div>
              <div className="action-btn-sub">Direct Channel Stream</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
