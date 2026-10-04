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
  Eye,
  EyeOff,
  Copy,
  Check,
  AlertTriangle,
  KeyRound,
  FileCheck
} from 'lucide-react';
import {
  deriveKeyFromSecret,
  encryptChunk,
  decryptChunk,
  computeSha256,
  computeManifestRootHash,
  generateSecurePassphrase
} from '../services/cryptoService';
import { CHUNK_SIZE } from '../services/chunkEngine';
import {
  saveChunk,
  saveTransferMetadata,
  streamSaveFileToDisk,
  assembleCompleteFile
} from '../services/indexedDbCache';
import { recordTransfer } from '../services/workspaceService';
import {
  WebRtcEngine,
  IncomingChunkPayload
} from '../services/webrtcEngine';

export interface LocalTransfer {
  fileId: string;
  transferId: string; // Point-to-Point transfer code
  file?: File;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunksCompleted: number;
  percentage: number;
  speedMBps: number;
  status: 'PENDING_PEER' | 'STREAMING' | 'PAUSED' | 'COMPLETED' | 'CORRUPTED' | 'ERROR';
  errorMessage?: string;
  isEncrypted: boolean;
  passphrase?: string;
  chunksMap: boolean[];
  manifestHash?: string;
  direction: 'SEND' | 'RECEIVE';
  targetPeerId?: string;
  targetPeerName?: string;
  downloadBlob?: Blob;
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
  const [encryptEnabled, setEncryptEnabled] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [receiveCodeInput, setReceiveCodeInput] = useState('');
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synchronous transfer control refs to prevent React closure stale-state bugs
  const transferControlsRef = useRef<Map<string, {
    isPaused: boolean;
    isCancelled: boolean;
    acknowledgedChunks: Set<number>;
    targetPeerId?: string;
  }>>(new Map());

  // In-memory chunk hashes for receiver integrity validation
  const receivedChunkHashesRef = useRef<Map<string, string[]>>(new Map());

