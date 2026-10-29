/**
 * HyperX Phase 4, 5 & 9: Authenticated WebRTC Signaling & Point-to-Point DataChannel Engine
 * Point-to-point chunk delivery, active backpressure control, bitmask negotiation, and JWT authentication.
 */

import { getStoredToken, getApiBase } from './authService';
import { ChunkHeader, HIGH_WATERMARK, waitForBufferDrain } from './chunkEngine';

export interface PeerInfo {
  peerId: string;
  peerName: string;
}

export interface ChatMessage {
  id: string;
  senderPeerId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface FileManifest {
  transferId: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  isEncrypted: boolean;
  manifestHash?: string;
  senderPeerId?: string;
  senderName?: string;
}

export interface IncomingChunkPayload {
  fileId: string;
  transferId?: string;
  chunkIndex: number;
  totalChunks: number;
  isEncrypted: boolean;
  iv?: number[];
  data: ArrayBuffer;
  senderPeerId: string;
}

export type WebRtcEventCallback = {
  onPeersUpdated?: (peers: PeerInfo[]) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onTransferRequested?: (req: { transferId: string; receiverPeerId: string; receiverPeerName: string }) => void;
  onTransferAccepted?: (acc: { transferId: string; senderPeerId: string; manifest: FileManifest }) => void;
  onBitmaskSynced?: (sync: { transferId: string; senderPeerId: string; completedChunks: number[] }) => void;
  onChunkReceived?: (payload: IncomingChunkPayload) => void;
  onChunkAck?: (ack: { transferId: string; chunkIndex: number; senderPeerId: string }) => void;
  onTransferComplete?: (comp: { transferId: string; senderPeerId: string }) => void;
  onDataChannelReady?: (peerId: string, channel: RTCDataChannel) => void;
  onConnectionStatus?: (status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING') => void;
  onError?: (err: { message: string; code?: string }) => void;
  onTransferRegistered?: (reg: { transferId: string; status: string }) => void;
};

const MAGIC_HEADER_BYTE = 0x48; // 'H' for HyperX
const PROTOCOL_VERSION = 1;

export function encodeFramedChunk(header: ChunkHeader, data: ArrayBuffer): ArrayBuffer {
  const headerJson = JSON.stringify(header);
  const headerBytes = new TextEncoder().encode(headerJson);
  const totalLength = 8 + headerBytes.byteLength + data.byteLength;
  const packet = new Uint8Array(totalLength);
  const view = new DataView(packet.buffer);

  packet[0] = MAGIC_HEADER_BYTE;
  packet[1] = PROTOCOL_VERSION;
  packet[2] = 0;
  packet[3] = 0;
  view.setUint32(4, headerBytes.byteLength, false); // big-endian

  packet.set(headerBytes, 8);
  packet.set(new Uint8Array(data), 8 + headerBytes.byteLength);

  return packet.buffer;
}

export function decodeFramedChunk(buffer: ArrayBuffer): { header: ChunkHeader; data: ArrayBuffer } | null {
  if (buffer.byteLength < 8) return null;
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== MAGIC_HEADER_BYTE || bytes[1] !== PROTOCOL_VERSION) {
    return null;
  }
  const view = new DataView(buffer);
  const headerLength = view.getUint32(4, false);
  if (buffer.byteLength < 8 + headerLength) return null;

  try {
    const headerBytes = bytes.subarray(8, 8 + headerLength);
    const headerStr = new TextDecoder().decode(headerBytes);
    const header = JSON.parse(headerStr) as ChunkHeader;
    const data = buffer.slice(8 + headerLength);
    return { header, data };
  } catch (err) {
    console.error('[WebRTC] Failed to decode framed chunk:', err);
    return null;
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 8192) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, len))));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

interface PeerNegotiationState {
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
}

export class WebRtcEngine {
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private callbacks: WebRtcEventCallback = {};
  private pendingHeaders = new Map<string, ChunkHeader>();
  private knownPeers = new Map<string, PeerInfo>();
  private iceCandidateQueues = new Map<string, RTCIceCandidateInit[]>();
  private seenMessageIds = new Set<string>();
  private localTransferRegistry = new Map<string, string>(); // transferCode -> senderPeerId
  private peerStates = new Map<string, PeerNegotiationState>();
  private isExplicitlyClosed = false;

