import React from 'react';
import { Layers, Shuffle, Database, Lock } from 'lucide-react';

export const ArchitecturePillars: React.FC = () => {
  const pillars = [
    {
      icon: <Layers size={22} className="text-cyan" />,
      title: 'Zero-RAM Pipeline',
      phase: 'Phase 5 & 6',
      description: 'Files are read as sequential streams with adaptive backpressure and dynamically sized chunks (256KB-2MB), preventing browser tab crashes even on 50GB+ payloads.',
    },
    {
      icon: <Shuffle size={22} className="text-purple" />,
      title: 'Decentralized DataPlane',
      phase: 'Phase 4',
      description: 'Direct browser-to-browser WebRTC DataChannels handle bulk binary traffic, bypassing costly central cloud relay storage and minimizing transfer latency.',
    },
    {
      icon: <Database size={22} className="text-emerald" />,
      title: 'Deterministic Migrations',
      phase: 'Phase 1 Active',
      description: 'PostgreSQL 16 state is version-controlled strictly via Flyway scripts (V1__init.sql), preserving migration traceability across enterprise teams.',
    },
    {
      icon: <Lock size={22} className="text-cyan" />,
      title: 'E2E Chunk Encryption',
      phase: 'Phase 8',
      description: 'Each slice is encrypted client-side using authenticated AES-256-GCM before socket transmission, with SHA-256 verification after destination reassembly.',
    },
  ];

  return (
    <section aria-labelledby="architecture-title" style={{ marginTop: '2rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 id="architecture-title" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
          Core Architectural Foundations
        </h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '650px', margin: '0 auto' }}>
          Production distributed system patterns designed for high throughput, memory safety, and enterprise collaboration.
        </p>
      </div>

      <div className="grid-columns">
        {pillars.map((pillar, idx) => (
          <div key={idx} className="glass-panel card-content">
            <div className="card-header">
              <div className="icon-box">{pillar.icon}</div>
              <span className="badge-tag">{pillar.phase}</span>
            </div>
            <h3 className="card-title">{pillar.title}</h3>
            <p className="card-desc">{pillar.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
};
