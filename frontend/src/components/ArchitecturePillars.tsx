import React from 'react';
import { ShieldCheck, Zap, Infinity } from 'lucide-react';

export const ArchitecturePillars: React.FC = () => {
  const pillars = [
    {
      icon: <ShieldCheck size={30} color="#ffffff" />,
      colorClass: 'pillar-blue',
      badgeBg: 'var(--bauhaus-blue)',
      lineColor: 'var(--bauhaus-blue)',
      title: 'End-to-End Encrypted',
      description:
        'Your data never touches a centralized server. Keys are generated client-side via Web Crypto (AES-256-GCM) with SHA-256 integrity verification.',
    },
    {
      icon: <Zap size={30} color="#050511" />,
      colorClass: 'pillar-yellow',
      badgeBg: 'var(--bauhaus-yellow)',
      lineColor: 'var(--bauhaus-yellow)',
      title: 'WebRTC Speed',
      description:
        'Direct browser-to-browser WebRTC DataChannels maximize raw network bandwidth with active backpressure control and zero middleman throttling.',
    },
    {
      icon: <Infinity size={30} color="#ffffff" />,
      colorClass: 'pillar-red',
      badgeBg: 'var(--bauhaus-red)',
      lineColor: 'var(--bauhaus-red)',
      title: 'No File Limits (Zero-RAM)',
      description:
        'Stream 50GB+ files slice-by-slice directly into IndexedDB local cache. Even massive video datasets transfer smoothly without browser tab crashes.',
    },
  ];

  return (
    <section aria-labelledby="architecture-title" style={{ marginTop: '2.5rem', marginBottom: '2.5rem' }}>
      <div className="grid-bauhaus-pillars">
        {pillars.map((p, idx) => (
          <div key={idx} className="bauhaus-pillar-card glass-panel group">
            <div
              className="pillar-circle-badge"
              style={{ backgroundColor: p.badgeBg }}
            >
              {p.icon}
            </div>
            <h3 className="pillar-title">{p.title}</h3>
            <p className="pillar-desc">{p.description}</p>
            <div
              className="pillar-accent-line"
              style={{ backgroundColor: p.lineColor }}
            />
          </div>
        ))}
      </div>
    </section>
  );
};
