/**
 * HyperX Phase 4 & 9: WebRTC Signaling Engine & Peer Collaboration
 * Coordinates STUN/TURN, SDP offer/answer exchanges, and DataChannels.
 */

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

export interface FileAnnouncement {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  senderPeerId: string;
  senderName: string;
  checksum?: string;
  isEncrypted: boolean;
}

export type WebRtcEventCallback = {
  onPeersUpdated?: (peers: PeerInfo[]) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onFileAnnounced?: (announcement: FileAnnouncement) => void;
  onDataChannelReady?: (peerId: string, channel: RTCDataChannel) => void;
  onConnectionStatus?: (status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING') => void;
};

export class WebRtcEngine {
  private ws: WebSocket | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private callbacks: WebRtcEventCallback = {};

  public readonly peerId: string;
  public peerName: string;
  public currentWorkspaceId: string | null = null;

  constructor(peerName = 'Peer') {
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
    this.peerName = peerName;
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
  }

  public sendChat(text: string) {
    if (!this.currentWorkspaceId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Local echo fallback
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

  public announceFile(announcement: FileAnnouncement) {
    this.sendWs({
      type: 'file-announcement',
      workspaceId: this.currentWorkspaceId,
      ...announcement,
    });
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
      case 'peers': {
        const peers = (msg.peers as PeerInfo[]) || [];
        this.callbacks.onPeersUpdated?.(peers);
        // Initiate WebRTC connection to existing peers
        for (const peer of peers) {
          await this.initiateCall(peer.peerId);
        }
        break;
      }
      case 'peer-joined': {
        const peerId = msg.peerId as string;
        const peerName = (msg.peerName as string) || 'Peer';
        if (peerId) {
          console.debug('Peer connected to workspace:', peerName, peerId);
        }
        break;
      }
      case 'peer-left': {
        const peerId = msg.peerId as string;
        const pc = this.peerConnections.get(peerId);
        if (pc) {
          pc.close();
          this.peerConnections.delete(peerId);
          this.dataChannels.delete(peerId);
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
      case 'file-announcement': {
        this.callbacks.onFileAnnounced?.({
          fileId: msg.fileId as string,
          fileName: msg.fileName as string,
          fileSize: msg.fileSize as number,
          totalChunks: msg.totalChunks as number,
          senderPeerId: msg.senderPeerId as string,
          senderName: msg.senderName as string,
          checksum: msg.checksum as string,
          isEncrypted: !!msg.isEncrypted,
        });
        break;
      }
    }
  }

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
    }
  }

  private async handleIceCandidate(senderPeerId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(senderPeerId);
    if (pc && candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
}
