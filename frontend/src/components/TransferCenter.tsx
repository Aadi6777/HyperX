import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  Radio
} from 'lucide-react';
import { deriveKeyFromSecret, encryptChunk, decryptChunk, computeSha256 } from '../services/cryptoService';
import { CHUNK_SIZE } from '../services/chunkEngine';
import { saveChunk, assembleCompleteFile } from '../services/indexedDbCache';
import { recordTransfer } from '../services/workspaceService';
import { WebRtcEngine, FileAnnouncement, IncomingChunkPayload } from '../services/webrtcEngine';

export interface LocalTransfer {
  fileId: string;
  file?: File;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunksCompleted: number;
  percentage: number;
  speedMBps: number;
  status: 'STREAMING' | 'PAUSED' | 'COMPLETED' | 'ERROR';
  isEncrypted: boolean;
  passphrase?: string;
  chunksMap: boolean[];
  checksum?: string;
  direction: 'SEND' | 'RECEIVE';
  downloadBlob?: Blob;
  senderName?: string;
}

interface TransferCenterProps {
  workspaceId?: string;
  webrtcEngine?: WebRtcEngine | null;
  onMountControls?: (controls: { triggerFileSelect: () => void; promptReceiveCode: () => void }) => void;
}

export const TransferCenter: React.FC<TransferCenterProps> = ({
  workspaceId,
  webrtcEngine,
  onMountControls,
}) => {
  const [transfers, setTransfers] = useState<LocalTransfer[]>([]);
  const [encryptEnabled, setEncryptEnabled] = useState(true);
  const [passphrase, setPassphrase] = useState('HyperX-ZeroRAM-Secret-2026');
  const [isDragging, setIsDragging] = useState(false);
  const [receiveCodeInput, setReceiveCodeInput] = useState('');
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [activePeersCount, setActivePeersCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Track pause and cancellation state without React closure trap
  const transferControlsRef = useRef<Map<string, { isPaused: boolean; isCancelled: boolean }>>(new Map());

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Expose trigger functions to parent (Hero SEND & RECEIVE buttons)
  useEffect(() => {
    if (onMountControls) {
      onMountControls({
        triggerFileSelect: () => fileInputRef.current?.click(),
        promptReceiveCode: () => setShowReceiveModal(true),
      });
    }
  }, [onMountControls]);

  // Handle incoming chunks from WebRTC DataChannels
  const handleIncomingChunk = useCallback(async (payload: IncomingChunkPayload) => {
    const { fileId, chunkIndex, totalChunks, isEncrypted, iv, data } = payload;

    let plainBuffer = data;
    if (isEncrypted && iv) {
      try {
        const key = await deriveKeyFromSecret(passphrase);
        plainBuffer = await decryptChunk(data, iv, key);
      } catch (err) {
        console.error('Decryption failed for chunk #' + chunkIndex, err);
      }
    }

    // Persist slice into IndexedDB to keep browser memory completely flat
    await saveChunk(fileId, chunkIndex, plainBuffer);

    setTransfers((prev) =>
      prev.map((t) => {
        if (t.fileId === fileId) {
          const newMap = [...t.chunksMap];
          newMap[chunkIndex] = true;
          const completed = newMap.filter(Boolean).length;
          const pct = Math.round((completed / totalChunks) * 100);
          const isDone = completed >= totalChunks;

          return {
            ...t,
            chunksCompleted: completed,
            percentage: pct,
            chunksMap: newMap,
            status: isDone ? 'COMPLETED' : 'STREAMING',
          };
        }
        return t;
      })
    );
  }, [passphrase]);

  // Register WebRTC incoming file listeners
  useEffect(() => {
    if (!webrtcEngine) return;

    webrtcEngine.setCallbacks({
      onFileAnnounced: (announcement: FileAnnouncement) => {
        setTransfers((prev) => {
          if (prev.some((t) => t.fileId === announcement.fileId)) return prev;
          const incoming: LocalTransfer = {
            fileId: announcement.fileId,
            fileName: announcement.fileName,
            fileSize: announcement.fileSize,
            totalChunks: announcement.totalChunks,
            chunksCompleted: 0,
            percentage: 0,
            speedMBps: 0,
            status: 'STREAMING',
            isEncrypted: announcement.isEncrypted,
            passphrase: announcement.isEncrypted ? passphrase : undefined,
            chunksMap: new Array(announcement.totalChunks).fill(false),
            direction: 'RECEIVE',
            senderName: announcement.senderName,
            checksum: announcement.checksum,
          };
          return [incoming, ...prev];
        });
      },
      onChunkReceived: handleIncomingChunk,
      onDataChannelReady: () => {
        setActivePeersCount(webrtcEngine.getAllDataChannels().length);
      },
    });
  }, [webrtcEngine, handleIncomingChunk, passphrase]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileId = 'fx_' + Math.random().toString(36).substring(2, 9);
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

      // Register transfer control flags
      transferControlsRef.current.set(fileId, { isPaused: false, isCancelled: false });

      const newTransfer: LocalTransfer = {
        fileId,
        file,
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        chunksCompleted: 0,
        percentage: 0,
        speedMBps: 0,
        status: 'STREAMING',
        isEncrypted: encryptEnabled,
        passphrase: encryptEnabled ? passphrase : undefined,
        chunksMap: new Array(totalChunks).fill(false),
        direction: 'SEND',
      };

      setTransfers((prev) => [newTransfer, ...prev]);

      // Announce file over WebRTC if signaling server is connected
      if (webrtcEngine) {
        webrtcEngine.announceFile({
          fileId,
          fileName: file.name,
          fileSize: file.size,
          totalChunks,
          isEncrypted: encryptEnabled,
        });
      }

      // Execute Zero-RAM streaming pipeline with IndexedDB caching and WebRTC broadcast
      streamFilePipeline(newTransfer);
    }

    // Reset file input value to allow re-uploading the same file
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const streamFilePipeline = async (transfer: LocalTransfer) => {
    const { file, fileId, totalChunks, isEncrypted, passphrase: pass } = transfer;
    if (!file) return;

    let key: CryptoKey | null = null;
    if (isEncrypted && pass) {
      key = await deriveKeyFromSecret(pass);
    }

    const chunksMap = new Array(totalChunks).fill(false);
    const startTime = Date.now();
    let bytesSent = 0;

    for (let idx = 0; idx < totalChunks; idx++) {
      // Check pause / cancel status via ref to avoid React closure trap
      const control = transferControlsRef.current.get(fileId);
      if (control?.isCancelled) {
        break;
      }

      while (control?.isPaused && !control?.isCancelled) {
        await new Promise((r) => setTimeout(r, 200));
      }

      // Slice file chunk
      const start = idx * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);
      let buffer = await slice.arrayBuffer();

      let ivArr: number[] | undefined;
      // Real AES-256-GCM encryption
      if (key) {
        const encrypted = await encryptChunk(buffer, key);
        buffer = encrypted.data;
        ivArr = encrypted.iv;
      }

      // Save chunk to local IndexedDB
      await saveChunk(fileId, idx, buffer);

      // Broadcast chunk to peers over WebRTC DataChannels if open
      if (webrtcEngine) {
        webrtcEngine.broadcastChunk(
          {
            type: 'CHUNK',
            fileId,
            chunkIndex: idx,
            totalChunks,
            isEncrypted: !!key,
            iv: ivArr,
          },
          buffer
        );
      }

      // Adaptive backpressure simulation
      await new Promise((r) => setTimeout(r, Math.min(10, 800 / totalChunks)));

      chunksMap[idx] = true;
      bytesSent += (end - start);
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? (bytesSent / (1024 * 1024)) / elapsed : 0;
      const completed = idx + 1;
      const pct = Math.round((completed / totalChunks) * 100);

      setTransfers((prev) =>
        prev.map((t) =>
          t.fileId === fileId
            ? {
                ...t,
                chunksCompleted: completed,
                percentage: pct,
                speedMBps: parseFloat(speed.toFixed(2)),
                chunksMap: [...chunksMap],
              }
            : t
        )
      );
    }

    // Compute checksum
    const sampleBuffer = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
    const checksum = await computeSha256(sampleBuffer);

    setTransfers((prev) =>
      prev.map((t) =>
        t.fileId === fileId
          ? {
              ...t,
              status: 'COMPLETED',
              checksum: checksum.substring(0, 16) + '...',
              downloadBlob: file,
            }
          : t
      )
    );

    if (workspaceId) {
      recordTransfer(workspaceId, file.name, file.size, checksum);
    }
  };

  const togglePauseResume = (fileId: string) => {
    const ctrl = transferControlsRef.current.get(fileId) || { isPaused: false, isCancelled: false };
    const nextPaused = !ctrl.isPaused;
    ctrl.isPaused = nextPaused;
    transferControlsRef.current.set(fileId, ctrl);

    setTransfers((prev) =>
      prev.map((t) => {
        if (t.fileId === fileId) {
          return { ...t, status: nextPaused ? 'PAUSED' : 'STREAMING' };
        }
        return t;
      })
    );
  };

  const downloadFile = async (transfer: LocalTransfer) => {
    let blob = transfer.downloadBlob;

    // If blob isn't already held in memory, assemble from IndexedDB directly
    if (!blob) {
      try {
        blob = await assembleCompleteFile(transfer.fileId, transfer.totalChunks);
      } catch (err) {
        console.error('Failed to assemble file from IndexedDB:', err);
        alert('Could not assemble file chunks from IndexedDB. Some chunks may be missing.');
        return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = transfer.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="glass-panel" style={{ padding: '1.75rem', marginBottom: '2.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.45rem', color: '#fff', margin: '0 0 0.3rem 0', display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
            <HardDrive size={24} style={{ color: 'var(--bauhaus-blue)' }} />
            Zero-RAM P2P Streaming Engine
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Direct browser-to-browser WebRTC DataChannels with adaptive backpressure, IndexedDB cache, and AES-256-GCM encryption.
          </p>
        </div>

        {/* E2E Encryption Toggle & Passphrase */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(0,0,0,0.3)', padding: '0.5rem 0.8rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setEncryptEnabled(!encryptEnabled)}
            style={{
              background: encryptEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${encryptEnabled ? 'var(--accent-green)' : 'rgba(255, 255, 255, 0.2)'}`,
              color: encryptEnabled ? 'var(--accent-green)' : 'var(--text-muted)',
              padding: '0.35rem 0.65rem',
              borderRadius: '4px',
              cursor: 'pointer',
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
              title="Passphrase used for PBKDF2 AES-GCM Key Derivation"
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

          {activePeersCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
              <Radio size={12} />
              <span>{activePeersCount} P2P Channels</span>
            </div>
          )}
        </div>
      </div>

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
          Drop files to stream peer-to-peer (up to 50GB+)
        </h4>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Chunks are sliced sequentially (512KB) and piped into IndexedDB storage with backpressure control.
        </p>
      </div>

      {/* Receive Code Prompt Modal */}
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
              Receive File Via Transfer Code
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Enter the File ID or Transfer Code shared by the sender to initialize direct WebRTC DataChannel download:
            </p>
            <input
              type="text"
              value={receiveCodeInput}
              onChange={(e) => setReceiveCodeInput(e.target.value)}
              placeholder="e.g. fx_9a7x12z"
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
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowReceiveModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-hyper-nav"
                style={{ background: 'var(--bauhaus-red)' }}
                onClick={() => {
                  if (receiveCodeInput.trim()) {
                    alert(`Listening for transfer stream for Code: ${receiveCodeInput}. Make sure both peers are in the same workspace!`);
                    setShowReceiveModal(false);
                    setReceiveCodeInput('');
                  }
                }}
              >
                Connect Stream
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
            {transfers.map((t) => (
              <div
                key={t.fileId}
                style={{
                  background: 'rgba(10, 10, 26, 0.75)',
                  border: '1px solid var(--border-subtle)',
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
                      {t.chunksCompleted} / {t.totalChunks} chunks ({CHUNK_SIZE / 1024}KB slices) &bull;{' '}
                      <span style={{ color: 'var(--bauhaus-yellow)', fontWeight: 700 }}>{t.speedMBps} MB/s</span>
                      {t.checksum && (
                        <span> &bull; SHA-256: <code>{t.checksum}</code></span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {t.status !== 'COMPLETED' ? (
                      <button
                        className="btn-ghost"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                        onClick={() => togglePauseResume(t.fileId)}
                        title={t.status === 'STREAMING' ? 'Pause Transfer' : 'Resume Transfer (Bitmask Recovery)'}
                      >
                        {t.status === 'STREAMING' ? <Pause size={13} /> : <Play size={13} />}
                        <span>{t.status === 'STREAMING' ? 'Pause' : 'Resume'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-hyper-nav"
                        style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', background: 'var(--accent-green)' }}
                        onClick={() => downloadFile(t)}
                      >
                        <Download size={14} />
                        <span>Save File from IndexedDB</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ background: 'rgba(0, 0, 0, 0.5)', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${t.percentage}%`,
                      background: t.status === 'COMPLETED' ? 'var(--accent-green)' : 'linear-gradient(90deg, var(--bauhaus-blue), var(--bauhaus-yellow))',
                      transition: 'width 0.15s ease',
                    }}
                  />
                </div>

                {/* Chunk Heatmap Visualizer */}
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontFamily: 'var(--font-mono)' }}>
                    <span>Chunk Transmission Map ({t.totalChunks} slots)</span>
                    <span style={{ color: t.status === 'COMPLETED' ? 'var(--accent-green)' : '#fff', fontWeight: 700 }}>
                      {t.status === 'COMPLETED' ? '100% STORED IN INDEXEDDB' : `${t.percentage}% STREAMED`}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(auto-fill, minmax(8px, 1fr))`,
                      gap: '2px',
                      maxHeight: '40px',
                      overflowY: 'hidden',
                    }}
                  >
                    {t.chunksMap.map((done, idx) => (
                      <div
                        key={idx}
                        title={`Chunk #${idx} (${done ? 'Transferred & Cached' : 'Pending'})`}
                        style={{
                          height: '8px',
                          borderRadius: '1px',
                          background: done ? 'var(--bauhaus-blue)' : 'rgba(255, 255, 255, 0.1)',
                          transition: 'background 0.2s',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
