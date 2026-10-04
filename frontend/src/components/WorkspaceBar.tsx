import React, { useState } from 'react';
import { Workspace, Member, createWorkspace, addWorkspaceMember } from '../services/workspaceService';
import { Users, Plus, UserPlus, Radio, FolderKanban } from 'lucide-react';

interface WorkspaceBarProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onSelectWorkspace: (ws: Workspace) => void;
  onWorkspacesChanged: () => void;
  members: Member[];
  onlinePeersCount?: number;
  signalingStatus: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
}

export const WorkspaceBar: React.FC<WorkspaceBarProps> = ({
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  onWorkspacesChanged,
  members,
  onlinePeersCount = 0,
  signalingStatus,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [wsName, setWsName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const created = await createWorkspace(wsName.trim());
      setWsName('');
      setShowCreateModal(false);
      onWorkspacesChanged();
      onSelectWorkspace(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace || !inviteEmail.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await addWorkspaceMember(activeWorkspace.id, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setShowInviteModal(false);
      onWorkspacesChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite member');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="workspace-bar glass-panel" style={{ padding: '0.75rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FolderKanban size={18} color="var(--cyan-glow)" />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Workspace:</span>
        </div>

        <select
          value={activeWorkspace?.id || ''}
          onChange={(e) => {
            const selected = workspaces.find((w) => w.id === e.target.value);
            if (selected) onSelectWorkspace(selected);
          }}
          className="cyber-select"
          style={{ minWidth: '220px' }}
        >
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name} ({ws.slug})
            </option>
          ))}
        </select>

        <button
          className="btn-ghost"
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
          onClick={() => setShowCreateModal(true)}
          title="Create New Workspace Boundary"
        >
          <Plus size={14} />
          <span>New Workspace</span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Signaling Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
          <Radio
            size={15}
            color={
              signalingStatus === 'CONNECTED'
                ? '#10b981'
                : signalingStatus === 'CONNECTING'
                ? '#f59e0b'
                : '#ef4444'
            }
          />
          <span style={{ color: 'var(--text-muted)' }}>
            Signaling: <strong style={{ color: signalingStatus === 'CONNECTED' ? '#10b981' : '#f59e0b' }}>{signalingStatus}</strong>
          </span>
        </div>

        {/* Members Count & Online Peers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div
            className="badge-tag"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              borderColor: signalingStatus === 'CONNECTED' ? 'var(--accent-green)' : 'rgba(255, 255, 255, 0.1)',
              background: signalingStatus === 'CONNECTED' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
            }}
            title="Real-time WebRTC Connected Peers in this Mesh"
          >
            <Users size={12} color={signalingStatus === 'CONNECTED' ? '#10b981' : 'var(--text-muted)'} />
            <span>
              {signalingStatus === 'CONNECTED'
                ? `${onlinePeersCount + 1} Online (You${onlinePeersCount > 0 ? ` + ${onlinePeersCount} ${onlinePeersCount === 1 ? 'Peer' : 'Peers'}` : ''})`
                : `${members.length} Members`}
            </span>
          </div>

          <button
            className="btn-ghost"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
            onClick={() => setShowInviteModal(true)}
            title="Invite Peer to Workspace"
          >
            <UserPlus size={14} />
            <span>Invite</span>
          </button>
        </div>
      </div>

      {/* Create Workspace Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#fff' }}>Create Workspace Boundary</h3>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Workspace Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Distributed AI Research"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  className="cyber-input"
                  style={{ width: '100%', marginTop: '0.3rem' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Boundary'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="modal-backdrop" onClick={() => setShowInviteModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#fff' }}>Invite Peer to {activeWorkspace?.name}</h3>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={handleInvite}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Peer Email</label>
                <input
                  type="email"
                  required
                  placeholder="peer@hyperx.io"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="cyber-input"
                  style={{ width: '100%', marginTop: '0.3rem' }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Workspace Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="cyber-select"
                  style={{ width: '100%', marginTop: '0.3rem' }}
                >
                  <option value="MEMBER">MEMBER (Stream & Receive)</option>
                  <option value="ADMIN">ADMIN (Invite & Manage)</option>
                  <option value="VIEWER">VIEWER (Read-only)</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowInviteModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Adding...' : 'Grant Access'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
