import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  History,
  Activity,
  CheckCircle,
  Users,
  FileCode,
  Save,
  Check
} from 'lucide-react';
import {
  Workspace,
  ActivityLog,
  TransferRecord,
  fetchWorkspaceActivities,
  fetchWorkspaceTransfers
} from '../services/workspaceService';
import { ChatMessage, PeerInfo, WebRtcEngine } from '../services/webrtcEngine';
import { fetchCrdtDoc, saveCrdtDoc } from '../services/crdtService';

interface CollaborationPanelProps {
  workspace: Workspace | null;
  roomId?: string;
  engine?: WebRtcEngine | null;
  currentUserEmail?: string;
  peers: PeerInfo[];
  chatMessages: ChatMessage[];
  onSendChatMessage: (text: string) => void;
}

export const CollaborationPanel: React.FC<CollaborationPanelProps> = ({
  workspace,
  roomId = 'hyperx-global-mesh',
  engine,
  peers,
  chatMessages,
  onSendChatMessage,
}) => {
  const [activeTab, setActiveTab] = useState<'CRDT_PAD' | 'CHAT' | 'AUDIT' | 'TRANSFERS'>('CRDT_PAD');
  const [chatInput, setChatInput] = useState('');
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);

  // CRDT Scratchpad State
  const effectiveRoomId = workspace?.id || roomId;
  const [crdtContent, setCrdtContent] = useState<string>('');
  const [crdtTitle, setCrdtTitle] = useState<string>('Room Swarm Scratchpad');
  const [crdtLastModifier, setCrdtLastModifier] = useState<string>('System');
  const [isSaved, setIsSaved] = useState<boolean>(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load CRDT doc from backend
  useEffect(() => {
    fetchCrdtDoc(effectiveRoomId).then((doc) => {
      if (doc) {
        setCrdtContent(doc.content);
        setCrdtTitle(doc.title);
        setCrdtLastModifier(doc.lastModifiedBy);
      }
    });
  }, [effectiveRoomId]);

  // Listen for real-time CRDT updates from mesh peers
  useEffect(() => {
    if (!engine) return;

    engine.setCallbacks({
      onCrdtUpdate: (update) => {
        if (update.roomId === effectiveRoomId || update.roomId.toUpperCase() === effectiveRoomId.toUpperCase()) {
          setCrdtContent(update.content);
          if (update.title) setCrdtTitle(update.title);
          setCrdtLastModifier(update.senderName);
        }
      }
    });
  }, [engine, effectiveRoomId]);

  // Handle Scratchpad typing with real-time broadcast and debounced persistence
  const handleContentChange = (newVal: string) => {
    setCrdtContent(newVal);
    setIsSaved(false);

    // 1. Instant broadcast over WebSocket mesh to all peers in the room
    if (engine) {
      engine.sendCrdtUpdate(newVal, crdtTitle);
    }

    // 2. Debounced save to backend MongoDB service
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveCrdtDoc(effectiveRoomId, {
        content: newVal,
        title: crdtTitle,
        modifiedBy: engine?.peerName || 'Peer',
        peerId: engine?.peerId
      }).then(() => {
        setIsSaved(true);
      });
    }, 800);
  };

  useEffect(() => {
    if (!workspace) return;

    if (activeTab === 'AUDIT') {
      fetchWorkspaceActivities(workspace.id)
        .then(setActivities)
        .catch(() => {});
    } else if (activeTab === 'TRANSFERS') {
      fetchWorkspaceTransfers(workspace.id)
        .then(setTransfers)
        .catch(() => {});
    }
  }, [workspace, activeTab]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChatMessage(chatInput.trim());
    setChatInput('');
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '2rem' }}>
      {/* Tab Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className={`btn-ghost ${activeTab === 'CRDT_PAD' ? 'active-tab' : ''}`}
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.8rem',
              color: activeTab === 'CRDT_PAD' ? 'var(--cyan-glow)' : 'var(--text-muted)',
              borderBottom: activeTab === 'CRDT_PAD' ? '2px solid var(--cyan-glow)' : 'none',
              borderRadius: 0,
            }}
            onClick={() => setActiveTab('CRDT_PAD')}
          >
            <FileCode size={14} />
            <span>CRDT Scratchpad</span>
          </button>

          <button
            type="button"
            className={`btn-ghost ${activeTab === 'CHAT' ? 'active-tab' : ''}`}
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.8rem',
              color: activeTab === 'CHAT' ? 'var(--cyan-glow)' : 'var(--text-muted)',
              borderBottom: activeTab === 'CHAT' ? '2px solid var(--cyan-glow)' : 'none',
              borderRadius: 0,
            }}
            onClick={() => setActiveTab('CHAT')}
          >
            <MessageSquare size={14} />
            <span>Room Chat</span>
          </button>

          <button
            type="button"
            className={`btn-ghost ${activeTab === 'AUDIT' ? 'active-tab' : ''}`}
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.8rem',
              color: activeTab === 'AUDIT' ? 'var(--cyan-glow)' : 'var(--text-muted)',
              borderBottom: activeTab === 'AUDIT' ? '2px solid var(--cyan-glow)' : 'none',
              borderRadius: 0,
            }}
            onClick={() => setActiveTab('AUDIT')}
          >
            <Activity size={14} />
            <span>Audit Trail</span>
          </button>

          <button
            type="button"
            className={`btn-ghost ${activeTab === 'TRANSFERS' ? 'active-tab' : ''}`}
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.8rem',
              color: activeTab === 'TRANSFERS' ? 'var(--cyan-glow)' : 'var(--text-muted)',
              borderBottom: activeTab === 'TRANSFERS' ? '2px solid var(--cyan-glow)' : 'none',
              borderRadius: 0,
            }}
            onClick={() => setActiveTab('TRANSFERS')}
          >
            <History size={14} />
            <span>Transfer Logs</span>
          </button>
        </div>

        {/* Online Peers Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <Users size={13} color="#10b981" />
          <span>{peers.length} Live Peers Online</span>
        </div>
      </div>

      {/* Tab: Real-Time CRDT Scratchpad (Unique Innovation) */}
      {activeTab === 'CRDT_PAD' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Live CRDT Scratchpad &bull; Last edited by: <strong style={{ color: '#fff' }}>{crdtLastModifier}</strong>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: isSaved ? '#10b981' : 'var(--bauhaus-yellow)' }}>
              {isSaved ? <Check size={12} /> : <Save size={12} />}
              {isSaved ? 'Synced to MongoDB' : 'Syncing...'}
            </span>
          </div>

          <textarea
            value={crdtContent}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="Collaborative CRDT Scratchpad: Paste notes, code, file descriptions, or transfer links here. All peers in the room see updates in real time..."
            style={{
              width: '100%',
              height: '240px',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '0.85rem',
              color: '#f8fafc',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.84rem',
              lineHeight: '1.5',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
        </div>
      )}

      {/* Tab: Real-Time Chat */}
      {activeTab === 'CHAT' && (
        <div>
          <div
            style={{
              height: '240px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
              paddingRight: '0.5rem',
              marginBottom: '1rem',
            }}
          >
            {chatMessages.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4rem' }}>
                No messages yet. Send a real-time message to room peers!
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '8px',
                    padding: '0.6rem 0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--cyan-glow)' }}>
                      {msg.senderName}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#e2e8f0', wordBreak: 'break-word' }}>
                    {msg.text}
                  </div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Type message to room peers..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="cyber-input"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn-primary" style={{ padding: '0 1rem' }}>
              <Send size={15} />
            </button>
          </form>
        </div>
      )}

      {/* Tab: Activity Audit Trail */}
      {activeTab === 'AUDIT' && (
        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
          {activities.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '2rem' }}>
              No audit logs recorded for this workspace yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {activities.map((act) => (
                <div
                  key={act.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(255, 255, 255, 0.02)',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '6px',
                    borderLeft: '3px solid var(--cyan-glow)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>{act.action}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{act.details}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    <div>{act.userFullName}</div>
                    <div>{new Date(act.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Transfer History */}
      {activeTab === 'TRANSFERS' && (
        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
          {transfers.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '2rem' }}>
              No transfer records yet in this workspace.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {transfers.map((tr) => (
                <div
                  key={tr.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(255, 255, 255, 0.02)',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '6px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>{tr.fileName}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {formatBytes(tr.fileSize)} &bull; Sender: {tr.senderFullName || (tr as any).senderName || 'Peer'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="badge-tag" style={{ color: '#10b981', borderColor: 'rgba(16,185,129,0.3)', fontSize: '0.7rem' }}>
                      <CheckCircle size={10} style={{ display: 'inline', marginRight: '3px' }} />
                      {tr.status}
                    </span>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {new Date(tr.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
