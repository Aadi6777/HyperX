import React, { useState } from 'react';
import { loginUser, registerUser, AuthResponse } from '../services/authService';
import { X, Lock, Mail, User, ShieldCheck } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (auth: AuthResponse) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let res: AuthResponse;
      if (isRegister) {
        res = await registerUser(email, password, fullName);
      } else {
        res = await loginUser(email, password);
      }
      onSuccess(res);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = async (demoEmail: string, demoName: string) => {
    setLoading(true);
    setError(null);
    try {
      // Try login first, if fail then register
      try {
        const res = await loginUser(demoEmail, 'DemoPass2026!');
        onSuccess(res);
        onClose();
        return;
      } catch {
        // Register demo user
        const res = await registerUser(demoEmail, 'DemoPass2026!', demoName);
        onSuccess(res);
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className="icon-box cyan" style={{ width: '36px', height: '36px' }}>
              <ShieldCheck size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff' }}>
              {isRegister ? 'Create HyperX Account' : 'Peer Sign-In'}
            </h3>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="alert-error" style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {isRegister && (
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                Full Name
              </label>
              <div className="input-group">
                <User size={16} className="input-icon" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Alice Engineer"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="cyber-input"
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
              Work Email
            </label>
            <div className="input-group">
              <Mail size={16} className="input-icon" />
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="cyber-input"
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
              Password
            </label>
            <div className="input-group">
              <Lock size={16} className="input-icon" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="cyber-input"
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ marginTop: '0.5rem', width: '100%', justifyContent: 'center' }}
          >
            {loading ? 'Authenticating...' : isRegister ? 'Register & Generate Workspace' : 'Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {isRegister ? (
            <span>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setIsRegister(false); setError(null); }}
                style={{ background: 'none', border: 'none', color: 'var(--cyan-glow)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Sign In
              </button>
            </span>
          ) : (
            <span>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => { setIsRegister(true); setError(null); }}
                style={{ background: 'none', border: 'none', color: 'var(--cyan-glow)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Create Account
              </button>
            </span>
          )}
        </div>

        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', marginTop: '1.25rem', paddingTop: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.6rem' }}>
            Instant Testing Demo Peers:
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ flex: 1, fontSize: '0.75rem', justifyContent: 'center' }}
              onClick={() => handleQuickDemo('alice@hyperx.io', 'Alice Engineer')}
            >
              Demo Peer: Alice
            </button>
            <button
              type="button"
              className="btn-ghost"
              style={{ flex: 1, fontSize: '0.75rem', justifyContent: 'center' }}
              onClick={() => handleQuickDemo('bob@hyperx.io', 'Bob Architect')}
            >
              Demo Peer: Bob
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