  public readonly peerId: string;
  public peerName: string;
  public currentWorkspaceId: string | null = null;

  constructor(peerName = 'Peer') {
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
    this.peerName = peerName;
  }

  public getKnownPeers(): PeerInfo[] {
    return Array.from(this.knownPeers.values());
  }

  public setCallbacks(cbs: WebRtcEventCallback) {
    this.callbacks = { ...this.callbacks, ...cbs };
  }

  public connect(workspaceId: string, serverUrl?: string) {
    this.currentWorkspaceId = workspaceId;
    this.isExplicitlyClosed = false;

    // 1. Initialize BroadcastChannel mesh for instant zero-config cross-tab & local P2P
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        if (this.bc) {
          this.bc.close();
        }
        this.bc = new BroadcastChannel('hyperx_mesh_' + workspaceId);
        this.bc.onmessage = async (event) => {
          const msg = event.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.senderPeerId === this.peerId || msg.peerId === this.peerId) return;

          // Message deduplication
          if (msg.msgId) {
            if (this.seenMessageIds.has(msg.msgId)) return;
            this.seenMessageIds.add(msg.msgId);
            if (this.seenMessageIds.size > 500) {
              const first = this.seenMessageIds.values().next().value;
              if (first) this.seenMessageIds.delete(first);
            }
          }

          await this.handleSignalingMessage(msg);
        };

        // Broadcast presence announcement to any existing tabs/peers
        setTimeout(() => {
          this.sendWs({
            type: 'peer-ping',
            workspaceId,
            peerId: this.peerId,
            peerName: this.peerName,
          });
        }, 150);

