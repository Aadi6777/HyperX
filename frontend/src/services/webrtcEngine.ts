/**
 * HyperX Phase 4, 5 & 9: Authenticated WebRTC Signaling & Point-to-Point DataChannel Engine
 * Point-to-point chunk delivery, active backpressure control, bitmask negotiation, and JWT authentication.
 */

import { getStoredToken } from './authService';
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
  onDataChannelReady?: (peerId: string, channel: RTCDataChannel) => void;
  onConnectionStatus?: (status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING') => void;
  onError?: (err: { message: string; code?: string }) => void;
  onTransferRegistered?: (reg: { transferId: string; status: string }) => void;
};

export class WebRtcEngine {
  private ws: WebSocket | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private callbacks: WebRtcEventCallback = {};
  private pendingHeaders = new Map<string, ChunkHeader>();
  private knownPeers = new Map<string, PeerInfo>();
  private iceCandidateQueues = new Map<string, RTCIceCandidateInit[]>();

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

    let wsUrl = serverUrl;
    if (!wsUrl) {
      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
      if (apiBase) {
        const cleanBase = apiBase.replace(/^http/, 'ws');
        wsUrl = `${cleanBase}/ws/signaling`;
      } else {
        const isHttps = window.location.protocol === 'https:';
        const host = window.location.hostname === 'localhost' ? 'localhost:8080' : window.location.host;
        wsUrl = `${isHttps ? 'wss' : 'ws'}://${host}/ws/signaling`;
      }
    }

