import { WebSocketServer, WebSocket } from 'ws';

export class SignalingServer {
  constructor(server) {
    this.wss = new WebSocketServer({ server, path: '/ws/signaling' });
    // roomId -> Map<peerId, { ws, peerName, joinedAt }>
    this.rooms = new Map();
    // ws -> { peerId, peerName, roomId }
    this.socketMeta = new Map();
    // transferCode -> senderPeerId
    this.transferRegistry = new Map();

    this.init();
  }

  init() {
    this.wss.on('connection', (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (data, isBinary) => {
        try {
          if (isBinary) {
            // Binary frames can be directly routed if target encoded
            return;
          }
          const text = data.toString('utf8');
          const msg = JSON.parse(text);
          this.handleMessage(ws, msg);
        } catch (err) {
          console.error('[Signaling] Failed to process message:', err.message);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (err) => {
        console.warn('[Signaling] WebSocket client error:', err.message);
        this.handleDisconnect(ws);
      });
    });

    // Heartbeat check every 30s
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          ws.terminate();
          return;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {}
      });
    }, 30000);

    console.log('[Signaling] ⚡ WebSocket Signaling Engine running on /ws/signaling');
  }

  handleMessage(ws, msg) {
    const type = msg.type;
    if (!type) return;

    switch (type) {
      case 'join':
        this.handleJoin(ws, msg);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
      case 'transfer-accept':
      case 'bitmask-sync':
      case 'transfer-chunk':
      case 'transfer-ack':
      case 'transfer-complete':
        this.handleForward(ws, msg);
        break;
      case 'transfer-announce':
        this.handleTransferAnnounce(ws, msg);
        break;
      case 'transfer-request':
        this.handleTransferRequest(ws, msg);
        break;
      case 'chat':
      case 'file-announcement':
        this.handleBroadcast(ws, msg);
        break;
      case 'crdt-update':
        this.handleCrdtUpdate(ws, msg);
        break;
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
      case 'leave':
        this.handleDisconnect(ws);
        break;
      default:
        console.warn('[Signaling] Unknown message type:', type);
    }
  }

  handleJoin(ws, msg) {
    const roomId = msg.workspaceId || msg.roomId;
    const peerId = msg.peerId;
    const peerName = msg.peerName || 'Anonymous Peer';

    if (!roomId || !peerId) {
      this.send(ws, { type: 'error', message: 'workspaceId/roomId and peerId are required' });
      return;
    }

    // Register room
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Map());
    }
    const room = this.rooms.get(roomId);

    // Evict old socket if same peerId reconnected
    const oldPeer = room.get(peerId);
    if (oldPeer && oldPeer.ws !== ws && oldPeer.ws.readyState === WebSocket.OPEN) {
      this.socketMeta.delete(oldPeer.ws);
      try { oldPeer.ws.close(); } catch {}
    }

    room.set(peerId, { ws, peerName, joinedAt: Date.now() });
    this.socketMeta.set(ws, { peerId, peerName, roomId });

    console.log(`[Signaling] Peer joined: "${peerName}" (${peerId}) in room: "${roomId}"`);

    // 1. Send existing room peers to newcomer
    const existingPeers = [];
    for (const [pid, pMeta] of room.entries()) {
      if (pid !== peerId && pMeta.ws.readyState === WebSocket.OPEN) {
        existingPeers.push({
          peerId: pid,
          peerName: pMeta.peerName
        });
      }
    }

    this.send(ws, {
      type: 'peers',
      workspaceId: roomId,
      roomId,
      peers: existingPeers
    });

    // 2. Broadcast peer-joined to other peers in this room
    this.broadcastToRoom(roomId, peerId, {
      type: 'peer-joined',
      workspaceId: roomId,
      roomId,
      peerId,
      peerName
    });
  }

  handleForward(ws, msg) {
    const meta = this.socketMeta.get(ws);
    const targetPeerId = msg.targetPeerId;
    if (!targetPeerId) return;

    if (meta) {
      if (!msg.senderPeerId) msg.senderPeerId = meta.peerId;
      if (!msg.senderName) msg.senderName = meta.peerName;
    }

    const roomId = msg.workspaceId || msg.roomId || meta?.roomId;
    let targetSocket = null;

    if (roomId && this.rooms.has(roomId)) {
      targetSocket = this.rooms.get(roomId).get(targetPeerId)?.ws;
    }

    // Global room scan fallback
    if (!targetSocket) {
      for (const room of this.rooms.values()) {
        if (room.has(targetPeerId)) {
          targetSocket = room.get(targetPeerId).ws;
          break;
        }
      }
    }

    if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
      this.send(targetSocket, msg);
    } else {
      // Receiver may be offline or initializing
    }
  }

  handleTransferAnnounce(ws, msg) {
    const meta = this.socketMeta.get(ws);
    const transferId = (msg.transferId || '').toUpperCase().trim();
    if (!transferId || !meta) return;

    this.transferRegistry.set(transferId, meta.peerId);
    console.log(`[Signaling] Registered transfer: ${transferId} -> sender: ${meta.peerId}`);

    this.send(ws, {
      type: 'transfer-registered',
      transferId,
      status: 'REGISTERED'
    });

    const roomId = meta.roomId || msg.workspaceId;
    if (roomId) {
      msg.senderPeerId = meta.peerId;
      msg.senderName = meta.peerName;
      this.broadcastToRoom(roomId, meta.peerId, msg);
    }
  }

  handleTransferRequest(ws, msg) {
    const meta = this.socketMeta.get(ws);
    const transferId = (msg.transferId || '').toUpperCase().trim();
    if (!transferId) return;

    const targetSenderPeerId = this.transferRegistry.get(transferId) || msg.targetPeerId;
    if (!targetSenderPeerId) {
      this.send(ws, {
        type: 'error',
        code: 'TRANSFER_NOT_FOUND',
        message: `Transfer Code "${transferId}" was not found or the sender went offline.`
      });
      return;
    }

    if (meta) {
      msg.senderPeerId = meta.peerId;
      msg.senderName = meta.peerName;
      msg.targetPeerId = targetSenderPeerId;
    }

    this.handleForward(ws, msg);
  }

  handleCrdtUpdate(ws, msg) {
    const meta = this.socketMeta.get(ws);
    const roomId = msg.workspaceId || msg.roomId || meta?.roomId;
    if (!roomId) return;

    if (meta) {
      msg.senderPeerId = meta.peerId;
      msg.senderName = meta.peerName;
    }
    msg.timestamp = Date.now();

    // Broadcast live CRDT delta to all peers in the room except sender
    this.broadcastToRoom(roomId, meta?.peerId, msg);
  }

  handleBroadcast(ws, msg) {
    const meta = this.socketMeta.get(ws);
    const roomId = msg.workspaceId || msg.roomId || meta?.roomId;
    if (!roomId) return;

    if (meta) {
      msg.senderPeerId = meta.peerId;
      msg.senderName = meta.peerName;
    }
    msg.timestamp = Date.now();
    this.broadcastToRoom(roomId, null, msg);
  }

  handleDisconnect(ws) {
    const meta = this.socketMeta.get(ws);
    if (!meta) return;

    this.socketMeta.delete(ws);
    const { peerId, roomId } = meta;

    const room = this.rooms.get(roomId);
    if (room) {
      const existing = room.get(peerId);
      if (existing && existing.ws === ws) {
        room.delete(peerId);
        if (room.size === 0) {
          this.rooms.delete(roomId);
        }
      }
    }

    // Clean up transfer codes registered by this peer
    for (const [code, pId] of this.transferRegistry.entries()) {
      if (pId === peerId) {
        this.transferRegistry.delete(code);
      }
    }

    console.log(`[Signaling] Peer left: "${meta.peerName}" (${peerId}) from room: "${roomId}"`);

    this.broadcastToRoom(roomId, peerId, {
      type: 'peer-left',
      workspaceId: roomId,
      roomId,
      peerId
    });
  }

  broadcastToRoom(roomId, excludePeerId, payload) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const text = JSON.stringify(payload);
    for (const [pid, peer] of room.entries()) {
      if (pid !== excludePeerId && peer.ws.readyState === WebSocket.OPEN) {
        try {
          peer.ws.send(text);
        } catch (err) {
          console.warn(`[Signaling] Error sending to peer ${pid}:`, err.message);
        }
      }
    }
  }

  send(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        console.warn('[Signaling] Send error:', err.message);
      }
    }
  }

  close() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}

