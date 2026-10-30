/**
 * HyperX Phase 4 & 9: WebRTC Signaling Engine & Peer Collaboration
 * Coordinates STUN/TURN, SDP offer/answer exchange over the WebSocket signaling server, and the
 * RTCDataChannel mesh that carries control messages + file chunks between browsers.
 *
 * This class only moves bytes and tracks link health. The file-transfer protocol that runs on top
 * of the channels lives in transferManager.ts.
 */

import { LOW_WATERMARK } from './chunkEngine';

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

export type SignalingStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
export type LinkState = 'connecting' | 'open';

/** JSON control message exchanged over a data channel (OFFER, REQUEST, STOP, DONE, ACK, ...). */
export interface ControlMessage {
  t: string;
  [key: string]: unknown;
}

export type WebRtcEventCallback = {
  onPeersUpdated?: (peers: PeerInfo[]) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onConnectionStatus?: (status: SignalingStatus) => void;
  /** Fires whenever any peer link changes state; map of peerId -> state (closed links are absent). */
  onLinksChanged?: (links: Record<string, LinkState>) => void;
  onLinkOpen?: (peerId: string) => void;
  onLinkClosed?: (peerId: string) => void;
  onControl?: (peerId: string, msg: ControlMessage) => void;
  onFrame?: (peerId: string, frame: ArrayBuffer) => void;
};

/**
 * STUN finds your public address; TURN relays traffic when a direct path is impossible
 * (symmetric NAT, carrier-grade NAT on mobile data, strict corporate firewalls). A STUN-only
 * setup works on one LAN and between friendly home routers, and silently fails everywhere else.
 *
 * Configure your own relay with VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL, or
 * supply a full JSON array in VITE_ICE_SERVERS. When nothing is configured we fall back to the
 * free public Open Relay test server so cross-network transfers have a chance of working; for
 * production use your own TURN (coturn, Metered, Cloudflare, Twilio...).
 */
export function buildIceServers(): RTCIceServer[] {
  const custom = import.meta.env.VITE_ICE_SERVERS;
  if (custom) {
    try {
      const parsed = JSON.parse(custom);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as RTCIceServer[];
    } catch {
      console.warn('VITE_ICE_SERVERS is not valid JSON, ignoring it.');
    }
  }

  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl.split(',').map((u: string) => u.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  } else {
    servers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
  }
  return servers;
}

/**
 * Where the signaling WebSocket lives. Priority:
 *   1. VITE_SIGNALING_URL                       (explicit ws:// or wss:// URL)
 *   2. VITE_API_BASE_URL (http->ws, https->wss)  (your deployed Spring Boot backend)
 *   3. same origin /ws/signaling                 (Vite dev proxy or the nginx container)
 * Note: Vercel cannot host or proxy WebSockets, so a Vercel build MUST set #1 or #2.
 */