    // Attach JWT authentication query parameter
    const token = getStoredToken();
    if (token) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      wsUrl += `${separator}token=${encodeURIComponent(token)}`;
    }

    try {
      this.callbacks.onConnectionStatus?.('CONNECTING');
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
          await this.handleSignalingMessage(msg);
        } catch (e) {
          console.error('Failed to parse signaling message:', e);
        }
      };

      this.ws.onclose = () => {
        this.callbacks.onConnectionStatus?.('DISCONNECTED');
      };

      this.ws.onerror = () => {
        this.callbacks.onConnectionStatus?.('DISCONNECTED');
      };
    } catch {
      this.callbacks.onConnectionStatus?.('DISCONNECTED');
    }
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.pendingHeaders.clear();
  }

  public sendChat(text: string) {
    if (!this.currentWorkspaceId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onChatMessage?.({
        id: Math.random().toString(36).substring(2, 9),
        senderPeerId: this.peerId,
        senderName: this.peerName,
        text,
        timestamp: Date.now(),
      });
      return;
    }

    this.sendWs({
      type: 'chat',
      workspaceId: this.currentWorkspaceId,
      senderPeerId: this.peerId,
      senderName: this.peerName,
      text,
      timestamp: Date.now(),
    });
  }

  // --- Point-to-Point Transfer Session Protocol ---

  public announceTransfer(transferId: string, manifest: FileManifest) {
    this.sendWs({
      type: 'transfer-announce',
      workspaceId: this.currentWorkspaceId,
      transferId,
      manifest,
    });
  }

  public requestTransfer(transferId: string) {
    this.sendWs({
      type: 'transfer-request',
      workspaceId: this.currentWorkspaceId,
      transferId,
    });
  }

  public acceptTransfer(transferId: string, receiverPeerId: string, manifest: FileManifest) {
    this.sendWs({
      type: 'transfer-accept',
      workspaceId: this.currentWorkspaceId,
      transferId,
      targetPeerId: receiverPeerId,
      manifest,
    });
  }

  public syncBitmask(transferId: string, targetPeerId: string, completedChunks: number[]) {
    this.sendWs({
      type: 'bitmask-sync',
      workspaceId: this.currentWorkspaceId,
      transferId,
      targetPeerId,
      completedChunks,
    });
  }

  /**
   * Ensure an open WebRTC DataChannel exists to the target peer.
   * If not yet connected, initiates a call and awaits the 'open' state.
   */
  public async ensureDataChannel(targetPeerId: string, timeoutMs = 8000): Promise<RTCDataChannel> {
    const existing = this.dataChannels.get(targetPeerId);
    if (existing && existing.readyState === 'open') {
      return existing;
    }

    if (!this.peerConnections.has(targetPeerId)) {
      await this.initiateCall(targetPeerId);
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ch = this.dataChannels.get(targetPeerId);
      if (ch && ch.readyState === 'open') {
        return ch;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error(`WebRTC DataChannel to peer ${targetPeerId} did not open within ${timeoutMs}ms.`);
  }

  /**
   * Point-to-Point Chunk Delivery with Real WebRTC Backpressure.
   * Delivers chunk strictly to targetPeerId. Pauses if socket buffer exceeds HIGH_WATERMARK.
   */
  public async sendChunkToPeer(
    targetPeerId: string,
    header: ChunkHeader,
    buffer: ArrayBuffer
  ): Promise<boolean> {
    let channel = this.dataChannels.get(targetPeerId);
    if (!channel || channel.readyState !== 'open') {
      try {
        channel = await this.ensureDataChannel(targetPeerId, 6000);
      } catch (err) {
        console.error(`Cannot send chunk, DataChannel not open for peer ${targetPeerId}:`, err);
        return false;
      }
    }

    // REAL BACKPRESSURE: Wait for buffer to drain before pushing more bytes
    if (channel.bufferedAmount > HIGH_WATERMARK) {
      await waitForBufferDrain(channel);
    }

    try {
      channel.send(JSON.stringify(header));
      channel.send(buffer);
      return true;
    } catch (err) {
      console.error(`Failed to send chunk to peer ${targetPeerId}:`, err);
      return false;
    }
  }

  public getDataChannel(peerId: string): RTCDataChannel | undefined {
    return this.dataChannels.get(peerId);
  }

  public getAllDataChannels(): RTCDataChannel[] {
    return Array.from(this.dataChannels.values());
  }

  private sendWs(msg: unknown) {
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
            this.iceCandidateQueues.delete(peerId);
          }
        }
        break;
      }
      case 'offer': {
        await this.handleOffer(msg.senderPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;
      }
      case 'answer': {
        await this.handleAnswer(msg.senderPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;
      }
      case 'ice-candidate': {
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
      case 'transfer-request': {
        this.callbacks.onTransferRequested?.({
          transferId: msg.transferId as string,
          receiverPeerId: msg.senderPeerId as string,
          receiverPeerName: (msg.senderName as string) || 'Peer',
        });
        break;
      }
      case 'transfer-accept': {
        this.callbacks.onTransferAccepted?.({
          transferId: msg.transferId as string,
          senderPeerId: msg.senderPeerId as string,
          manifest: msg.manifest as FileManifest,
        });
        break;
      }
      case 'bitmask-sync': {
        this.callbacks.onBitmaskSynced?.({
          transferId: msg.transferId as string,
          senderPeerId: msg.senderPeerId as string,
          completedChunks: (msg.completedChunks as number[]) || [],
        });
        break;
      }
    }
  }

  // STUN configuration (honest labeling: STUN-assisted direct P2P)
  private createPeerConnection(targetPeerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWs({
          type: 'ice-candidate',
          workspaceId: this.currentWorkspaceId,
          targetPeerId,
          senderPeerId: this.peerId,
          candidate: event.candidate,
        });
      }
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      this.setupDataChannel(targetPeerId, channel);
    };

    this.peerConnections.set(targetPeerId, pc);
    return pc;
  }

  private setupDataChannel(targetPeerId: string, channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      this.dataChannels.set(targetPeerId, channel);
      this.callbacks.onDataChannelReady?.(targetPeerId, channel);
    };
    channel.onclose = () => {
      this.dataChannels.delete(targetPeerId);
      this.pendingHeaders.delete(targetPeerId);
    };
    channel.onerror = (err) => {
      console.error(`DataChannel error with peer ${targetPeerId}:`, err);
    };
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'CHUNK') {
            this.pendingHeaders.set(targetPeerId, parsed);
          }
        } catch (e) {
          console.error('Failed to parse chunk header:', e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        const header = this.pendingHeaders.get(targetPeerId);
        if (header) {
          this.callbacks.onChunkReceived?.({
            fileId: header.fileId,
            chunkIndex: header.chunkIndex,
            totalChunks: header.totalChunks,
            isEncrypted: header.isEncrypted,
            iv: header.iv,
            data: event.data,
            senderPeerId: targetPeerId,
          });
        }
      }
    };
  }

  private async initiateCall(targetPeerId: string) {
    const pc = this.createPeerConnection(targetPeerId);
    const channel = pc.createDataChannel('hyperx-channel', { ordered: true });
    this.setupDataChannel(targetPeerId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendWs({
      type: 'offer',
      workspaceId: this.currentWorkspaceId,
      targetPeerId,
      senderPeerId: this.peerId,
      sdp: offer,
    });
  }

  private async handleOffer(senderPeerId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.createPeerConnection(senderPeerId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

    // Drain any buffered ICE candidates for this peer
    const queued = this.iceCandidateQueues.get(senderPeerId) || [];
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('Error applying queued ICE candidate:', e);
      }
    }
    this.iceCandidateQueues.delete(senderPeerId);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sendWs({
      type: 'answer',
      workspaceId: this.currentWorkspaceId,
      targetPeerId: senderPeerId,
      senderPeerId: this.peerId,
      sdp: answer,
    });
  }

  private async handleAnswer(senderPeerId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(senderPeerId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Drain any buffered ICE candidates
      const queued = this.iceCandidateQueues.get(senderPeerId) || [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Error applying queued ICE candidate:', e);
        }
      }
      this.iceCandidateQueues.delete(senderPeerId);
    }
  }

  private async handleIceCandidate(senderPeerId: string, candidate: RTCIceCandidateInit) {
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
      console.warn('Error adding ICE candidate:', e);
    }
  }
}
