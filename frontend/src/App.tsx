import React, { useState, useEffect, useRef } from 'react';
import { HeroSection } from './components/HeroSection';
import { DiagnosticCard } from './components/DiagnosticCard';
import { ArchitecturePillars } from './components/ArchitecturePillars';
import { AuthModal } from './components/AuthModal';
import { WorkspaceBar } from './components/WorkspaceBar';
import { TransferCenter } from './components/TransferCenter';
import { CollaborationPanel } from './components/CollaborationPanel';
import { User, fetchCurrentUser, clearSession } from './services/authService';
import {
  Workspace,
  Member,
  fetchWorkspaces,
  fetchWorkspaceMembers
} from './services/workspaceService';
import {
  WebRtcEngine,
  PeerInfo,
  ChatMessage
} from './services/webrtcEngine';
import { UserCircle, LogIn, LogOut, Terminal } from 'lucide-react';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [signalingStatus, setSignalingStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'CONNECTING'>('DISCONNECTED');

  const webrtcEngineRef = useRef<WebRtcEngine | null>(null);
  const transferCenterRef = useRef<HTMLDivElement>(null);
  const transferControlsRef = useRef<{ triggerFileSelect: () => void; promptReceiveCode: () => void } | null>(null);

  // Initialize Auth on startup
  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (user) {
        setCurrentUser(user);
        loadWorkspaces();
      }
    });
  }, []);

  const loadWorkspaces = async () => {
    try {
      const list = await fetchWorkspaces();
      setWorkspaces(list);
      if (list.length > 0) {
        setActiveWorkspace(list[0]);
      }
    } catch {
      // Fallback workspace for offline/standalone mode
      const fallback: Workspace = {
        id: 'ws_local_demo',
        name: 'HyperX Primary Cluster',
        slug: 'primary-cluster',
        ownerId: 'peer_local',
        ownerName: 'HyperX Operator',
        currentUserRole: 'OWNER',
        memberCount: 2,
        createdAt: new Date().toISOString(),
      };
      setWorkspaces([fallback]);
      setActiveWorkspace(fallback);
    }
  };

  // When active workspace changes, load its members & connect WebRTC signaling
  useEffect(() => {
    if (!activeWorkspace) return;

    fetchWorkspaceMembers(activeWorkspace.id)
      .then(setMembers)
      .catch(() => {
        setMembers([
          {
            id: 'm1',
            userId: currentUser?.id || 'demo_u1',
            email: currentUser?.email || 'alice@hyperx.io',
            fullName: currentUser?.fullName || 'Alice Engineer',
            role: 'OWNER',
            joinedAt: new Date().toISOString(),
          },
          {
            id: 'm2',
            userId: 'demo_u2',
            email: 'bob@hyperx.io',
            fullName: 'Bob Architect',
            role: 'MEMBER',
            joinedAt: new Date().toISOString(),
          },
        ]);
      });

    // Initialize WebRTC Engine
    const peerName = currentUser?.fullName || 'Peer_' + Math.random().toString(36).substring(2, 6);
    const engine = new WebRtcEngine(peerName);
    webrtcEngineRef.current = engine;

    engine.setCallbacks({
      onPeersUpdated: (updatedPeers) => setPeers(updatedPeers),
      onChatMessage: (msg) => setChatMessages((prev) => [...prev, msg]),
      onConnectionStatus: (status) => setSignalingStatus(status),
    });

    engine.connect(activeWorkspace.id);

    return () => {
      engine.disconnect();
    };
  }, [activeWorkspace, currentUser]);

  const handleLogout = () => {
    clearSession();
    setCurrentUser(null);
    setWorkspaces([]);
    setActiveWorkspace(null);
    if (webrtcEngineRef.current) {
      webrtcEngineRef.current.disconnect();
    }
  };

  const handleSendChat = (text: string) => {
    if (webrtcEngineRef.current) {
      webrtcEngineRef.current.sendChat(text);
    }
  };

  const scrollToTransfer = () => {
    transferCenterRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleHeroSend = () => {
    scrollToTransfer();
    setTimeout(() => {
      transferControlsRef.current?.triggerFileSelect();
    }, 200);
  };

  const handleHeroReceive = () => {
    scrollToTransfer();
    setTimeout(() => {
      transferControlsRef.current?.promptReceiveCode();
    }, 200);
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Bauhaus Tri-Color Ribbon */}
      <div className="bauhaus-ribbon">
        <div className="ribbon-blue" />
        <div className="ribbon-red" />
        <div className="ribbon-yellow" />
      </div>

      {/* Top Navbar */}
      <nav className="navbar" role="navigation" aria-label="Main Navigation">
        <div className="brand-container">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className="brand-text">HYPERX</span>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>
              P2P PIPELINE
            </span>
          </div>
        </div>

        {/* Center Live Mesh Telemetry Pill */}
        <div className="nav-telemetry-badge hidden-mobile">
          <span className="pill-dot-pulse" />
          <span style={{ color: 'var(--text-secondary)' }}>
            STATUS: <strong style={{ color: signalingStatus === 'CONNECTED' ? 'var(--accent-green)' : 'var(--bauhaus-yellow)' }}>{signalingStatus}</strong>
          </span>
          <span className="telemetry-separator">|</span>
          <span style={{ color: 'var(--text-muted)' }}>REGION: <strong>ap-south-1</strong></span>
          <span className="telemetry-separator">|</span>
          <span style={{ color: 'var(--text-muted)' }}>CIPHER: <strong>AES-256</strong></span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#e2e8f0' }}>
                <UserCircle size={18} color="var(--bauhaus-blue)" />
                <span style={{ fontWeight: 600 }}>{currentUser.fullName}</span>
                <span className="badge-tag" style={{ fontSize: '0.65rem' }}>{currentUser.role}</span>
              </div>
              <button className="btn-ghost" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={handleLogout}>
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-hyper-nav"
              onClick={() => setShowAuthModal(true)}
            >
              <LogIn size={15} />
              <span>Peer Sign-In</span>
            </button>
          )}

          <a
            href="https://github.com/Aadi6777/HyperX"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
            style={{ textDecoration: 'none', padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
            id="nav-github-link"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
            <span>GitHub</span>
          </a>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="app-container" style={{ flex: 1 }}>
        {/* Bauhaus Split Hero with Kinetic Sculpture and Split Action Blocks */}
        <HeroSection onSelectSend={handleHeroSend} onSelectReceive={handleHeroReceive} />

        {/* Workspace Boundary Management */}
        {workspaces.length > 0 && (
          <WorkspaceBar
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            onSelectWorkspace={(ws) => setActiveWorkspace(ws)}
            onWorkspacesChanged={loadWorkspaces}
            members={members}
            signalingStatus={signalingStatus}
          />
        )}

        {/* Zero-RAM Transfer Studio */}
        <div ref={transferCenterRef}>
          <TransferCenter
            workspaceId={activeWorkspace?.id}
            webrtcEngine={webrtcEngineRef.current}
            onMountControls={(ctrls) => {
              transferControlsRef.current = ctrls;
            }}
          />
        </div>

        {/* Bespoke 4-Pillar Architectural Matrix with Bauhaus Badges */}
        <ArchitecturePillars />

        {/* Real-time Collaboration & Audit Trail */}
        <CollaborationPanel
          workspace={activeWorkspace}
          currentUserEmail={currentUser?.email || 'operator@hyperx.io'}
          peers={peers}
          chatMessages={chatMessages}
          onSendChatMessage={handleSendChat}
        />

        {/* Live Hardware Capability Diagnostics */}
        <DiagnosticCard />

        {/* Production Stack Guide */}
        <section className="glass-panel card-content" style={{ marginTop: '2.5rem' }}>
          <div className="card-header">
            <div className="icon-box cyan">
              <Terminal size={20} />
            </div>
            <span className="badge-tag">Production Verified &bull; Supabase</span>
          </div>

          <h3 className="card-title">HyperX Infrastructure Runtime</h3>
          <p className="card-desc">
            Direct WebRTC DataChannels handle bulk binary streams between peer browsers. The Spring Boot signaling server coordinates STUN/TURN ICE negotiation and persists audit state into your Supabase PostgreSQL cluster.
          </p>

          <pre style={{
            background: 'rgba(0, 0, 0, 0.45)',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            fontSize: '0.85rem',
            color: '#38bdf8',
            fontFamily: 'var(--font-mono)'
          }}>
{`# 1. Start Spring Boot Backend Connected to Supabase
./run-supabase.sh

# 2. Expose Port 8080 with Secure Cloudflare Tunnel
cloudflared tunnel --url http://localhost:8080

# 3. Connect Live Vercel Frontend
Set VITE_API_BASE_URL to your Tunnel URL -> Redeploy`}
          </pre>
        </section>
      </main>

      {/* Bauhaus Footer with Tri-Color Ribbon & Brand Footer */}
      <footer style={{ marginTop: 'auto', width: '100%' }}>
        <div className="bauhaus-ribbon">
          <div className="ribbon-blue" />
          <div className="ribbon-red" />
          <div className="ribbon-yellow" />
        </div>
        <div style={{ background: '#0a0a1a', borderTop: '1px solid var(--border-subtle)', padding: '1.75rem 2rem' }}>
          <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontWeight: 900, letterSpacing: '-0.02em', fontSize: '1.2rem', color: '#fff', textTransform: 'uppercase' }}>
                HYPERX
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>&bull; E2E Encrypted P2P Transfer &bull; Zero-RAM Browser Streaming</span>
            </div>

            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.4)', letterSpacing: '0.1em' }}>
                E2E ENCRYPTED P2P TRANSFER
              </div>
              <div style={{ fontSize: '0.68rem', color: 'rgba(255, 255, 255, 0.25)', marginTop: '0.2rem' }}>
                v1.01.000 &bull; Supabase PostgreSQL
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={(auth) => {
          setCurrentUser(auth.user);
          loadWorkspaces();
        }}
      />
    </div>
  );
};

export default App;
