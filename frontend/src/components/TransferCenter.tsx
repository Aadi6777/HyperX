import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  Lock,
  Unlock,
  Pause,
  Play,
  Download,
  HardDrive,
  Cpu,
  ShieldCheck,
  Radio,
  Copy,
  RefreshCw,
  X,
  Check,
} from 'lucide-react';
import { hasWebCrypto } from '../services/cryptoService';
import { purgeStaleTransfers } from '../services/indexedDbCache';
import { recordTransfer } from '../services/workspaceService';
import { WebRtcEngine, PeerInfo, LinkState, SignalingStatus } from '../services/webrtcEngine';
import { TransferManager, LocalTransfer } from '../services/transferManager';
import { parseRoomInput, buildInviteLink } from '../services/room';

export type { LocalTransfer } from '../services/transferManager';

interface TransferCenterProps {
  /** Only set when signed in: completed deliveries are written to that workspace's audit trail. */
  workspaceId?: string;
  engine: WebRtcEngine | null;
  roomId: string;
  peers: PeerInfo[];
  links: Record<string, LinkState>;
  signalingStatus: SignalingStatus;
  onJoinRoom: (roomId: string) => void;
  onNewRoom: () => void;
  onMountControls?: (controls: { triggerFileSelect: () => void; promptReceiveCode: () => void }) => void;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const statusLabel = (t: LocalTransfer): string => {
  const send = t.direction === 'SEND';
  switch (t.status) {
    case 'OFFERED':
      return 'INCOMING OFFER';
    case 'WAITING':
      return 'WAITING FOR A RECEIVER';
    case 'STREAMING':
      return send ? 'SENDING' : 'RECEIVING';
    case 'PAUSED':
      return 'PAUSED';
    case 'VERIFYING':
      return send ? 'SENT - AWAITING CONFIRMATION' : 'VERIFYING';
    case 'COMPLETED':
      return send ? 'DELIVERED' : 'RECEIVED';
    case 'ERROR':
      return 'FAILED';
  }
};

const linkColor = (state: LinkState | undefined) =>
  state === 'open' ? 'var(--accent-green)' : state === 'connecting' ? 'var(--bauhaus-yellow)' : 'rgba(255,255,255,0.25)';

export const TransferCenter: React.FC<TransferCenterProps> = ({
  workspaceId,
  engine,
  roomId,
  peers,
  links,
  signalingStatus,
  onJoinRoom,
  onNewRoom,
  onMountControls,
}) => {
  const secureCrypto = hasWebCrypto();
  const [transfers, setTransfers] = useState<LocalTransfer[]>([]);
  const [encryptEnabled, setEncryptEnabled] = useState(secureCrypto);
  const [passphrase, setPassphrase] = useState('HyperX-ZeroRAM-Secret-2026');
  const [autoAccept, setAutoAccept] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [receiveCodeInput, setReceiveCodeInput] = useState('');
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef<TransferManager | null>(null);
  // The manager outlives renders, so it reads live values through refs instead of stale closures.
  const passphraseRef = useRef(passphrase);
  const autoAcceptRef = useRef(autoAccept);
  const workspaceIdRef = useRef(workspaceId);
  passphraseRef.current = passphrase;
  autoAcceptRef.current = autoAccept;
  workspaceIdRef.current = workspaceId;

  // Expose trigger functions to parent (Hero SEND & RECEIVE buttons)
  useEffect(() => {
    if (onMountControls) {
      onMountControls({
        triggerFileSelect: () => fileInputRef.current?.click(),
        promptReceiveCode: () => setShowReceiveModal(true),
      });
    }
  }, [onMountControls]);

  // Drop orphaned chunks from old sessions once per page load.
  useEffect(() => {
    purgeStaleTransfers().catch(() => undefined);
  }, []);

  // One TransferManager per signaling engine (i.e. per room).
  useEffect(() => {
    if (!engine) return;
    const manager = new TransferManager(engine, {
      onChange: setTransfers,
      getPassphrase: () => passphraseRef.current,
      isAutoAccept: () => autoAcceptRef.current,
      onDelivered: (t) => {
        if (workspaceIdRef.current) {
          recordTransfer(workspaceIdRef.current, t.fileName, t.fileSize, t.checksum?.replace('…', ''));
        }
      },
    });
    managerRef.current = manager;
    return () => {
      manager.dispose();
      managerRef.current = null;
      setTransfers([]);
    };
  }, [engine]);

  const handleFiles = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0) return;
    // Copy first: a FileList is live and is emptied when we reset the <input> below.
    const files = Array.from(fileList);
    if (fileInputRef.current) fileInputRef.current.value = '';

