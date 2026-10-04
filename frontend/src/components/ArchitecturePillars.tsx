import React from 'react';
import { Layers, Database, Radio, ShieldCheck, ArrowUpRight } from 'lucide-react';

export const ArchitecturePillars: React.FC = () => {
  const pillars = [
    {
      icon: <Layers size={22} color="var(--hyper-cyan)" />,
      badgeColor: 'rgba(6, 182, 212, 0.15)',
      badgeBorder: 'rgba(6, 182, 212, 0.3)',
      phase: 'Phase 5 & 6',
      title: 'Zero-RAM Chunk Engine',
      description:
        'Large files (50GB+) are sliced sequentially into 512KB streams. Active backpressure pauses generation when the socket buffer exceeds 1MB, writing directly to IndexedDB to keep browser memory completely flat.',
      tech: 'Streams API + IndexedDB Cache',
    },
    {
      icon: <Radio size={22} color="var(--hyper-indigo)" />,
      badgeColor: 'rgba(99, 102, 241, 0.15)',
      badgeBorder: 'rgba(99, 102, 241, 0.3)',
      phase: 'Phase 4 & 9',
      title: 'Direct WebRTC DataPlane',
      description:
        'Binary chunks travel directly peer-to-peer over encrypted DataChannels. Spring Boot coordinates STUN/TURN ICE negotiation and room discovery, never routing or storing bulk payloads.',
      tech: 'STUN/TURN + WebRTC DataChannels',
    },
    {
      icon: <Database size={22} color="var(--hyper-emerald)" />,
      badgeColor: 'rgba(16, 185, 129, 0.15)',
      badgeBorder: 'rgba(16, 185, 129, 0.3)',
      phase: 'Phase 1 & 3',
      title: 'Multi-Tenant Supabase Mesh',
      description:
        'Workspace boundaries isolate teams, peer rosters, and transfer audit records. Flyway migrations enforce deterministic PostgreSQL schema state in Mumbai (ap-south-1).',
      tech: 'PostgreSQL 16 + Flyway + Supabase',
    },
    {
      icon: <ShieldCheck size={22} color="var(--hyper-violet)" />,
      badgeColor: 'rgba(139, 92, 246, 0.15)',
      badgeBorder: 'rgba(139, 92, 246, 0.3)',
      phase: 'Phase 7 & 8',
      title: 'E2E Cipher & Bitmask Recovery',
      description:
        'Every chunk is sealed client-side with 256-bit AES-GCM and unique IVs. Interrupted transfers automatically resume missing chunks using bitmask negotiation without restarting.',
      tech: 'Web Crypto API + Bitmask Protocol',
    },
  ];

  return (
    <section aria-labelledby="pillars-title" style={{ marginTop: '3rem', marginBottom: '3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <span style={{ height: '2px', width: '20px', background: 'var(--hyper-cyan)' }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--hyper-cyan)', textTransform: 'uppercase' }}>
              Core Engineering Stack
            </span>
          </div>
          <h2 id="pillars-title" style={{ fontSize: '1.85rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em', margin: 0 }}>
            Architectural Foundations
          </h2>
        </div>

        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '420px' }}>
          Production-grade distributed design built for enterprise throughput, zero data loss, and sub-second peer handshakes.
        </p>
      </div>

      <div className="hyper-pillars-grid">
        {pillars.map((p, idx) => (
          <div key={idx} className="hyper-pillar-card glass-panel group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div className="pillar-icon-box">
                {p.icon}
              </div>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  padding: '0.25rem 0.6rem',
                  borderRadius: '9999px',
                  background: p.badgeColor,
                  border: `1px solid ${p.badgeBorder}`,
                  color: '#ffffff',
                }}
              >
                {p.phase}
              </span>
            </div>

            <h3 className="pillar-heading">{p.title}</h3>
            <p className="pillar-body">{p.description}</p>

            <div className="pillar-footer">
              <span className="pillar-tech-label">{p.tech}</span>
              <ArrowUpRight size={14} className="pillar-arrow" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
