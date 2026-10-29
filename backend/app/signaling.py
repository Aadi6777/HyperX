import asyncio
import json
import logging
import time
import uuid
from typing import Dict, Any, Optional
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from app import database
from app.models import Member
from app.security import decode_access_token

logger = logging.getLogger("hyperx.signaling")

class PeerMeta:
    def __init__(self, peer_id: str, peer_name: str, workspace_id: str, user_id: Optional[uuid.UUID] = None):
        self.peer_id = peer_id
        self.peer_name = peer_name
        self.workspace_id = workspace_id
        self.user_id = user_id

class SignalingManager:
    def __init__(self):
        # workspace_id -> { peer_id: WebSocket }
        self.workspace_sessions: Dict[str, Dict[str, WebSocket]] = {}
        # WebSocket -> PeerMeta
        self.session_to_peer: Dict[WebSocket, PeerMeta] = {}
        # transfer_code -> sender_peer_id
        self.transfer_registry: Dict[str, str] = {}
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()

    async def disconnect(self, websocket: WebSocket):
        async with self.lock:
            meta = self.session_to_peer.pop(websocket, None)
            if not meta:
                return

            ws_dict = self.workspace_sessions.get(meta.workspace_id)
            if ws_dict:
                ws_dict.pop(meta.peer_id, None)
                if not ws_dict:
                    self.workspace_sessions.pop(meta.workspace_id, None)

            # Cleanup transfer codes registered by this peer
            transfers_to_remove = [k for k, v in self.transfer_registry.items() if v == meta.peer_id]
            for code in transfers_to_remove:
                self.transfer_registry.pop(code, None)

            logger.info(f"Peer disconnected: peerId={meta.peer_id}, workspaceId={meta.workspace_id}")

        # Broadcast peer-left to remaining peers in workspace
        await self.broadcast_to_workspace(
            meta.workspace_id,
            meta.peer_id,
            {
                "type": "peer-left",
                "workspaceId": meta.workspace_id,
                "peerId": meta.peer_id
            }
        )

    async def handle_message(self, websocket: WebSocket, text_data: str):
        try:
            msg = json.loads(text_data)
        except Exception as e:
            logger.warning(f"Failed to parse incoming WebSocket JSON: {e}")
            return

        msg_type = msg.get("type")
        if not msg_type:
            return

        if msg_type == "join":
            await self.handle_join(websocket, msg)
        elif msg_type in ("offer", "answer", "ice-candidate", "transfer-accept", "bitmask-sync", "transfer-chunk", "transfer-ack", "transfer-complete"):
            await self.handle_forward(websocket, msg)
        elif msg_type in ("chat", "file-announcement"):
            await self.handle_broadcast(websocket, msg)
        elif msg_type == "transfer-announce":
            await self.handle_transfer_announce(websocket, msg)
        elif msg_type == "transfer-request":
            await self.handle_transfer_request(websocket, msg)
        elif msg_type == "leave":
            await self.disconnect(websocket)
        else:
            logger.warning(f"Unknown message type received: {msg_type}")

    async def handle_join(self, websocket: WebSocket, msg: Dict[str, Any]):
        workspace_id = msg.get("workspaceId")
        peer_id = msg.get("peerId")
        peer_name = msg.get("peerName") or "Anonymous Peer"

        if not workspace_id or not peer_id:
            await self.send_to_socket(websocket, {"type": "error", "message": "workspaceId and peerId are required"})
            return

        token = msg.get("token") or websocket.query_params.get("token")
        authenticated_user_id: Optional[uuid.UUID] = None

        if token:
            payload = decode_access_token(token)
            if payload and "sub" in payload:
                try:
                    authenticated_user_id = uuid.UUID(payload["sub"])
                    # Validate workspace membership if workspace_id is UUID
                    try:
                        ws_uuid = uuid.UUID(workspace_id)
                        async with database.AsyncSessionLocal() as session:
                            res = await session.execute(
                                select(Member).where(Member.workspace_id == ws_uuid, Member.user_id == authenticated_user_id)
                            )
                            if not res.scalar_one_or_none():
                                logger.warning(f"Access Denied: User {authenticated_user_id} not in workspace {workspace_id}")
                                await self.send_to_socket(websocket, {
                                    "type": "error",
                                    "code": "ACCESS_DENIED",
                                    "message": f"Unauthorized: You are not a member of workspace {workspace_id}"
                                })
                                await websocket.close(code=1008)
                                return
                    except ValueError:
                        pass
                except Exception as e:
                    logger.debug(f"Token parsing error: {e}")

        async with self.lock:
            if workspace_id not in self.workspace_sessions:
                self.workspace_sessions[workspace_id] = {}
            self.workspace_sessions[workspace_id][peer_id] = websocket
            self.session_to_peer[websocket] = PeerMeta(peer_id, peer_name, workspace_id, authenticated_user_id)

            existing_peers = []
            for pid, sock in self.workspace_sessions[workspace_id].items():
                if pid != peer_id:
                    meta = self.session_to_peer.get(sock)
                    if meta:
                        existing_peers.append({
                            "peerId": meta.peer_id,
                            "peerName": meta.peer_name
                        })

        logger.info(f"Peer joined: peerId={peer_id}, peerName={peer_name}, workspaceId={workspace_id}")

        # Send existing peers
        await self.send_to_socket(websocket, {
            "type": "peers",
            "workspaceId": workspace_id,
            "peers": existing_peers
        })

        # Broadcast peer-joined
        await self.broadcast_to_workspace(
            workspace_id,
            peer_id,
            {
                "type": "peer-joined",
                "workspaceId": workspace_id,
                "peerId": peer_id,
                "peerName": peer_name
            }
        )

    async def handle_transfer_announce(self, websocket: WebSocket, msg: Dict[str, Any]):
        transfer_id = msg.get("transferId")
        meta = self.session_to_peer.get(websocket)
        if transfer_id and meta:
            norm_code = str(transfer_id).upper().strip()
            async with self.lock:
                self.transfer_registry[norm_code] = meta.peer_id
            logger.info(f"Registered transfer code {norm_code} -> senderPeerId {meta.peer_id}")
            await self.send_to_socket(websocket, {
                "type": "transfer-registered",
                "transferId": norm_code,
                "status": "REGISTERED"
            })
            # Broadcast announcement to workspace peers so all tabs know the sender
            workspace_id = meta.workspace_id or msg.get("workspaceId")
            if workspace_id:
                msg["senderPeerId"] = meta.peer_id
                msg["senderName"] = meta.peer_name
                await self.broadcast_to_workspace(workspace_id, meta.peer_id, msg)

    async def handle_transfer_request(self, websocket: WebSocket, msg: Dict[str, Any]):
        transfer_id = msg.get("transferId")
        if not transfer_id:
            await self.send_to_socket(websocket, {"type": "error", "message": "transferId is required for transfer-request"})
            return

        norm_code = str(transfer_id).upper().strip()
        target_sender_peer_id = self.transfer_registry.get(norm_code) or msg.get("targetPeerId")
        if not target_sender_peer_id:
            await self.send_to_socket(websocket, {
                "type": "error",
                "code": "TRANSFER_NOT_FOUND",
                "message": f"Transfer Code {transfer_id} was not found. Please verify the code with the sender."
            })
            return

        receiver = self.session_to_peer.get(websocket)
        if receiver:
            msg["senderPeerId"] = receiver.peer_id
            msg["senderName"] = receiver.peer_name
            msg["targetPeerId"] = target_sender_peer_id
            await self.handle_forward(websocket, msg)

    async def handle_forward(self, websocket: Optional[WebSocket], msg: Dict[str, Any]):
        if websocket:
            sender = self.session_to_peer.get(websocket)
            if sender:
                if not msg.get("senderPeerId"):
                    msg["senderPeerId"] = sender.peer_id
                if not msg.get("senderName"):
                    msg["senderName"] = sender.peer_name

        workspace_id = msg.get("workspaceId")
        target_peer_id = msg.get("targetPeerId")
        if not target_peer_id:
            return

        target_socket: Optional[WebSocket] = None
        if workspace_id and workspace_id in self.workspace_sessions:
            target_socket = self.workspace_sessions[workspace_id].get(target_peer_id)

        # Fallback: scan all workspaces
        if not target_socket:
            for ws_dict in self.workspace_sessions.values():
                if target_peer_id in ws_dict:
                    target_socket = ws_dict[target_peer_id]
                    break

        if target_socket:
            await self.send_to_socket(target_socket, msg)
        else:
            logger.warning(f"handle_forward: target peer {target_peer_id} not found")

    async def handle_broadcast(self, websocket: WebSocket, msg: Dict[str, Any]):
        workspace_id = msg.get("workspaceId")
        if not workspace_id:
            return
        sender = self.session_to_peer.get(websocket)
        if sender:
            msg["senderPeerId"] = sender.peer_id
            msg["senderName"] = sender.peer_name
        msg.setdefault("timestamp", int(time.time() * 1000))
        await self.broadcast_to_workspace(workspace_id, None, msg)

    async def broadcast_to_workspace(self, workspace_id: str, exclude_peer_id: Optional[str], message_obj: Any):
        peers_map = self.workspace_sessions.get(workspace_id, {})
        targets = [
            sock for pid, sock in peers_map.items()
            if pid != exclude_peer_id
        ]
        if targets:
            await asyncio.gather(*[self.send_to_socket(s, message_obj) for s in targets], return_exceptions=True)

    async def send_to_socket(self, websocket: WebSocket, message_obj: Any):
        try:
            await websocket.send_text(json.dumps(message_obj))
        except Exception as e:
            logger.debug(f"Failed to send to WebSocket: {e}")

signaling_manager = SignalingManager()
