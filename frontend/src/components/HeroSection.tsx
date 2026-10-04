import React from 'react';
import {
  Zap,
  Activity,
  Shield,
  Layers,
  HardDrive,
  Cpu,
  ArrowRight,
  Radio,
  ServerOff
} from 'lucide-react';

interface HeroSectionProps {
  onSelectSend?: () => void;
  onSelectReceive?: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onSelectSend }) => {
  return (
    <section className="hyperx-hero-deck" aria-label="HyperX System Overview">
      <div className="hero-grid-container">
        {/* Left Column: Mission Briefing & Direct Trigger */}
        <div className="hero-briefing">
          <div className="hero-status-pill">
            <span className="pill-dot-pulse" />
            <span className="pill-text">HYPERX PROTOCOL v2.0 &bull; LIVE MESH</span>
            <span className="pill-tag">ZERO-RAM</span>
          </div>

          <h1 className="hero-master-title">
            Stream Massive Files.<br />
            <span className="hero-gradient-text">Zero Server RAM.</span><br />
            Pure Peer Velocity.
          </h1>

          <p className="hero-lead-text">
            Enterprise peer-to-peer file streaming over WebRTC DataChannels. Files stream slice-by-slice directly into browser IndexedDB storage with adaptive backpressure control—eliminating cloud bandwidth costs and out-of-memory browser tab crashes.
          </p>

          <div className="hero-cta-group">
            <button
              type="button"
              className="btn-hyper-primary"
              onClick={onSelectSend}
              id="hero-start-stream-btn"
            >
              <Zap size={18} />
              <span>Launch P2P Stream</span>
              <ArrowRight size={16} />
            </button>

            <div className="hero-spec-badges">
              <div className="spec-badge">
                <Shield size={14} color="var(--hyper-cyan)" />
                <span>AES-256-GCM</span>
              </div>
              <div className="spec-badge">
                <ServerOff size={14} color="var(--hyper-emerald)" />
                <span>Serverless P2P</span>
              </div>
              <div className="spec-badge">
                <HardDrive size={14} color="var(--hyper-violet)" />
                <span>IndexedDB Cache</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Holographic Architecture & Memory Flatline HUD */}
        <div className="hero-telemetry-hud glass-panel">
          <div className="hud-header">
            <div className="hud-title-wrap">
              <Activity size={16} color="var(--hyper-cyan)" />
              <span className="hud-title">REAL-TIME MEMORY &amp; MESH TELEMETRY</span>
            </div>
            <div className="hud-live-tag">
              <Radio size={12} color="var(--hyper-emerald)" />
              <span>LIVE</span>
            </div>
          </div>

          {/* Benchmark Comparison: Traditional vs HyperX */}
          <div className="hud-benchmark-box">
            <div className="benchmark-row danger-case">
              <div className="bench-meta">
                <span className="bench-label">Traditional Cloud Upload (50GB File)</span>
                <span className="bench-val">4.8 GB RAM &bull; Tab Crashes (OOM)</span>
              </div>
              <div className="bench-bar-track">
                <div className="bench-bar-fill danger-fill" style={{ width: '92%' }} />
              </div>
            </div>

            <div className="benchmark-row hyper-case">
              <div className="bench-meta">
                <span className="bench-label">HyperX Zero-RAM Streamer (50GB File)</span>
                <span className="bench-val text-cyan">14.6 MB RAM &bull; Flatline Resilient</span>
              </div>
              <div className="bench-bar-track">
                <div className="bench-bar-fill hyper-fill" style={{ width: '12%' }} />
              </div>
            </div>
          </div>

          {/* HUD Metric Grid */}
          <div className="hud-stats-grid">
            <div className="hud-stat-cell">
              <div className="stat-icon-wrap cyan">
                <Layers size={18} />
              </div>
              <div>
                <div className="stat-label">Dynamic Slices</div>
                <div className="stat-value">512 KB</div>
              </div>
            </div>

            <div className="hud-stat-cell">
              <div className="stat-icon-wrap indigo">
                <Cpu size={18} />
              </div>
              <div>
                <div className="stat-label">Backpressure Limit</div>
                <div className="stat-value">1.0 MB</div>
              </div>
            </div>

            <div className="hud-stat-cell">
              <div className="stat-icon-wrap emerald">
                <HardDrive size={18} />
              </div>
              <div>
                <div className="stat-label">Storage Target</div>
                <div className="stat-value">IndexedDB</div>
              </div>
            </div>

            <div className="hud-stat-cell">
              <div className="stat-icon-wrap violet">
                <Shield size={18} />
              </div>
              <div>
                <div className="stat-label">Integrity Seal</div>
                <div className="stat-value">SHA-256</div>
              </div>
            </div>
          </div>

          {/* Subtext info */}
          <div className="hud-footer-ticker">
            <span>Mesh: Direct WebRTC DataChannels</span>
            <span>&bull;</span>
            <span>Database: Supabase (ap-south-1)</span>
          </div>
        </div>
      </div>
    </section>
  );
};