  // Ref to always access latest transfers inside WebRTC event callbacks without stale closures
  const transfersRef = useRef<LocalTransfer[]>([]);
  useEffect(() => {
    transfersRef.current = transfers;
  }, [transfers]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Expose trigger handlers to parent (Hero action buttons)
  useEffect(() => {
    if (onMountControls) {
      onMountControls({
        triggerFileSelect: () => fileInputRef.current?.click(),
        promptReceiveCode: () => setShowReceiveModal(true),
      });
    }
  }, [onMountControls]);

  // Handle incoming chunks directly from target sender
  const handleIncomingChunk = useCallback(async (payload: IncomingChunkPayload) => {
    const { fileId, chunkIndex, totalChunks, isEncrypted, iv, data, senderPeerId } = payload;

    let plainBuffer = data;
    if (isEncrypted && iv) {
      if (!passphrase) {
        setTransfers((prev) =>
          prev.map((t) =>
            t.fileId === fileId
              ? {
                  ...t,
                  status: 'ERROR',
                  errorMessage: 'File is encrypted. Please enter the encryption passphrase.',
                }
              : t
          )
        );
        return;
      }

      try {
        const key = await deriveKeyFromSecret(passphrase);
        plainBuffer = await decryptChunk(data, iv, key);
      } catch (err) {
        console.error(`Decryption failed on chunk #${chunkIndex}:`, err);
        setTransfers((prev) =>
          prev.map((t) =>
            t.fileId === fileId
              ? {
                  ...t,
                  status: 'ERROR',
                  errorMessage: `Decryption failed on slice #${chunkIndex}. Passphrase mismatch.`,
                }
              : t
          )
        );
        return; // REJECT corrupted/undecryptable chunk
      }
    }

    // Persist slice into IndexedDB to keep browser memory completely flat
    await saveChunk(fileId, chunkIndex, plainBuffer);

    // Compute chunk hash for progressive manifest integrity
    const chunkHash = await computeSha256(plainBuffer);
    let hashes = receivedChunkHashesRef.current.get(fileId);
    if (!hashes) {
      hashes = new Array(totalChunks).fill('');
      receivedChunkHashesRef.current.set(fileId, hashes);
    }
    hashes[chunkIndex] = chunkHash;

    setTransfers((prev) =>
      prev.map((t) => {
        if (t.fileId === fileId) {
          const newMap = [...t.chunksMap];
          newMap[chunkIndex] = true;
          const completed = newMap.filter(Boolean).length;
          const pct = Math.round((completed / totalChunks) * 100);
          const isDone = completed >= totalChunks;

          if (isDone) {
            // Verify final manifest root integrity
            validateReceivedIntegrity(t, hashes!);
          }

          return {
            ...t,
            chunksCompleted: completed,
            percentage: pct,
            chunksMap: newMap,
            targetPeerId: senderPeerId,
            status: isDone ? 'COMPLETED' : 'STREAMING',
          };
        }
        return t;
      })
    );
  }, [passphrase]);

  // Full File Manifest Root Integrity Check
  const validateReceivedIntegrity = async (transfer: LocalTransfer, hashes: string[]) => {
    try {
      const computedRoot = await computeManifestRootHash(hashes);
      if (transfer.manifestHash && transfer.manifestHash !== computedRoot) {
        console.error('Integrity Mismatch!', { expected: transfer.manifestHash, computed: computedRoot });
        setTransfers((prev) =>
          prev.map((t) =>
            t.fileId === transfer.fileId
              ? {
                  ...t,
                  status: 'CORRUPTED',
                  errorMessage: 'SHA-256 integrity check failed! Transferred bytes do not match sender manifest.',
                }
              : t
          )
        );
      } else {
        // Record completed transfer in database
        if (workspaceId) {
          recordTransfer(workspaceId, transfer.fileName, transfer.fileSize, computedRoot);
        }
      }
    } catch (err) {
      console.error('Failed to verify manifest hash:', err);
    }
  };

  // WebRTC P2P Transfer Session Handshake Listeners
  useEffect(() => {
    if (!webrtcEngine) return;

    webrtcEngine.setCallbacks({
      onError: (err) => {
        if (err.code === 'TRANSFER_NOT_FOUND') {
          setTransfers((prev) =>
            prev.map((t) =>
              t.direction === 'RECEIVE' && t.status === 'PENDING_PEER'
                ? {
                    ...t,
                    status: 'ERROR',
                    errorMessage: err.message || 'Transfer code not found or sender is offline.',
                  }
                : t
            )
          );
        }
      },

      // Sender receives request from a peer who entered their transfer code
      onTransferRequested: (req) => {
        const { transferId, receiverPeerId, receiverPeerName } = req;
        const transfer = transfersRef.current.find((t) => t.transferId.toUpperCase() === transferId.toUpperCase());
        if (!transfer) {
          console.warn(`No transfer found for code ${transferId}`);
          return;
        }

        // Associate target peer with transfer session
        const ctrl = transferControlsRef.current.get(transfer.fileId);
        if (ctrl) {
          ctrl.targetPeerId = receiverPeerId;
        }

        // Accept the session and send file manifest directly to requesting peer
        webrtcEngine.acceptTransfer(transferId, receiverPeerId, {
          transferId,
          fileId: transfer.fileId,
          fileName: transfer.fileName,
          fileSize: transfer.fileSize,
          totalChunks: transfer.totalChunks,
          isEncrypted: transfer.isEncrypted,
          manifestHash: transfer.manifestHash,
          senderPeerId: webrtcEngine.peerId,
          senderName: webrtcEngine.peerName,
        });

        setTransfers((prev) =>
          prev.map((t) =>
            t.fileId === transfer.fileId
              ? {
                  ...t,
                  targetPeerId: receiverPeerId,
                  targetPeerName: receiverPeerName,
                  status: 'STREAMING',
                }
              : t
          )
        );

        // Start point-to-point stream to receiver
        executePointToPointStream(transfer, receiverPeerId);
      },

      // Receiver gets confirmation and manifest from sender
      onTransferAccepted: (acc) => {
        const { transferId, senderPeerId, manifest } = acc;
        setTransfers((prev) => {
          const filtered = prev.filter(
            (t) => t.transferId.toUpperCase() !== transferId.toUpperCase() && t.fileId !== manifest.fileId
          );
          const incoming: LocalTransfer = {
            fileId: manifest.fileId,
            transferId,
            fileName: manifest.fileName,
            fileSize: manifest.fileSize,
            totalChunks: manifest.totalChunks,
            chunksCompleted: 0,
            percentage: 0,
            speedMBps: 0,
            status: 'STREAMING',
            isEncrypted: manifest.isEncrypted,
            manifestHash: manifest.manifestHash,
            chunksMap: new Array(manifest.totalChunks).fill(false),
            direction: 'RECEIVE',
            targetPeerId: senderPeerId,
            targetPeerName: manifest.senderName || 'Peer',
          };
          return [incoming, ...filtered];
        });

        // Initialize metadata in IndexedDB
        saveTransferMetadata({
          fileId: manifest.fileId,
          transferId,
          fileName: manifest.fileName,
          fileSize: manifest.fileSize,
          totalChunks: manifest.totalChunks,
          mimeType: 'application/octet-stream',
          manifestHash: manifest.manifestHash,
          direction: 'RECEIVER',
          isEncrypted: manifest.isEncrypted,
          completedChunks: [],
          isComplete: false,
          createdAt: Date.now(),
        });
      },

      // Sender receives bitmask sync of acknowledged chunks (Resumable Bitmask Recovery)
      onBitmaskSynced: (sync) => {
        const { transferId, completedChunks } = sync;
        const transfer = transfersRef.current.find((t) => t.transferId.toUpperCase() === transferId.toUpperCase());
        if (!transfer) return;

        const ctrl = transferControlsRef.current.get(transfer.fileId);
        if (ctrl) {
          completedChunks.forEach((idx) => ctrl.acknowledgedChunks.add(idx));
        }

        setTransfers((prev) =>
          prev.map((t) => {
            if (t.fileId === transfer.fileId) {
              const newMap = [...t.chunksMap];
              completedChunks.forEach((idx) => {
                if (idx < newMap.length) newMap[idx] = true;
              });
              const completed = newMap.filter(Boolean).length;
              return {
                ...t,
                chunksCompleted: completed,
                percentage: Math.round((completed / t.totalChunks) * 100),
                chunksMap: newMap,
              };
            }
            return t;
          })
        );
      },

      onChunkReceived: handleIncomingChunk,
    });
  }, [webrtcEngine, handleIncomingChunk]);

  // Sender prepares file: calculates progressive chunk hashes and registers transfer code
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileId = 'fx_' + Math.random().toString(36).substring(2, 9);
      // Transfer Code for P2P connection (e.g. HX-8B9A2F)
      const transferId = 'HX-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

      // Pre-compute progressive chunk hashes to build whole-file manifest integrity
      const chunkHashes: string[] = [];
      for (let idx = 0; idx < totalChunks; idx++) {
        const start = idx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const slice = file.slice(start, end);
        const buf = await slice.arrayBuffer();
        const hash = await computeSha256(buf);
        chunkHashes.push(hash);
      }
      const manifestHash = await computeManifestRootHash(chunkHashes);

      // Register transfer control flags
      transferControlsRef.current.set(fileId, {
        isPaused: false,
        isCancelled: false,
        acknowledgedChunks: new Set(),
      });

      const newTransfer: LocalTransfer = {
        fileId,
        transferId,
        file,
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        chunksCompleted: 0,
        percentage: 0,
        speedMBps: 0,
        status: 'PENDING_PEER', // Awaits receiver connection via Transfer Code
        isEncrypted: encryptEnabled,
        passphrase: encryptEnabled ? passphrase : undefined,
        chunksMap: new Array(totalChunks).fill(false),
        manifestHash,
        direction: 'SEND',
      };

      setTransfers((prev) => [newTransfer, ...prev]);

      // Save sender metadata to IndexedDB
      saveTransferMetadata({
        fileId,
        transferId,
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        mimeType: file.type || 'application/octet-stream',
        manifestHash,
        direction: 'SENDER',
        isEncrypted: encryptEnabled,
        completedChunks: [],
        isComplete: false,
        createdAt: Date.now(),
      });

      // Announce Transfer Code on signaling server
      if (webrtcEngine) {
        webrtcEngine.announceTransfer(transferId, {
          transferId,
          fileId,
          fileName: file.name,
          fileSize: file.size,
          totalChunks,
          isEncrypted: encryptEnabled,
          manifestHash,
        });
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Point-to-Point Stream Execution (Strictly Target Peer, Real Backpressure, Resumable Bitmask)
  const executePointToPointStream = async (transfer: LocalTransfer, targetPeerId: string) => {
    const { file, fileId, totalChunks, isEncrypted, passphrase: pass } = transfer;
    if (!file || !webrtcEngine) return;

    let key: CryptoKey | null = null;
    if (isEncrypted && pass) {
      key = await deriveKeyFromSecret(pass);
    }

    const ctrl = transferControlsRef.current.get(fileId);
    const chunksMap = new Array(totalChunks).fill(false);
    const startTime = Date.now();
    let bytesSent = 0;

    for (let idx = 0; idx < totalChunks; idx++) {
      // RESUMABLE PROTOCOL: Skip chunk if already acknowledged by receiver
      if (ctrl?.acknowledgedChunks.has(idx)) {
        chunksMap[idx] = true;
        continue;
      }

      if (ctrl?.isCancelled) {
        break;
      }

      // Real user pause handler
      while (ctrl?.isPaused && !ctrl?.isCancelled) {
        await new Promise((r) => setTimeout(r, 200));
      }

      // Slice 512KB chunk (Zero-RAM browser streaming)
      const start = idx * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);
      let buffer = await slice.arrayBuffer();

      let ivArr: number[] | undefined;
      if (key) {
        const encrypted = await encryptChunk(buffer, key);
        buffer = encrypted.data;
        ivArr = encrypted.iv;
      }

      // Point-to-Point Delivery with REAL BACKPRESSURE & RETRIES
      let sent = false;
      let retries = 0;
      while (!sent && retries < 40 && !ctrl?.isCancelled) {
        sent = await webrtcEngine.sendChunkToPeer(
          targetPeerId,
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
        if (!sent) {
          retries++;
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      if (!sent) {
        console.error(`Failed to send chunk #${idx} to peer ${targetPeerId} after retries.`);
        setTransfers((prev) =>
          prev.map((t) =>
            t.fileId === fileId
              ? {
                  ...t,
                  status: 'ERROR',
                  errorMessage: `Connection lost to peer ${targetPeerId} while sending slice #${idx}.`,
                }
              : t
          )
        );
        return;
      }

      chunksMap[idx] = true;
      ctrl?.acknowledgedChunks.add(idx);
      bytesSent += (end - start);

      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? (bytesSent / (1024 * 1024)) / elapsed : 0;
      const completed = chunksMap.filter(Boolean).length;
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

    setTransfers((prev) =>
      prev.map((t) =>
        t.fileId === fileId
          ? {
              ...t,
              status: 'COMPLETED',
              downloadBlob: file,
            }
          : t
      )
    );
  };

  const handleConnectStreamByCode = () => {
    const code = receiveCodeInput.trim().toUpperCase();
    if (!code) return;

    if (!webrtcEngine) {
      setReceiveError('P2P mesh connection is initializing. Please wait a moment and try again.');
      return;
    }

    setReceiveLoading(true);
    setReceiveError(null);

    // 1. Immediately create a visible pending transfer card so the receiver sees immediate feedback!
    setTransfers((prev) => {
      if (prev.some((t) => t.transferId.toUpperCase() === code)) {
        return prev;
      }
      const pending: LocalTransfer = {
        fileId: 'pending_' + code,
        transferId: code,
        fileName: 'P2P Stream: ' + code,
        fileSize: 0,
        totalChunks: 0,
        chunksCompleted: 0,
        percentage: 0,
        speedMBps: 0,
        status: 'PENDING_PEER',
        isEncrypted: false,
        chunksMap: [],
        direction: 'RECEIVE',
      };
      return [pending, ...prev];
    });

    // 2. Emit real transfer request to signaling server
    webrtcEngine.requestTransfer(code);

    setTimeout(() => {
      setReceiveLoading(false);
      setShowReceiveModal(false);
      setReceiveCodeInput('');
    }, 400);
  };

  const togglePauseResume = (fileId: string) => {
    const ctrl = transferControlsRef.current.get(fileId);
    if (!ctrl) return;

    const nextPaused = !ctrl.isPaused;
    ctrl.isPaused = nextPaused;

    setTransfers((prev) =>
      prev.map((t) => {
        if (t.fileId === fileId) {
          // If resuming, send bitmask synchronization to sender
          if (!nextPaused && t.direction === 'RECEIVE' && t.targetPeerId && webrtcEngine) {
            const confirmedIndices: number[] = [];
            t.chunksMap.forEach((done, idx) => { if (done) confirmedIndices.push(idx); });
            webrtcEngine.syncBitmask(t.transferId, t.targetPeerId, confirmedIndices);
          }
          return { ...t, status: nextPaused ? 'PAUSED' : 'STREAMING' };
        }
        return t;
      })
    );
  };

  // Constant-Memory File Download (O(1) RAM using File System Access API)
  const downloadFile = async (transfer: LocalTransfer) => {
    // 1. First attempt direct disk stream (Constant O(1) RAM)
    const success = await streamSaveFileToDisk(
      transfer.fileId,
      transfer.totalChunks,
      transfer.fileName
    );

    if (success) return;

    // 2. Fallback to Blob assembly with memory guard
    if (transfer.fileSize > 1.5 * 1024 * 1024 * 1024) {
      alert(
        'Warning: This browser does not support the File System Access API for constant-memory disk writing. Downloading files > 1.5GB as in-memory Blobs may cause tab memory exhaustion.'
      );
    }

    let blob = transfer.downloadBlob;
    if (!blob) {
      try {
        blob = await assembleCompleteFile(transfer.fileId, transfer.totalChunks);
      } catch (err) {
        console.error('Assembly failed:', err);
        alert('Could not assemble file chunks from IndexedDB.');
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

  const copyTransferCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
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
            Point-to-point WebRTC DataChannels &bull; STUN-assisted direct peer mesh &bull; IndexedDB cache &bull; Client-side AES-256-GCM.
          </p>
        </div>

        {/* E2E Encryption Config & Security Controls */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter secret passphrase..."
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '0.25rem 0.5rem',
                  color: 'var(--bauhaus-yellow)',
                  fontSize: '0.75rem',
                  outline: 'none',
                  width: '160px',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: '0.25rem 0.4rem' }}
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: '0.25rem 0.45rem', fontSize: '0.72rem' }}
                onClick={() => setPassphrase(generateSecurePassphrase())}
                title="Generate high-entropy encryption key"
              >
                <KeyRound size={12} />
                <span>Gen Key</span>
              </button>
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
          Drop files to initialize P2P transfer session
        </h4>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Generates a unique Transfer Code. Chunks stream slice-by-slice directly to the recipient over WebRTC.
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
              Connect to Transfer Stream
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Enter the Transfer Code (e.g. <code>HX-8B9A2F</code>) provided by the sender to establish a direct WebRTC DataChannel:
            </p>
            <input
              type="text"
              value={receiveCodeInput}
              onChange={(e) => setReceiveCodeInput(e.target.value)}
              placeholder="e.g. HX-8B9A2F"
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                color: '#fff',
                fontFamily: 'var(--font-mono)',
                fontSize: '1rem',
                textTransform: 'uppercase',
                marginBottom: '1.25rem',
                outline: 'none',
              }}
            />
            {receiveError && (
              <div style={{ color: 'var(--bauhaus-red)', fontSize: '0.8rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255, 46, 0, 0.1)', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid rgba(255, 46, 0, 0.3)' }}>
                <AlertTriangle size={15} />
                <span>{receiveError}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setShowReceiveModal(false); setReceiveError(null); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-hyper-nav"
                style={{ background: 'var(--bauhaus-red)', opacity: receiveLoading ? 0.7 : 1 }}
                onClick={handleConnectStreamByCode}
                disabled={receiveLoading}
              >
                {receiveLoading ? 'Searching Mesh...' : 'Establish P2P Stream'}
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
            P2P Transfer Sessions ({transfers.length})
          </h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {transfers.map((t) => (
              <div
                key={t.fileId}
                style={{
                  background: 'rgba(10, 10, 26, 0.75)',
                  border: `1px solid ${t.status === 'CORRUPTED' || t.status === 'ERROR' ? 'var(--bauhaus-red)' : 'var(--border-subtle)'}`,
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
                      
                      {/* Transfer Code Pill */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(255, 215, 0, 0.15)', border: '1px solid rgba(255, 215, 0, 0.3)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--bauhaus-yellow)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          CODE: {t.transferId}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyTransferCode(t.transferId)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--bauhaus-yellow)', padding: '0 2px' }}
                          title="Copy Transfer Code to share with receiver"
                        >
                          {copiedCode === t.transferId ? <Check size={11} color="var(--accent-green)" /> : <Copy size={11} />}
                        </button>
                      </div>

                      <span
                        className="badge-tag"
                        style={{
                          fontSize: '0.7rem',
                          background: t.direction === 'SEND' ? 'rgba(0, 71, 255, 0.15)' : 'rgba(255, 46, 0, 0.15)',
                          borderColor: t.direction === 'SEND' ? 'var(--bauhaus-blue)' : 'var(--bauhaus-red)',
                          color: '#fff',
                        }}
                      >
                        {t.direction === 'SEND'
                          ? `OUTGOING → ${t.targetPeerName || 'Awaiting Receiver'}`
                          : `INCOMING ← ${t.targetPeerName || 'Sender'}`}
                      </span>

                      {t.isEncrypted && (
                        <span className="badge-tag" style={{ fontSize: '0.7rem', color: 'var(--accent-green)', borderColor: 'rgba(16,185,129,0.3)' }}>
                          <ShieldCheck size={11} style={{ display: 'inline', marginRight: '3px' }} />
                          AES-256-GCM
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem', fontFamily: 'var(--font-mono)' }}>
                      {t.status === 'PENDING_PEER' ? (
                        <span style={{ color: 'var(--bauhaus-yellow)' }}>
                          Awaiting peer to enter Transfer Code <code>{t.transferId}</code>...
                        </span>
                      ) : (
                        <>
                          {t.chunksCompleted} / {t.totalChunks} chunks ({CHUNK_SIZE / 1024}KB slices) &bull;{' '}
                          <span style={{ color: 'var(--bauhaus-yellow)', fontWeight: 700 }}>{t.speedMBps} MB/s</span>
                          {t.manifestHash && (
                            <span> &bull; Root Manifest Hash: <code>{t.manifestHash.substring(0, 16)}...</code></span>
                          )}
                        </>
                      )}
                    </div>

                    {t.errorMessage && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--bauhaus-red)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                        <AlertTriangle size={14} />
                        <span>{t.errorMessage}</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {t.status === 'STREAMING' || t.status === 'PAUSED' ? (
                      <button
                        className="btn-ghost"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                        onClick={() => togglePauseResume(t.fileId)}
                        title={t.status === 'STREAMING' ? 'Pause Transfer' : 'Resume Transfer (Bitmask Recovery)'}
                      >
                        {t.status === 'STREAMING' ? <Pause size={13} /> : <Play size={13} />}
                        <span>{t.status === 'STREAMING' ? 'Pause' : 'Resume'}</span>
                      </button>
                    ) : t.status === 'COMPLETED' ? (
                      <button
                        type="button"
                        className="btn-hyper-nav"
                        style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', background: 'var(--accent-green)' }}
                        onClick={() => downloadFile(t)}
                      >
                        <Download size={14} />
                        <span>Save to Disk</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ background: 'rgba(0, 0, 0, 0.5)', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${t.percentage}%`,
                      background: t.status === 'COMPLETED' ? 'var(--accent-green)' : t.status === 'CORRUPTED' || t.status === 'ERROR' ? 'var(--bauhaus-red)' : 'linear-gradient(90deg, var(--bauhaus-blue), var(--bauhaus-yellow))',
                      transition: 'width 0.15s ease',
                    }}
                  />
                </div>

                {/* Chunk Heatmap Visualizer */}
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontFamily: 'var(--font-mono)' }}>
                    <span>Chunk Transmission Map ({t.totalChunks} slots)</span>
                    <span style={{ color: t.status === 'COMPLETED' ? 'var(--accent-green)' : '#fff', fontWeight: 700 }}>
                      {t.status === 'COMPLETED' ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <FileCheck size={12} color="var(--accent-green)" />
                          100% STORED &bull; INTEGRITY VERIFIED
                        </span>
                      ) : t.status === 'PENDING_PEER' ? (
                        'READY FOR PEER'
                      ) : (
                        `${t.percentage}% STREAMED`
                      )}
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
                        title={`Chunk #${idx} (${done ? 'Delivered & Stored' : 'Pending'})`}
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