export function resolveSignalingUrl(): string {
  const explicit = import.meta.env.VITE_SIGNALING_URL;
  if (explicit) return explicit;

  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  if (base) return base.replace(/^http/, 'ws') + '/ws/signaling';

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/signaling`;
}

const PING_INTERVAL_MS = 25_000; // keeps idle WebSockets alive through proxies/tunnels (often 60s)
const MAX_RELINK_ATTEMPTS = 5;

export class WebRtcEngine {
  private ws: WebSocket | null = null;
  private wsUrl = '';
  private closedByUser = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>(); // open channels only
  private linkStates = new Map<string, LinkState>();
  private roomPeers = new Map<string, PeerInfo>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private relinkAttempts = new Map<string, number>();
  private relinkTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // WebSocket messages are handled strictly one after another. Handlers are async, and without
  // this an ICE candidate could be processed while setRemoteDescription() was still pending,
  // making addIceCandidate() throw and silently dropping the candidate.
  private signalQueue: Promise<void> = Promise.resolve();

  private callbacks: WebRtcEventCallback = {};
  private readonly iceServers = buildIceServers();

  public readonly peerId: string;
  public peerName: string;
  /** Signaling room. (Named workspaceId because that's the field the backend protocol uses.) */
  public currentWorkspaceId: string | null = null;
  public lastError: string | null = null;

  constructor(peerName = 'Peer') {
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 12);
    this.peerName = peerName;
  }

  public setCallbacks(cbs: WebRtcEventCallback) {
    this.callbacks = { ...this.callbacks, ...cbs };
  }

  public get signalingUrl(): string {
    return this.wsUrl;
  }

  /* ------------------------------------------------------------ lifecycle */

  public connect(roomId: string, serverUrl?: string) {
    this.currentWorkspaceId = roomId;
    this.wsUrl = serverUrl || resolveSignalingUrl();
    this.closedByUser = false;
    this.openSocket();
  }

  public disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    this.relinkTimers.forEach((t) => clearTimeout(t));
    this.relinkTimers.clear();

    if (this.ws) {
      // Detach handlers first: a late onclose from a socket we've abandoned used to flip the UI
      // to DISCONNECTED even though a newer engine/socket was already connected.
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    for (const id of [...this.peerConnections.keys()]) this.closePeer(id);
    this.roomPeers.clear();
    this.pendingCandidates.clear();
  }

  private setStatus(status: SignalingStatus) {
    this.callbacks.onConnectionStatus?.(status);
  }

  private openSocket() {
    if (this.closedByUser) return;
    this.setStatus('CONNECTING');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch {
      this.lastError = `Invalid signaling URL: ${this.wsUrl}`;
      this.setStatus('DISCONNECTED');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.setStatus('CONNECTED');
      this.sendWs({
        type: 'join',
        workspaceId: this.currentWorkspaceId,
        peerId: this.peerId,
        peerName: this.peerName,
      });
      this.startPing();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.error('Failed to parse signaling message:', e);
        return;
      }
      this.signalQueue = this.signalQueue
        .then(() => this.handleSignalingMessage(msg))
        .catch((e) => console.error('Signaling handler failed:', e));
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.lastError = `Cannot reach the signaling server at ${this.wsUrl}`;
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (this.closedByUser) return;
      this.setStatus('DISCONNECTED');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = Math.min(10_000, 1000 * 2 ** this.reconnectAttempt) + Math.random() * 300;
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.sendWs({ type: 'ping' }), PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private sendWs(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /* -------------------------------------------------------- public helpers */

  public getPeers(): PeerInfo[] {
    return Array.from(this.roomPeers.values());
  }

  public getPeerName(peerId: string): string {
    return this.roomPeers.get(peerId)?.peerName || 'Peer';
  }

  public getOpenPeerIds(): string[] {
    return Array.from(this.dataChannels.keys());
  }

  public getChannel(peerId: string): RTCDataChannel | undefined {
    const ch = this.dataChannels.get(peerId);
    return ch && ch.readyState === 'open' ? ch : undefined;
  }

  /** Send a JSON control message to one peer. Returns false if there is no open channel. */
  public sendControl(peerId: string, msg: ControlMessage): boolean {
    const ch = this.getChannel(peerId);
    if (!ch) return false;
    try {
      ch.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.error('Failed to send control message:', err);
      return false;
    }
  }

  public broadcastControl(msg: ControlMessage): number {
    let sent = 0;
    for (const id of this.getOpenPeerIds()) if (this.sendControl(id, msg)) sent++;
    return sent;
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

  /* ----------------------------------------------------- signaling handlers */

  private emitPeers() {
    this.callbacks.onPeersUpdated?.(this.getPeers());
  }

  private emitLinks() {
    this.callbacks.onLinksChanged?.(Object.fromEntries(this.linkStates));
  }

  private setLink(peerId: string, state: LinkState | null) {
    if (state === null) {
      if (!this.linkStates.delete(peerId)) return;
    } else {
      if (this.linkStates.get(peerId) === state) return;
      this.linkStates.set(peerId, state);
    }
    this.emitLinks();
  }

  private async handleSignalingMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;

    switch (type) {
      case 'peers': {
        const peers = (msg.peers as PeerInfo[]) || [];
        const listed = new Set(peers.map((p) => p.peerId));
        // Anyone we were linked to who is no longer in the room is gone.
        for (const id of [...this.peerConnections.keys()]) if (!listed.has(id)) this.closePeer(id);
        this.roomPeers = new Map(peers.map((p) => [p.peerId, p]));
        this.emitPeers();
        // We are the newcomer (or just reconnected): we call everyone already here. Any older
        // link to these peers is stale (the server told them we left), so initiateCall replaces it.
        for (const peer of peers) {
          await this.initiateCall(peer.peerId);
        }
        break;
      }
      case 'peer-joined': {
        const peerId = msg.peerId as string;
        if (peerId) {
          this.roomPeers.set(peerId, { peerId, peerName: (msg.peerName as string) || 'Peer' });
          this.emitPeers();
          // The newcomer will send us an offer; nothing to do until it arrives.
        }
        break;
      }
      case 'peer-left': {
        const peerId = msg.peerId as string;
        this.roomPeers.delete(peerId);
        this.closePeer(peerId);
        this.emitPeers();
        break;
      }
      case 'offer':
        await this.handleOffer(msg.senderPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;
      case 'answer':
        await this.handleAnswer(msg.senderPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(msg.senderPeerId as string, msg.candidate as RTCIceCandidateInit | null);
        break;
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
      case 'pong':
        break;
    }
  }

  /* ----------------------------------------------------------- peer links */

  private createPeerConnection(targetPeerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWs({
          type: 'ice-candidate',
          workspaceId: this.currentWorkspaceId,
          targetPeerId,
          senderPeerId: this.peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(targetPeerId, pc, event.channel);
    };

    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    pc.onconnectionstatechange = () => {
      if (this.peerConnections.get(targetPeerId) !== pc) return;
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      const state = pc.connectionState;
      if (state === 'failed' || state === 'closed') {
        this.handleLinkDown(targetPeerId, pc);
      } else if (state === 'disconnected') {
        // Often self-heals within seconds (Wi-Fi roam); only give up if it doesn't.
        disconnectTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected') this.handleLinkDown(targetPeerId, pc);
        }, 8000);
      }
    };

    this.peerConnections.set(targetPeerId, pc);
    this.setLink(targetPeerId, 'connecting');
    return pc;
  }

  private setupDataChannel(targetPeerId: string, pc: RTCPeerConnection, channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = LOW_WATERMARK;

    channel.onopen = () => {
      if (this.peerConnections.get(targetPeerId) !== pc) return;
      this.dataChannels.set(targetPeerId, channel);
      this.relinkAttempts.delete(targetPeerId);
      this.setLink(targetPeerId, 'open');
      this.callbacks.onLinkOpen?.(targetPeerId);
    };

    channel.onclose = () => {
      if (this.dataChannels.get(targetPeerId) === channel) {
        this.dataChannels.delete(targetPeerId);
        this.callbacks.onLinkClosed?.(targetPeerId);
        this.handleLinkDown(targetPeerId, pc);
      }
    };

    channel.onerror = (err) => {
      console.error(`DataChannel error with peer ${targetPeerId}:`, err);
    };

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as ControlMessage;
          this.callbacks.onControl?.(targetPeerId, msg);
        } catch (e) {
          console.error('Failed to parse control message:', e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.callbacks.onFrame?.(targetPeerId, event.data);
      }
    };
  }

  /** Tear down one peer link completely (idempotent). */
  private closePeer(peerId: string) {
    const timer = this.relinkTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.relinkTimers.delete(peerId);
    this.pendingCandidates.delete(peerId);

    const channel = this.dataChannels.get(peerId);
    this.dataChannels.delete(peerId);

    const pc = this.peerConnections.get(peerId);
    this.peerConnections.delete(peerId);
    if (pc) {
      pc.onicecandidate = pc.ondatachannel = pc.onconnectionstatechange = null;
      pc.close();
    }
    if (channel) {
      channel.onopen = channel.onclose = channel.onerror = channel.onmessage = null;
      this.callbacks.onLinkClosed?.(peerId);
    }
    this.setLink(peerId, null);
  }

  /**
   * A link died (ICE failed, channel closed, long disconnect). Drop it and, if the peer is still
   * in the room, try to re-establish. Exactly one side retries (lower peerId) so the two peers
   * don't send each other competing offers.
   */
  private handleLinkDown(peerId: string, pc: RTCPeerConnection) {
    if (this.peerConnections.get(peerId) !== pc || this.closedByUser) return;
    this.closePeer(peerId);

    if (!this.roomPeers.has(peerId) || this.peerId > peerId) return;
    const attempt = this.relinkAttempts.get(peerId) ?? 0;
    if (attempt >= MAX_RELINK_ATTEMPTS) return;
    this.relinkAttempts.set(peerId, attempt + 1);

    const timer = setTimeout(() => {
      this.relinkTimers.delete(peerId);
      if (this.closedByUser || !this.roomPeers.has(peerId) || this.peerConnections.has(peerId)) return;
      this.initiateCall(peerId).catch((e) => console.error('Re-link failed:', e));
    }, 1500 * 2 ** attempt);
    this.relinkTimers.set(peerId, timer);
  }

  private async initiateCall(targetPeerId: string) {
    this.closePeer(targetPeerId); // replace any stale link
    const pc = this.createPeerConnection(targetPeerId);
    const channel = pc.createDataChannel('hyperx-channel', { ordered: true });
    this.setupDataChannel(targetPeerId, pc, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendWs({
      type: 'offer',
      workspaceId: this.currentWorkspaceId,
      targetPeerId,
      senderPeerId: this.peerId,
      sdp: pc.localDescription,
    });
  }

  private async handleOffer(senderPeerId: string, sdp: RTCSessionDescriptionInit) {
    this.closePeer(senderPeerId); // an offer always supersedes whatever we had
    const pc = this.createPeerConnection(senderPeerId);
    await pc.setRemoteDescription(sdp);
    await this.flushCandidates(senderPeerId, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sendWs({
      type: 'answer',
      workspaceId: this.currentWorkspaceId,
      targetPeerId: senderPeerId,
      senderPeerId: this.peerId,
      sdp: pc.localDescription,
    });
  }

  private async handleAnswer(senderPeerId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(senderPeerId);
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    await pc.setRemoteDescription(sdp);
    await this.flushCandidates(senderPeerId, pc);
  }

  private async handleIceCandidate(senderPeerId: string, candidate: RTCIceCandidateInit | null) {
    if (!candidate) return;
    const pc = this.peerConnections.get(senderPeerId);
    if (!pc || !pc.remoteDescription) {
      // Remote description not applied yet: hold the candidate instead of failing.
      const list = this.pendingCandidates.get(senderPeerId) ?? [];
      list.push(candidate);
      this.pendingCandidates.set(senderPeerId, list);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (e) {
      console.warn('addIceCandidate failed:', e);
    }
  }

  private async flushCandidates(peerId: string, pc: RTCPeerConnection) {
    const list = this.pendingCandidates.get(peerId);
    this.pendingCandidates.delete(peerId);
    for (const c of list ?? []) {
      try {
        await pc.addIceCandidate(c);
      } catch (e) {
        console.warn('addIceCandidate (buffered) failed:', e);
      }
    }
  }
}