    const manager = managerRef.current;
    if (!manager) {
      setUiError('Not connected yet - wait for the signaling status to show CONNECTED, then try again.');
      return;
    }
    try {
      setUiError(null);
      await manager.sendFiles(files, { encrypt: encryptEnabled && secureCrypto, passphrase });
    } catch (e) {
      setUiError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = async (fn: () => Promise<void> | void) => {
    try {
      setUiError(null);
      await fn();
    } catch (e) {
      setUiError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyInvite = async () => {
    const link = buildInviteLink(roomId);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this invite link:', link);
    }
  };

  const openLinks = Object.values(links).filter((s) => s === 'open').length;
  const connected = signalingStatus === 'CONNECTED';

  return (
    <section className="glass-panel" style={{ padding: '1.75rem', marginBottom: '2.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.45rem', color: '#fff', margin: '0 0 0.3rem 0', display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
            <HardDrive size={24} style={{ color: 'var(--bauhaus-blue)' }} />
            Zero-RAM P2P Streaming Engine
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Direct browser-to-browser WebRTC DataChannels with real backpressure, IndexedDB cache, and AES-256-GCM encryption.
          </p>
        </div>

        {/* E2E Encryption Toggle & Passphrase */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(0,0,0,0.3)', padding: '0.5rem 0.8rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={!secureCrypto}
            title={secureCrypto ? 'Toggle end-to-end encryption' : 'Encryption needs HTTPS or localhost (WebCrypto is unavailable on plain http://)'}
            onClick={() => setEncryptEnabled(!encryptEnabled)}
            style={{
              background: encryptEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${encryptEnabled ? 'var(--accent-green)' : 'rgba(255, 255, 255, 0.2)'}`,
              color: encryptEnabled ? 'var(--accent-green)' : 'var(--text-muted)',
              padding: '0.35rem 0.65rem',
              borderRadius: '4px',
              cursor: secureCrypto ? 'pointer' : 'not-allowed',
              opacity: secureCrypto ? 1 : 0.6,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            {encryptEnabled ? <Lock size={13} /> : <Unlock size={13} />}
            {encryptEnabled ? 'AES-256-GCM' : 'Unencrypted'}
          </button>

          {encryptEnabled && (
            <input
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Encryption Passphrase"
              title="Both sides must use the SAME passphrase"
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: '1px dashed rgba(255, 255, 255, 0.25)',
                color: 'var(--bauhaus-yellow)',
                fontSize: '0.75rem',
                outline: 'none',
                width: '180px',
                fontFamily: 'var(--font-mono)',
              }}
            />
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoAccept} onChange={(e) => setAutoAccept(e.target.checked)} />
            Auto-accept incoming
          </label>

          {openLinks > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
              <Radio size={12} />
              <span>{openLinks} P2P Channels</span>
            </div>
          )}
        </div>
      </div>

      {/* Room / peers bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.7rem 0.9rem', marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>ROOM</span>
        <code style={{ color: 'var(--bauhaus-yellow)', fontSize: '1rem', fontWeight: 800, letterSpacing: '0.08em' }}>{roomId}</code>
        <button type="button" className="btn-ghost" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }} onClick={copyInvite}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy invite link'}</span>
        </button>
        <button type="button" className="btn-ghost" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }} onClick={onNewRoom}>
          <RefreshCw size={13} />
          <span>New room</span>
        </button>

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {peers.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>
              {connected ? 'No one else is here yet - send them the invite link' : 'Not connected'}
            </span>
          ) : (
            peers.map((p) => (
              <span key={p.peerId} title={`P2P link: ${links[p.peerId] ?? 'none'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-mono)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: linkColor(links[p.peerId]) }} />
                {p.peerName}
              </span>
            ))
          )}
        </span>
      </div>

      {!connected && (
        <div style={{ background: 'rgba(255, 46, 0, 0.12)', border: '1px solid var(--bauhaus-red)', color: '#fff', borderRadius: '6px', padding: '0.6rem 0.9rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
          Signaling server {signalingStatus === 'CONNECTING' ? 'connecting…' : 'unreachable'}
          {engine?.lastError ? ` - ${engine.lastError}` : ''}. Peers can't find each other until it connects
          (retrying automatically). Deployed on Vercel? Set <code>VITE_API_BASE_URL</code> (or <code>VITE_SIGNALING_URL</code>) to your backend.
        </div>
      )}
      {!secureCrypto && (
        <div style={{ background: 'rgba(255, 200, 0, 0.1)', border: '1px solid var(--bauhaus-yellow)', color: '#fff', borderRadius: '6px', padding: '0.6rem 0.9rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
          Encryption is disabled: this page isn't served over HTTPS (or localhost), so the browser hides WebCrypto. Transfers still work, unencrypted.
        </div>
      )}
      {uiError && (
        <div style={{ background: 'rgba(255, 46, 0, 0.12)', border: '1px solid var(--bauhaus-red)', color: '#fff', borderRadius: '6px', padding: '0.6rem 0.9rem', fontSize: '0.8rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <span>{uiError}</span>
          <button type="button" onClick={() => setUiError(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }} aria-label="Dismiss message">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Drag & Drop Zero-RAM Zone */}
      <div
        className={`dropzone ${isDragging ? 'drag-active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: '2px dashed var(--bauhaus-blue)',
          borderRadius: '8px',
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          cursor: 'pointer',
          background: isDragging ? 'rgba(0, 71, 255, 0.12)' : 'rgba(0, 0, 0, 0.3)',
          transition: 'all 0.25s ease',
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: 'var(--bauhaus-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '4px 4px 0px rgba(255,255,255,0.15)' }}>
            <UploadCloud size={26} />
          </div>
        </div>
        <h4 style={{ margin: '0 0 0.35rem 0', color: '#fff', fontSize: '1.2rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
          Drop files to offer them peer-to-peer
        </h4>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Receivers accept the file, then it streams straight from your disk in 64KB chunks with backpressure - nothing is uploaded to a server.
        </p>
      </div>

      {/* Join-room modal (Hero "RECEIVE") */}
      {showReceiveModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 5, 17, 0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '2rem',
            maxWidth: '440px',
            width: '100%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
          }}>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#fff', margin: '0 0 0.5rem 0', textTransform: 'uppercase' }}>
              Join a sender&apos;s room
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Enter the room code (or paste the invite link) the sender gave you. Offered files will appear below; press Accept to start the direct transfer.
            </p>
            <input
              type="text"
              value={receiveCodeInput}
              onChange={(e) => setReceiveCodeInput(e.target.value)}
              placeholder="e.g. K7M2QX9P"
              autoFocus
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                color: '#fff',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.95rem',
                marginBottom: '1.25rem',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button type="button" className="btn-ghost" onClick={() => setShowReceiveModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-hyper-nav"
                style={{ background: 'var(--bauhaus-red)' }}
                onClick={() => {
                  const code = parseRoomInput(receiveCodeInput);
                  if (code) {
                    onJoinRoom(code);
                    setShowReceiveModal(false);
                    setReceiveCodeInput('');
                  }
                }}
              >
                Join room
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active & Completed Transfers List */}
      {transfers.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h4 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            <Cpu size={16} style={{ color: 'var(--bauhaus-blue)' }} />
            Active Transfer Streams ({transfers.length})
          </h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {transfers.map((t) => {
              const done = t.status === 'COMPLETED';
              const failed = t.status === 'ERROR';
              return (
                <div
                  key={t.fileId}
                  style={{
                    background: 'rgba(10, 10, 26, 0.75)',
                    border: `1px solid ${failed ? 'var(--bauhaus-red)' : 'var(--border-subtle)'}`,
                    borderRadius: '8px',
                    padding: '1.25rem',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, color: '#fff', fontSize: '1rem' }}>{t.fileName}</span>
                        <span className="badge-tag" style={{ fontSize: '0.7rem' }}>{formatBytes(t.fileSize)}</span>
                        <span
                          className="badge-tag"
                          style={{
                            fontSize: '0.7rem',
                            background: t.direction === 'SEND' ? 'rgba(0, 71, 255, 0.15)' : 'rgba(255, 46, 0, 0.15)',
                            borderColor: t.direction === 'SEND' ? 'var(--bauhaus-blue)' : 'var(--bauhaus-red)',
                            color: '#fff',
                          }}
                        >
                          {t.direction === 'SEND' ? 'OUTGOING (SEND)' : `INCOMING FROM ${t.senderName || 'PEER'}`}
                        </span>
                        <span className="badge-tag" style={{ fontSize: '0.7rem', color: done ? 'var(--accent-green)' : failed ? 'var(--bauhaus-red)' : '#fff' }}>
                          {statusLabel(t)}
                        </span>
                        {t.isEncrypted && (
                          <span className="badge-tag" style={{ fontSize: '0.7rem', color: 'var(--accent-green)', borderColor: 'rgba(16,185,129,0.3)' }}>
                            <ShieldCheck size={11} style={{ display: 'inline', marginRight: '3px' }} />
                            AES-256-GCM
                          </span>
                        )}
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          ID: <code>{t.fileId}</code>
                        </span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem', fontFamily: 'var(--font-mono)' }}>
                        {t.chunksCompleted} / {t.totalChunks} chunks ({Math.round(t.chunkSize / 1024)}KB slices) &bull;{' '}
                        <span style={{ color: 'var(--bauhaus-yellow)', fontWeight: 700 }}>{t.speedMBps} MB/s</span>
                        {t.checksum && (
                          <span>
                            {' '}&bull; SHA-256 (first 1MB): <code>{t.checksum}</code>
                            {t.checksumVerified && <span style={{ color: 'var(--accent-green)' }}> verified</span>}
                          </span>
                        )}
                      </div>
                      {t.deliveredTo.length > 0 && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--accent-green)', marginTop: '0.3rem' }}>
                          Delivered to: {t.deliveredTo.join(', ')}
                        </div>
                      )}
                      {t.note && (
                        <div style={{ fontSize: '0.78rem', color: failed ? 'var(--bauhaus-red)' : 'var(--bauhaus-yellow)', marginTop: '0.3rem' }}>
                          {t.note}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {t.direction === 'RECEIVE' && (t.status === 'OFFERED' || failed) && (
                        <button
                          type="button"
                          className="btn-hyper-nav"
                          style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', background: 'var(--accent-green)' }}
                          onClick={() => run(() => managerRef.current?.accept(t.fileId))}
                        >
                          {failed ? <RefreshCw size={14} /> : <Download size={14} />}
                          <span>{failed ? 'Retry' : 'Accept & receive'}</span>
                        </button>
                      )}

                      {(t.status === 'STREAMING' || t.status === 'PAUSED') && (
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                          onClick={() => managerRef.current?.togglePause(t.fileId)}
                          title={t.status === 'STREAMING' ? 'Pause transfer' : 'Resume transfer (only missing chunks are re-sent)'}
                        >
                          {t.status === 'STREAMING' ? <Pause size={13} /> : <Play size={13} />}
                          <span>{t.status === 'STREAMING' ? 'Pause' : 'Resume'}</span>
                        </button>
                      )}

                      {t.direction === 'RECEIVE' && done && (
                        <button
                          type="button"
                          className="btn-hyper-nav"
                          style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', background: 'var(--accent-green)' }}
                          onClick={() => run(() => managerRef.current?.save(t.fileId))}
                        >
                          <Download size={14} />
                          <span>Save file</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}
                        onClick={() => managerRef.current?.dismiss(t.fileId)}
                        title={
                          t.direction === 'SEND'
                            ? 'Withdraw this offer / stop sharing'
                            : done
                              ? 'Remove and free the cached data'
                              : 'Decline / cancel'
                        }
                        aria-label="Remove transfer"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div style={{ background: 'rgba(0, 0, 0, 0.5)', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${t.percentage}%`,
                        background: done ? 'var(--accent-green)' : 'linear-gradient(90deg, var(--bauhaus-blue), var(--bauhaus-yellow))',
                        transition: 'width 0.15s ease',
                      }}
                    />
                  </div>

                  {/* Chunk Heatmap Visualizer */}
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontFamily: 'var(--font-mono)' }}>
                      <span>Chunk Transmission Map ({t.totalChunks} chunks)</span>
                      <span style={{ color: done ? 'var(--accent-green)' : '#fff', fontWeight: 700 }}>
                        {done
                          ? t.direction === 'RECEIVE' ? '100% STORED IN INDEXEDDB' : '100% DELIVERED'
                          : `${t.percentage}% ${t.direction === 'SEND' ? 'SENT' : 'RECEIVED'}`}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8px, 1fr))', gap: '2px', maxHeight: '40px', overflowY: 'hidden' }}>
                      {t.heat.map((v, idx) => (
                        <div
                          key={idx}
                          style={{
                            height: '8px',
                            borderRadius: '1px',
                            background: v >= 1 ? 'var(--bauhaus-blue)' : v > 0 ? 'rgba(0, 71, 255, 0.5)' : 'rgba(255, 255, 255, 0.1)',
                            transition: 'background 0.2s',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
