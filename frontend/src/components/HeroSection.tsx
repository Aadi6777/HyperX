import React from 'react';
import {
  ArrowUp,
  ArrowDown,
  Activity,
  Layers,
  Cpu,
  HardDrive,
  Shield
} from 'lucide-react';

interface HeroSectionProps {
  onSelectSend?: () => void;
  onSelectReceive?: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onSelectSend, onSelectReceive }) => {
  return (
    <section className="hyperlink-hero-deck" aria-label="HyperX System Overview">
      <div className="hyperlink-hero-grid">
        {/* Left Column: Mission Briefing, Typography & Telemetry */}
        <div className="hero-left-column">
          <div className="hero-eyebrow-wrap">
            <div className="bauhaus-red-line" />
            <span className="hero-eyebrow-text">P2P ENCRYPTED PROTOCOL // ZERO-RAM STREAMING</span>
          </div>

          <h1 className="hero-headline">
            STREAM.<br />
            <span className="headline-blue">DIRECT.</span><br />
            FAST.
          </h1>

          <p className="hero-lead-text">
            Enterprise peer-to-peer file streaming over WebRTC DataChannels. Files stream slice-by-slice directly into browser IndexedDB storage with adaptive backpressure control—eliminating cloud bandwidth costs and out-of-memory browser tab crashes.
          </p>

          <div className="hero-status-row">
            <div className="ping-beacon">
              <span className="beacon-ping" />
              <span className="beacon-dot" />
            </div>
            <span className="beacon-text">STUN-assisted Direct P2P // AES-256-GCM // Mumbai ap-south-1</span>
          </div>

          {/* Real-time Memory Model Comparison */}
          <div className="hero-telemetry-card">
            <div className="hud-bench-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={15} style={{ color: 'var(--bauhaus-blue)' }} />
                <span className="hud-bench-title">MEMORY MODEL COMPARISON</span>
              </div>
              <span className="hud-bench-badge">SLICED STREAM</span>
            </div>

            <div className="hud-bench-rows">
              <div className="bench-row traditional">
                <div className="bench-row-info">
                  <span className="bench-label">Monolithic In-Memory Buffer</span>
                  <span className="bench-val text-red">Heap Exhaustion / OOM on Multi-GB</span>
                </div>
                <div className="bench-bar-track">
                  <div className="bench-bar-fill bg-bauhaus-red" style={{ width: '88%' }} />
                </div>
              </div>

              <div className="bench-row hyperx">
                <div className="bench-row-info">
                  <span className="bench-label">HyperX Sliced Stream + Drain</span>
                  <span className="bench-val text-blue">Constant Chunk Memory &bull; Backpressure Regulated</span>
                </div>
                <div className="bench-bar-track">
                  <div className="bench-bar-fill bg-bauhaus-blue" style={{ width: '18%' }} />
                </div>
              </div>
            </div>

            {/* Micro Metrics Grid */}
            <div className="hud-micro-grid">
              <div className="hud-micro-cell">
                <Layers size={14} style={{ color: 'var(--bauhaus-blue)' }} />
                <span>Slice: <strong>512 KB</strong></span>
              </div>
              <div className="hud-micro-cell">
                <Cpu size={14} style={{ color: 'var(--bauhaus-yellow)' }} />
                <span>Limit: <strong>1.0 MB</strong></span>
              </div>
              <div className="hud-micro-cell">
                <HardDrive size={14} style={{ color: 'var(--accent-green)' }} />
                <span>Store: <strong>IndexedDB</strong></span>
              </div>
              <div className="hud-micro-cell">
                <Shield size={14} style={{ color: 'var(--bauhaus-red)' }} />
                <span>Seal: <strong>SHA-256</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Bauhaus Kinetic Sculpture & Huge Split Action Tiles */}
        <div className="hero-right-column">
          {/* Interactive Geometry Sculpture */}
          <div className="sculpture-stage group">
            <div className="sculpture-inner">
              <div className="kinetic-shape circle bg-bauhaus-blue" />
              <div className="kinetic-shape triangle bg-bauhaus-red" />
              <div className="kinetic-shape square bg-bauhaus-yellow" />
            </div>
          </div>

          {/* Huge Action Blocks: SEND (Blue) & RECEIVE (Red) */}
          <div className="hero-action-grid">
            <button
              type="button"
              onClick={onSelectSend}
              className="action-tile action-tile-send group"
              id="hero-action-send"
              aria-label="Send File Drag and Drop"
            >
              <div className="action-tile-overlay" />
              <ArrowUp size={46} className="action-tile-icon" />
              <div className="action-tile-text">
                <span className="action-title">SEND</span>
                <span className="action-sub">Drag &amp; Drop File</span>
              </div>
            </button>

            <button
              type="button"
              onClick={onSelectReceive}
              className="action-tile action-tile-receive group"
              id="hero-action-receive"
              aria-label="Receive File Enter Code"
            >
              <div className="action-tile-overlay" />
              <ArrowDown size={46} className="action-tile-icon" />
              <div className="action-tile-text">
                <span className="action-title">RECEIVE</span>
                <span className="action-sub">Enter Transfer Code</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