        this.callbacks.onConnectionStatus?.('CONNECTED');
      } catch (err) {
        console.warn('BroadcastChannel initialization error:', err);
      }
    }

    // 2. Resolve WebSocket URL (from custom setting, apiBase, or localhost/LAN)
    let wsUrl = serverUrl;
    if (!wsUrl) {
      const apiBase = getApiBase();
      if (apiBase) {
        const cleanBase = apiBase.replace(/^http/, 'ws');
        wsUrl = `${cleanBase}/ws/signaling`;
      } else if (typeof window !== 'undefined') {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) {
          wsUrl = `ws://${host}:8080/ws/signaling`;
        }
      }
    }

    if (!wsUrl) {
      // Running standalone/serverless on Vercel without a configured backend:
      // Local BroadcastChannel mesh is active and ready
      this.callbacks.onConnectionStatus?.('CONNECTED');
      return;
    }

    // Attach JWT authentication query parameter if token exists
    const token = getStoredToken();
    if (token) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      wsUrl += `${separator}token=${encodeURIComponent(token)}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.callbacks.onConnectionStatus?.('CONNECTED');
        this.sendWs({
          type: 'join',
          workspaceId,
          peerId: this.peerId,
          peerName: this.peerName,
          token: token || undefined,
        });
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.msgId) {
            if (this.seenMessageIds.has(msg.msgId)) return;
            this.seenMessageIds.add(msg.msgId);
            if (this.seenMessageIds.size > 500) {
              const first = this.seenMessageIds.values().next().value;
              if (first) this.seenMessageIds.delete(first);
            }
          }
          await this.handleSignalingMessage(msg);
        } catch (e) {
          console.error('Failed to parse signaling message:', e);
        }
      };

      this.ws.onclose = () => {
        this.callbacks.onConnectionStatus?.('DISCONNECTED');
        if (this.currentWorkspaceId && !this.isExplicitlyClosed) {
          setTimeout(() => {
            if (this.currentWorkspaceId && !this.isExplicitlyClosed) {
              console.log('[WebRTC] Auto-reconnecting to signaling mesh...');
              this.connect(this.currentWorkspaceId);
            }
          }, 3000);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[WebRTC] WebSocket error:', err);
      };
    } catch {
      this.callbacks.onConnectionStatus?.('DISCONNECTED');
    }
  }

  public disconnect() {
    this.isExplicitlyClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.bc) {
      this.bc.close();
      this.bc = null;
    }
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.pendingHeaders.clear();
    this.peerStates.clear();
    this.iceCandidateQueues.clear();
  }

  public sendChat(text: string) {
    const msg = {
      id: Math.random().toString(36).substring(2, 9),
      senderPeerId: this.peerId,
      senderName: this.peerName,
      text,
      timestamp: Date.now(),
    };

    this.callbacks.onChatMessage?.(msg);

    this.sendWs({
      type: 'chat',
      workspaceId: this.currentWorkspaceId,
      ...msg,
    });
  }

  // --- Point-to-Point Transfer Session Protocol ---

  public announceTransfer(transferId: string, manifest: FileManifest) {
    const code = transferId.toUpperCase().trim();
    this.localTransferRegistry.set(code, this.peerId);
    this.sendWs({
      type: 'transfer-announce',
      workspaceId: this.currentWorkspaceId,
      transferId: code,
      senderPeerId: this.peerId,
      manifest: {
        ...manifest,
        senderPeerId: this.peerId,
        senderName: this.peerName,
      },
    });
  }

  public requestTransfer(transferId: string) {
    const code = transferId.toUpperCase().trim();
    const knownSender = this.localTransferRegistry.get(code);
    this.sendWs({
      type: 'transfer-request',
      workspaceId: this.currentWorkspaceId,
      transferId: code,
      targetPeerId: knownSender,
      senderPeerId: this.peerId,
      senderName: this.peerName,
    });
  }

  public acceptTransfer(transferId: string, receiverPeerId: string, manifest: FileManifest) {
    this.sendWs({
      type: 'transfer-accept',
      workspaceId: this.currentWorkspaceId,
      transferId,
      targetPeerId: receiverPeerId,
      senderPeerId: this.peerId,
      manifest: {
        ...manifest,
        senderPeerId: this.peerId,
        senderName: this.peerName,
      },
    });
  }

  public syncBitmask(transferId: string, targetPeerId: string, completedChunks: number[]) {
    this.sendWs({
      type: 'bitmask-sync',
      workspaceId: this.currentWorkspaceId,
      transferId,
      targetPeerId,
      senderPeerId: this.peerId,
      completedChunks,
    });
  }

  public sendChunkAck(transferId: string, targetPeerId: string, chunkIndex: number) {
    const channel = this.dataChannels.get(targetPeerId);
    if (channel && channel.readyState === 'open') {
      try {
        channel.send(JSON.stringify({ type: 'transfer-ack', transferId, chunkIndex }));
        return;
      } catch {
        // Fall back to signaling
      }
    }
    this.sendWs({
      type: 'transfer-ack',
      workspaceId: this.currentWorkspaceId,
      targetPeerId,
      senderPeerId: this.peerId,
      transferId,
      chunkIndex,
    });
  }

  public sendTransferComplete(transferId: string, targetPeerId: string) {
    const channel = this.dataChannels.get(targetPeerId);
    if (channel && channel.readyState === 'open') {
      try {
        channel.send(JSON.stringify({ type: 'transfer-complete', transferId }));
        return;
      } catch {
        // Fall back to signaling
      }
    }
    this.sendWs({
      type: 'transfer-complete',
      workspaceId: this.currentWorkspaceId,
      targetPeerId,
      senderPeerId: this.peerId,
      transferId,
    });
  }

  private getPeerState(peerId: string): PeerNegotiationState {
    let state = this.peerStates.get(peerId);
    if (!state) {
      state = { makingOffer: false, ignoreOffer: false, isSettingRemoteAnswerPending: false };
      this.peerStates.set(peerId, state);
    }
    return state;
  }

  /**
   * Ensure an open WebRTC DataChannel exists to the target peer.
   * If not yet connected, initiates a call and awaits the 'open' state.
   */
  public async ensureDataChannel(targetPeerId: string, timeoutMs = 6000): Promise<RTCDataChannel> {
    const existing = this.dataChannels.get(targetPeerId);
    if (existing && existing.readyState === 'open') {
      return existing;
    }

    const pc = this.peerConnections.get(targetPeerId);
    if (!pc || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
      await this.initiateCall(targetPeerId);
    } else if (pc.signalingState === 'stable') {
      const channel = this.dataChannels.get(targetPeerId);
      if (!channel || channel.readyState === 'closed') {
        const newCh = pc.createDataChannel('hyperx-channel', { ordered: true });
        this.setupDataChannel(targetPeerId, newCh);
        await this.initiateCall(targetPeerId);
      }
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ch = this.dataChannels.get(targetPeerId);
      if (ch && ch.readyState === 'open') {
        return ch;
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    throw new Error(`WebRTC DataChannel to peer ${targetPeerId} did not open within ${timeoutMs}ms.`);
  }

  /**
   * Point-to-Point Chunk Delivery with Real WebRTC Backpressure and Seamless Signaling Relay Fallback.
   * Delivers chunk strictly to targetPeerId. Uses framed binary DataChannel by default,
   * with automatic, lossless fallback to WebSocket / Local mesh relay if DataChannel is unavailable.
   */
  public async sendChunkToPeer(
    targetPeerId: string,
    header: ChunkHeader,
    buffer: ArrayBuffer
  ): Promise<boolean> {
    const framed = encodeFramedChunk(header, buffer);

    // 1. Direct WebRTC DataChannel (Primary P2P path)
    let channel = this.dataChannels.get(targetPeerId);
    if (!channel || channel.readyState !== 'open') {
      try {
        channel = await this.ensureDataChannel(targetPeerId, 2500);
      } catch {
        channel = undefined;
      }
    }

    if (channel && channel.readyState === 'open') {
      try {
        if (channel.bufferedAmount > HIGH_WATERMARK) {
          await waitForBufferDrain(channel);
        }
        channel.send(framed);
        return true;
      } catch (err) {
        console.warn(`[WebRTC] Direct DataChannel send error to ${targetPeerId}, using relay fallback:`, err);
      }
    }

    // 2. Seamless Signaling / Local Mesh Relay Fallback
    try {
      const base64Data = arrayBufferToBase64(buffer);
      this.sendWs({
        type: 'transfer-chunk',
        workspaceId: this.currentWorkspaceId,
        targetPeerId,
        senderPeerId: this.peerId,
        fileId: header.fileId,
        transferId: header.transferId,
        chunkIndex: header.chunkIndex,
        totalChunks: header.totalChunks,
        isEncrypted: header.isEncrypted,
        iv: header.iv,
        dataBase64: base64Data,
      });
      return true;
    } catch (relayErr) {
      console.error(`[WebRTC] Relay send failed to peer ${targetPeerId}:`, relayErr);
      return false;
    }
  }

  public getDataChannel(peerId: string): RTCDataChannel | undefined {
    return this.dataChannels.get(peerId);
  }

  public getAllDataChannels(): RTCDataChannel[] {
    return Array.from(this.dataChannels.values());
  }

  private sendWs(msg: Record<string, unknown>) {
    if (!msg.msgId) {
      msg.msgId = Math.random().toString(36).substring(2, 9) + Date.now();
    }
    this.seenMessageIds.add(msg.msgId as string);

    // 1. Broadcast via local BroadcastChannel mesh
    if (this.bc) {
      try {
        this.bc.postMessage(msg);
      } catch (e) {
        console.warn('BroadcastChannel postMessage error:', e);
      }
    }

    // 2. Broadcast via WebSocket if open
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async handleSignalingMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;

    switch (type) {
      case 'error': {
        this.callbacks.onError?.({
          message: (msg.message as string) || 'Signaling error',
          code: msg.code as string,
        });
        break;
      }
      case 'transfer-registered': {
        this.callbacks.onTransferRegistered?.({
          transferId: (msg.transferId as string) || '',
          status: (msg.status as string) || 'REGISTERED',
        });
        break;
      }
      case 'peer-ping': {
        const peerId = msg.peerId as string;
        const peerName = (msg.peerName as string) || 'Peer';
        if (peerId && peerId !== this.peerId) {
          this.knownPeers.set(peerId, { peerId, peerName });
          this.callbacks.onPeersUpdated?.(Array.from(this.knownPeers.values()));
          this.sendWs({
            type: 'peer-pong',
            workspaceId: this.currentWorkspaceId,
            targetPeerId: peerId,
            peerId: this.peerId,
            peerName: this.peerName,
          });
        }
        break;
      }
      case 'peer-pong': {
        const targetPeerId = msg.targetPeerId as string;
        const peerId = msg.peerId as string;
        const peerName = (msg.peerName as string) || 'Peer';
        if (targetPeerId === this.peerId && peerId && peerId !== this.peerId) {
          this.knownPeers.set(peerId, { peerId, peerName });
          this.callbacks.onPeersUpdated?.(Array.from(this.knownPeers.values()));
          await this.initiateCall(peerId);
        }
        break;
      }
      case 'peers': {
        const peers = (msg.peers as PeerInfo[]) || [];
        this.knownPeers.clear();
        for (const p of peers) {
          this.knownPeers.set(p.peerId, p);
        }
        this.callbacks.onPeersUpdated?.(Array.from(this.knownPeers.values()));
        for (const peer of peers) {
          await this.initiateCall(peer.peerId);
        }
        break;
      }
      case 'peer-joined': {
        const peerId = msg.peerId as string;
        const peerName = (msg.peerName as string) || 'Peer';
        if (peerId && peerId !== this.peerId) {
          this.knownPeers.set(peerId, { peerId, peerName });
          this.callbacks.onPeersUpdated?.(Array.from(this.knownPeers.values()));
        }
        break;
      }
      case 'peer-left': {
        const peerId = msg.peerId as string;
        if (peerId) {
          this.knownPeers.delete(peerId);
          this.callbacks.onPeersUpdated?.(Array.from(this.knownPeers.values()));
          const pc = this.peerConnections.get(peerId);
          if (pc) {
            pc.close();
            this.peerConnections.delete(peerId);
            this.dataChannels.delete(peerId);
            this.pendingHeaders.delete(peerId);
            this.peerStates.delete(peerId);
            this.iceCandidateQueues.delete(peerId);
          }
        }
        break;
      }
      case 'offer': {
        if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
        await this.handleOffer(msg.senderPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;
      }
      case 'answer': {
        if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
        await this.handleAnswer(msg.senderPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;
      }
      case 'ice-candidate': {
        if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
        await this.handleIceCandidate(msg.senderPeerId as string, msg.candidate as RTCIceCandidateInit);
        break;
      }
      case 'chat': {
        this.callbacks.onChatMessage?.({
          id: Math.random().toString(36).substring(2, 9),
          senderPeerId: msg.senderPeerId as string,
          senderName: msg.senderName as string,
          text: msg.text as string,
          timestamp: (msg.timestamp as number) || Date.now(),
        });
        break;
      }
      case 'transfer-announce': {
        const transferId = (msg.transferId as string || '').toUpperCase().trim();
        const sender = (msg.senderPeerId as string) || (msg.manifest as Record<string, unknown>)?.senderPeerId as string;
        if (transferId && sender) {
          this.localTransferRegistry.set(transferId, sender);
        }
        break;
      }
      case 'transfer-request': {
        const transferId = (msg.transferId as string || '').toUpperCase().trim();
        const targetSender = (msg.targetPeerId as string) || this.localTransferRegistry.get(transferId);
        // Respond if this peer is the target sender or if transferId was registered on this instance
        if (targetSender === this.peerId || this.localTransferRegistry.get(transferId) === this.peerId || this.localTransferRegistry.has(transferId)) {
          this.callbacks.onTransferRequested?.({
            transferId: msg.transferId as string,
            receiverPeerId: msg.senderPeerId as string,
            receiverPeerName: (msg.senderName as string) || 'Peer',
          });
        }
        break;
      }
      case 'transfer-accept': {
        if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
        this.callbacks.onTransferAccepted?.({
          transferId: msg.transferId as string,
          senderPeerId: msg.senderPeerId as string,
          manifest: msg.manifest as FileManifest,
        });
        break;
      }
      case 'bitmask-sync': {
        if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
        this.callbacks.onBitmaskSynced?.({
          transferId: msg.transferId as string,
          senderPeerId: msg.senderPeerId as string,
          completedChunks: (msg.completedChunks as number[]) || [],
        });
        break;
      }
      case 'transfer-chunk': {
        if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
        const base64 = msg.dataBase64 as string;
        if (!base64) return;
        try {
          const chunkData = base64ToArrayBuffer(base64);
          this.callbacks.onChunkReceived?.({
            fileId: msg.fileId as string,
            transferId: msg.transferId as string,
            chunkIndex: msg.chunkIndex as number,
            totalChunks: msg.totalChunks as number,
            isEncrypted: Boolean(msg.isEncrypted),
            iv: msg.iv as number[],
            data: chunkData,
            senderPeerId: msg.senderPeerId as string,
          });
        } catch (e) {
          console.error('[WebRTC] Failed to decode relayed transfer-chunk:', e);
        }
        break;
      }
      case 'transfer-ack': {
        if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
        this.callbacks.onChunkAck?.({
          transferId: msg.transferId as string,
          chunkIndex: msg.chunkIndex as number,
          senderPeerId: msg.senderPeerId as string,
        });
        this.callbacks.onBitmaskSynced?.({
          transferId: msg.transferId as string,
          senderPeerId: msg.senderPeerId as string,
          completedChunks: [msg.chunkIndex as number],
        });
        break;
      }
      case 'transfer-complete': {
        if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
        this.callbacks.onTransferComplete?.({
          transferId: msg.transferId as string,
          senderPeerId: msg.senderPeerId as string,
        });
        break;
      }
    }
  }

  // STUN + Enterprise OpenRelay TURN configuration for guaranteed direct NAT traversal across all networks
  private createPeerConnection(targetPeerId: string): RTCPeerConnection {
    const existing = this.peerConnections.get(targetPeerId);
    if (existing && existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
      return existing;
    }
    if (existing) {
      existing.close();
      this.peerConnections.delete(targetPeerId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp',
          ],
          username: 'openrelay',
          credential: 'openrelay',
        },
      ],
      iceCandidatePoolSize: 8,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidatePayload = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
        this.sendWs({
          type: 'ice-candidate',
          workspaceId: this.currentWorkspaceId,
          targetPeerId,
          senderPeerId: this.peerId,
          candidate: candidatePayload,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${targetPeerId} connection state:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.dataChannels.delete(targetPeerId);
        this.pendingHeaders.delete(targetPeerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${targetPeerId} ICE connection state:`, pc.iceConnectionState);
    };

    pc.ondatachannel = (event) => {
      console.log(`[WebRTC] Received incoming DataChannel from peer ${targetPeerId}`);
      this.setupDataChannel(targetPeerId, event.channel);
    };

    this.peerConnections.set(targetPeerId, pc);
    return pc;
  }

  private setupDataChannel(targetPeerId: string, channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    this.dataChannels.set(targetPeerId, channel);

    const notifyReady = () => {
      console.log(`[WebRTC] DataChannel to peer ${targetPeerId} is OPEN`);
      this.dataChannels.set(targetPeerId, channel);
      this.callbacks.onDataChannelReady?.(targetPeerId, channel);
    };

    if (channel.readyState === 'open') {
      notifyReady();
    } else {
      channel.onopen = notifyReady;
    }

    channel.onclose = () => {
      console.log(`[WebRTC] DataChannel to peer ${targetPeerId} closed`);
      this.dataChannels.delete(targetPeerId);
      this.pendingHeaders.delete(targetPeerId);
    };

    channel.onerror = (err) => {
      console.error(`[WebRTC] DataChannel error with peer ${targetPeerId}:`, err);
    };

    channel.onmessage = async (event) => {
      let arrayBuf: ArrayBuffer | null = null;
      if (event.data instanceof ArrayBuffer) {
        arrayBuf = event.data;
      } else if (event.data instanceof Blob) {
        arrayBuf = await event.data.arrayBuffer();
      }

      if (arrayBuf) {
        // Attempt atomic framed decode
        const decoded = decodeFramedChunk(arrayBuf);
        if (decoded) {
          this.callbacks.onChunkReceived?.({
            fileId: decoded.header.fileId,
            transferId: decoded.header.transferId,
            chunkIndex: decoded.header.chunkIndex,
            totalChunks: decoded.header.totalChunks,
            isEncrypted: decoded.header.isEncrypted,
            iv: decoded.header.iv,
            data: decoded.data,
            senderPeerId: targetPeerId,
          });
          return;
        }

        // Legacy header fallback
        const header = this.pendingHeaders.get(targetPeerId);
        if (header) {
          this.callbacks.onChunkReceived?.({
            fileId: header.fileId,
            transferId: header.transferId,
            chunkIndex: header.chunkIndex,
            totalChunks: header.totalChunks,
            isEncrypted: header.isEncrypted,
            iv: header.iv,
            data: arrayBuf,
            senderPeerId: targetPeerId,
          });
          this.pendingHeaders.delete(targetPeerId);
          return;
        }
      }

      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'CHUNK') {
            this.pendingHeaders.set(targetPeerId, parsed);
          } else if (parsed.type === 'transfer-ack') {
            this.callbacks.onChunkAck?.({
              transferId: parsed.transferId,
              chunkIndex: parsed.chunkIndex,
              senderPeerId: targetPeerId,
            });
            this.callbacks.onBitmaskSynced?.({
              transferId: parsed.transferId,
              senderPeerId: targetPeerId,
              completedChunks: [parsed.chunkIndex],
            });
          } else if (parsed.type === 'transfer-complete') {
            this.callbacks.onTransferComplete?.({
              transferId: parsed.transferId,
              senderPeerId: targetPeerId,
            });
          }
        } catch (e) {
          console.error('[WebRTC] Failed to parse DataChannel JSON message:', e);
        }
      }
    };
  }

  private async initiateCall(targetPeerId: string) {
    console.log(`[WebRTC] Initiating call to peer ${targetPeerId}...`);
    const pc = this.createPeerConnection(targetPeerId);
    const pState = this.getPeerState(targetPeerId);

    let channel = this.dataChannels.get(targetPeerId);
    if (!channel || channel.readyState === 'closed') {
      channel = pc.createDataChannel('hyperx-channel', { ordered: true });
      this.setupDataChannel(targetPeerId, channel);
    }

    try {
      pState.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);

      this.sendWs({
        type: 'offer',
        workspaceId: this.currentWorkspaceId,
        targetPeerId,
        senderPeerId: this.peerId,
        sdp: pc.localDescription || offer,
      });
    } catch (err) {
      console.warn(`[WebRTC] initiateCall error with peer ${targetPeerId}:`, err);
    } finally {
      pState.makingOffer = false;
    }
  }

  private async handleOffer(senderPeerId: string, sdp: RTCSessionDescriptionInit) {
    console.log(`[WebRTC] Handling offer from peer ${senderPeerId}...`);
    const pc = this.createPeerConnection(senderPeerId);
    const pState = this.getPeerState(senderPeerId);
    const isPolite = this.peerId > senderPeerId;

    const offerCollision = pState.makingOffer || pc.signalingState !== 'stable';
    pState.ignoreOffer = !isPolite && offerCollision;
    if (pState.ignoreOffer) {
      console.log(`[WebRTC] Impolite peer ${this.peerId} ignoring offer collision from ${senderPeerId}`);
      return;
    }

    try {
      if (offerCollision && isPolite) {
        console.log(`[WebRTC] Polite peer ${this.peerId} rolling back local description for ${senderPeerId}`);
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.drainIceCandidates(senderPeerId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendWs({
        type: 'answer',
        workspaceId: this.currentWorkspaceId,
        targetPeerId: senderPeerId,
        senderPeerId: this.peerId,
        sdp: pc.localDescription || answer,
      });
    } catch (err) {
      console.error(`[WebRTC] Failed to handle offer from ${senderPeerId}:`, err);
    }
  }

  private async handleAnswer(senderPeerId: string, sdp: RTCSessionDescriptionInit) {
    console.log(`[WebRTC] Handling answer from peer ${senderPeerId}...`);
    const pc = this.peerConnections.get(senderPeerId);
    if (!pc) return;
    const pState = this.getPeerState(senderPeerId);
    if (pState.ignoreOffer) {
      return;
    }

    try {
      if (pc.signalingState === 'have-local-offer') {
        pState.isSettingRemoteAnswerPending = true;
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        pState.isSettingRemoteAnswerPending = false;
        await this.drainIceCandidates(senderPeerId);
      }
    } catch (err) {
      console.error(`[WebRTC] Failed to set remote answer from ${senderPeerId}:`, err);
    }
  }

  private async handleIceCandidate(senderPeerId: string, candidate: RTCIceCandidateInit) {
    if (!candidate || !candidate.candidate) return;
    const pc = this.peerConnections.get(senderPeerId);
    if (!pc || !pc.remoteDescription) {
      const queue = this.iceCandidateQueues.get(senderPeerId) || [];
      queue.push(candidate);
      this.iceCandidateQueues.set(senderPeerId, queue);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      const pState = this.getPeerState(senderPeerId);
      if (!pState.ignoreOffer) {
        console.warn('[WebRTC] Error adding ICE candidate:', e);
      }
    }
  }

  private async drainIceCandidates(peerId: string) {
    const pc = this.peerConnections.get(peerId);
    if (!pc || !pc.remoteDescription) return;

    const queued = this.iceCandidateQueues.get(peerId) || [];
    if (queued.length > 0) {
      this.iceCandidateQueues.delete(peerId);
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('[WebRTC] Error applying queued ICE candidate:', e);
        }
      }
    }
  }
}

