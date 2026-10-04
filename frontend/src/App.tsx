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
        name: 'HyperX Demo Cluster',
        slug: 'demo-cluster',
        ownerId: 'peer_local',
        ownerName: 'HyperX Demo',
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
    const peerName = currentUser?.fullName || 'Peer ' + Math.random().toString(36).substring(2, 6);
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

  return (
    <div>
      {/* Top Navbar */}
      <nav className="navbar" role="navigation" aria-label="Main Navigation">
        <div className="brand-container">
          <div className="brand-logo" aria-hidden="true">
            ⚡
          </div>
          <span className="brand-text">HyperX</span>
          <span className="badge-tag">Phases 1–10 Complete &bull; v2.0.0</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#e2e8f0' }}>
                <UserCircle size={18} color="var(--cyan-glow)" />
                <span>{currentUser.fullName}</span>
                <span className="badge-tag" style={{ fontSize: '0.7rem' }}>{currentUser.role}</span>
              </div>
              <button className="btn-ghost" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={handleLogout}>
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <button className="btn-primary" style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }} onClick={() => setShowAuthModal(true)}>
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
      <main className="app-container">
        <HeroSection />

        {/* Workspace Boundary Switcher (Phase 3) */}
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

        {/* Phase 5, 6, 7, 8: Zero-RAM Chunk Engine, Local IndexedDB Cache, Resumable Bitmask, AES-256-GCM */}
        <TransferCenter workspaceId={activeWorkspace?.id} />

        {/* Phase 9: Real-time Peer Collaboration & Phase 3 Audit Logs */}
        <CollaborationPanel
          workspace={activeWorkspace}
          currentUserEmail={currentUser?.email || 'guest@hyperx.io'}
          peers={peers}
          chatMessages={chatMessages}
          onSendChatMessage={handleSendChat}
        />

        {/* Phase 1: Real-time Diagnostics & Capability Probes */}
        <DiagnosticCard />

        {/* Architecture Pillars */}
        <ArchitecturePillars />

        {/* Full Phases Verification & Deployment Guide */}
        <section className="glass-panel card-content" style={{ marginTop: '2.5rem' }}>
          <div className="card-header">
            <div className="icon-box cyan">
              <Terminal size={22} />
            </div>
            <span className="badge-tag">Phase 10 &bull; Production Ready</span>
          </div>

          <h3 className="card-title">All 10 Phases Operational Architecture</h3>
          <p className="card-desc">
            The full HyperX enterprise stack is wired: Spring Boot 3.3 backend with PostgreSQL Flyway migrations, stateless JWT security, STUN/TURN WebRTC signaling, zero-RAM dynamic chunking with IndexedDB caching, AES-256-GCM encryption, resumable transfer bitmasks, and real-time peer collaboration.
          </p>

          <pre style={{
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            fontSize: '0.85rem',
            color: '#38bdf8'
          }}>
{`# 1. Run Complete Stack with Docker Compose (PostgreSQL + HyperX Backend)
docker compose up --build -d

# 2. Run React Frontend Locally
cd frontend && npm run dev

# 3. Execute Full Backend Test Suite
cd backend && ./mvnw test

# 4. Deploy Frontend to Vercel
vercel --prod`}
          </pre>
        </section>

        {/* Footer */}
        <footer className="footer">
          <p>
            HyperX &copy; {new Date().getFullYear()} &bull; Enterprise Peer-to-Peer Large File Streaming Platform &bull; Built with Spring Boot 3.3, WebRTC &amp; React.
          </p>
        </footer>
      </main>

      {/* Auth Modal (Phase 2) */}
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
