import React from 'react';
import { Layers, Database, Radio, ShieldCheck } from 'lucide-react';

export const ArchitecturePillars: React.FC = () => {
  const pillars = [
    {
      icon: <Layers size={30} color="#ffffff" />,
      colorClass: 'bg-bauhaus-blue',
      lineClass: 'line-bauhaus-blue',
      phase: 'Phase 5 & 6',
      title: 'Zero-RAM Chunk Engine',
      description:
        'Large files (50GB+) are sliced sequentially into 512KB streams. Active backpressure pauses generation when the socket buffer exceeds 1MB, writing directly to IndexedDB to keep browser memory completely flat.',
      tech: 'Streams API + IndexedDB Cache',
    },
    {
      icon: <Radio size={30} color="#050511" />,
      colorClass: 'bg-bauhaus-yellow',
      lineClass: 'line-bauhaus-yellow',
      phase: 'Phase 4 & 9',
      title: 'Direct WebRTC Speed',
      description:
        'Binary chunks travel directly peer-to-peer over encrypted DataChannels. Spring Boot coordinates STUN ICE negotiation and room discovery, never routing or storing bulk payloads.',
      tech: 'STUN-assisted WebRTC DataChannels',
    },
    {
      icon: <ShieldCheck size={30} color="#ffffff" />,
      colorClass: 'bg-bauhaus-red',
      lineClass: 'line-bauhaus-red',
      phase: 'Phase 7 & 8',
      title: 'End-to-End Encrypted',
      description:
        'Your data never touches a server. Every chunk is sealed client-side with 256-bit AES-GCM and unique IVs. Interrupted transfers automatically resume missing chunks using bitmask negotiation without restarting.',
      tech: 'Web Crypto API + Bitmask Recovery',
    },
    {
      icon: <Database size={30} color="#ffffff" />,
      colorClass: 'bg-accent-green',
      lineClass: 'line-accent-green',
      phase: 'Phase 1 & 3',
      title: 'Supabase Mesh Limits',
      description:
        'Workspace boundaries isolate teams, peer rosters, and transfer audit records. Flyway migrations enforce deterministic PostgreSQL schema state in Mumbai (ap-south-1). Send gigabytes with zero storage limits.',
      tech: 'PostgreSQL 16 + Flyway + Supabase',
    },
  ];

  return (
    <section className="architecture-pillars-section" aria-labelledby="pillars-title">
      <div className="pillars-header-row">
        <div>
          <div className="pillars-kicker">
            <span className="bauhaus-red-line" />
            <span className="kicker-text">CORE ENGINEERING STACK</span>
          </div>
          <h2 id="pillars-title" className="pillars-headline">
            Architectural Foundations
          </h2>
        </div>

        <p className="pillars-subtext">
          Production-grade distributed design built for enterprise throughput, zero data loss, and sub-second peer handshakes.
        </p>
      </div>

      <div className="pillars-grid">
        {pillars.map((p, idx) => (
          <div key={idx} className="pillar-tile group">
            {/* Bauhaus Circular Badge */}
            <div className={`pillar-badge-circle ${p.colorClass}`}>
              {p.icon}
            </div>

            <div className="pillar-phase-tag">{p.phase}</div>
            <h3 className="pillar-title-text">{p.title}</h3>
            <p className="pillar-desc-text">{p.description}</p>
            <div className="pillar-tech-tag">{p.tech}</div>

            {/* Expandable Bottom Line on Hover */}
            <div className={`pillar-expand-bar ${p.lineClass}`} />
          </div>
        ))}
      </div>
    </section>
  );
};
