import React from 'react';
import { Zap, ShieldCheck, HardDrive, Cpu } from 'lucide-react';

export const HeroSection: React.FC = () => {
  return (
    <section className="hero-wrapper" aria-labelledby="hero-title">
      <div className="hero-pill">
        <Zap size={14} className="text-cyan" />
        <span>Enterprise Peer-to-Peer Protocol &bull; Phase 1 Active</span>
      </div>

      <h1 id="hero-title" className="hero-title">
        Next-Gen Distributed Streaming <br />
        <span className="hero-highlight">Near-Zero RAM Footprint</span>
      </h1>

      <p className="hero-subtitle">
        HyperX streams 50GB+ files directly between browsers via WebRTC DataChannels,
        persisting micro-chunks through IndexedDB with Spring Boot reactive signaling.
      </p>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="badge-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem' }}>
          <ShieldCheck size={16} /> AES-256-GCM Encryption
        </div>
        <div className="badge-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem' }}>
          <HardDrive size={16} /> IndexedDB Chunk Cache
        </div>
        <div className="badge-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem' }}>
          <Cpu size={16} /> Zero-RAM Backpressure Engine
        </div>
      </div>
    </section>
  );
};
