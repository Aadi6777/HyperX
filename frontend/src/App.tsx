import React from 'react';
import { HeroSection } from './components/HeroSection';
import { DiagnosticCard } from './components/DiagnosticCard';
import { ArchitecturePillars } from './components/ArchitecturePillars';
import { Terminal } from 'lucide-react';

export const App: React.FC = () => {
  return (
    <div>
      {/* Top Navbar */}
      <nav className="navbar" role="navigation" aria-label="Main Navigation">
        <div className="brand-container">
          <div className="brand-logo" aria-hidden="true">
            ⚡
          </div>
          <span className="brand-text">HyperX</span>
          <span className="badge-tag">Phase 1 &bull; v1.0.0</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <a
            href="https://github.com/Aadi6777/HyperX"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
            style={{ textDecoration: 'none' }}
            id="nav-github-link"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
        <DiagnosticCard />
        <ArchitecturePillars />

        {/* Phase 1 Verification Guide */}
        <section className="glass-panel card-content" style={{ marginTop: '2.5rem' }}>
          <div className="card-header">
            <div className="icon-box cyan">
              <Terminal size={22} />
            </div>
            <span className="badge-tag">Phase 1 Verification</span>
          </div>

          <h3 className="card-title">Local Run & Verification Instructions</h3>
          <p className="card-desc">
            Execute these commands to verify the zero-dependency pipeline locally or deploy the frontend to Vercel:
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
{`# 1. Start PostgreSQL with Docker
docker compose up -d postgres

# 2. Run Spring Boot Backend (Port 8080)
cd backend && ./mvnw spring-boot:run

# 3. Test Health Diagnostics
curl http://localhost:8080/api/v1/health

# 4. Deploy Frontend to Vercel
cd frontend && vercel --prod`}
          </pre>
        </section>

        {/* Footer */}
        <footer className="footer">
          <p>
            HyperX &copy; {new Date().getFullYear()} &bull; Enterprise Peer-to-Peer Large File Streaming Platform &bull; Built with Spring Boot 3.3, WebRTC &amp; React.
          </p>
        </footer>
      </main>
    </div>
  );
};

export default App;
