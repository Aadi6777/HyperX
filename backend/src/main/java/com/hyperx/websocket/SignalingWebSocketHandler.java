package com.hyperx.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hyperx.security.JwtTokenProvider;
import com.hyperx.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.net.URI;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class SignalingWebSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final JwtTokenProvider jwtTokenProvider;
    private final WorkspaceService workspaceService;

    // workspaceId -> (peerId -> WebSocketSession)
    private final Map<String, Map<String, WebSocketSession>> workspaceSessions = new ConcurrentHashMap<>();

    // sessionId -> PeerMeta
    private record PeerMeta(String sessionId, String peerId, String peerName, String workspaceId, UUID userId) {}
    private final Map<String, PeerMeta> sessionToPeer = new ConcurrentHashMap<>();

    // transferId -> senderPeerId (For point-to-point transfer code resolution)
    private final Map<String, String> transferRegistry = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.info("WebSocket connected: sessionId={}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        SignalingMessage msg = objectMapper.readValue(message.getPayload(), SignalingMessage.class);
        String type = msg.getType();

        if (type == null) {
            return;
        }

        switch (type) {
            case "join" -> handleJoin(session, msg);
            case "offer", "answer", "ice-candidate" -> handleForward(msg);
            case "chat", "file-announcement" -> handleBroadcast(session, msg);
            case "transfer-announce" -> handleTransferAnnounce(session, msg);
            case "transfer-request" -> handleTransferRequest(session, msg);
            case "transfer-accept", "bitmask-sync" -> handleForward(msg);
            default -> log.warn("Unknown message type: {}", type);
        }
    }

    private void handleJoin(WebSocketSession session, SignalingMessage msg) throws IOException {
        String workspaceId = msg.getWorkspaceId();
        String peerId = msg.getPeerId();
        String peerName = msg.getPeerName() != null ? msg.getPeerName() : "Anonymous Peer";

        if (workspaceId == null || peerId == null) {
            send(session, Map.of("type", "error", "message", "workspaceId and peerId are required"));
            return;
        }

        // Authenticate & Validate Workspace Membership
        UUID authenticatedUserId = null;
        String token = msg.getToken();
        if (token == null || token.isBlank()) {
            token = extractTokenFromUri(session.getUri());
        }

        if (token != null && !token.isBlank()) {
            if (jwtTokenProvider.validateToken(token)) {
                authenticatedUserId = jwtTokenProvider.getUserIdFromJWT(token);
                try {
                    UUID wsUuid = UUID.fromString(workspaceId);
                    boolean isMember = workspaceService.isUserMemberOfWorkspace(authenticatedUserId, wsUuid);
                    if (!isMember) {
                        log.warn("Access Denied: User {} is not a member of workspace {}", authenticatedUserId, workspaceId);
                        send(session, Map.of(
                            "type", "error",
                            "code", "ACCESS_DENIED",
                            "message", "Unauthorized: You are not a member of workspace " + workspaceId
                        ));
                        session.close(CloseStatus.POLICY_VIOLATION);
                        return;
                    }
                } catch (IllegalArgumentException e) {
                    // Non-UUID workspace (e.g. demo or test workspace)
                    log.debug("Workspace ID is not a standard UUID: {}", workspaceId);
                }
            } else {
                log.warn("Invalid JWT provided for WebSocket session {}", session.getId());
            }
        }

        workspaceSessions.computeIfAbsent(workspaceId, k -> new ConcurrentHashMap<>()).put(peerId, session);
        sessionToPeer.put(session.getId(), new PeerMeta(session.getId(), peerId, peerName, workspaceId, authenticatedUserId));

        log.info("Peer joined: peerId={}, peerName={}, workspaceId={}, userId={}", peerId, peerName, workspaceId, authenticatedUserId);

        // 1. Send existing peer list back to the joining peer
        Map<String, WebSocketSession> peersInWs = workspaceSessions.get(workspaceId);
        List<Map<String, String>> existingPeers = new ArrayList<>();
        for (Map.Entry<String, WebSocketSession> entry : peersInWs.entrySet()) {
            if (!entry.getKey().equals(peerId) && entry.getValue().isOpen()) {
                PeerMeta meta = sessionToPeer.get(entry.getValue().getId());
                if (meta != null) {
                    existingPeers.add(Map.of(
                        "peerId", meta.peerId(),
                        "peerName", meta.peerName()
                    ));
                }
            }
        }

        Map<String, Object> peersMsg = Map.of(
            "type", "peers",
            "workspaceId", workspaceId,
            "peers", existingPeers
        );
        send(session, peersMsg);

        // 2. Notify other peers in this workspace that a new peer arrived
        Map<String, Object> joinedNotify = Map.of(
            "type", "peer-joined",
            "workspaceId", workspaceId,
            "peerId", peerId,
            "peerName", peerName
        );
        broadcastToWorkspace(workspaceId, peerId, joinedNotify);
    }

    private void handleTransferAnnounce(WebSocketSession session, SignalingMessage msg) {
        String transferId = msg.getTransferId();
        PeerMeta sender = sessionToPeer.get(session.getId());
        if (transferId != null && sender != null) {
            transferRegistry.put(transferId.toUpperCase().trim(), sender.peerId());
            log.info("Registered transfer code {} -> senderPeerId {}", transferId, sender.peerId());
        }
    }

    private void handleTransferRequest(WebSocketSession session, SignalingMessage msg) throws IOException {
        String transferId = msg.getTransferId();
        if (transferId == null) {
            send(session, Map.of("type", "error", "message", "transferId is required for transfer-request"));
            return;
        }

        String targetSenderPeerId = transferRegistry.get(transferId.toUpperCase().trim());
        if (targetSenderPeerId == null) {
            send(session, Map.of(
                "type", "error",
                "code", "TRANSFER_NOT_FOUND",
                "message", "Transfer Code " + transferId + " was not found. Please verify the code with the sender."
            ));
            return;
        }

        // Forward request directly to the sender peer
        PeerMeta receiver = sessionToPeer.get(session.getId());
        if (receiver != null) {
            msg.setSenderPeerId(receiver.peerId());
            msg.setSenderName(receiver.peerName());
            msg.setTargetPeerId(targetSenderPeerId);
            handleForward(msg);
        }
    }

    private void handleForward(SignalingMessage msg) throws IOException {
        String workspaceId = msg.getWorkspaceId();
        String targetPeerId = msg.getTargetPeerId();

        if (workspaceId == null || targetPeerId == null) {
            return;
        }

        Map<String, WebSocketSession> peers = workspaceSessions.get(workspaceId);
        if (peers != null) {
            WebSocketSession targetSession = peers.get(targetPeerId);
            if (targetSession != null && targetSession.isOpen()) {
                send(targetSession, msg);
            }
        }
    }

    private void handleBroadcast(WebSocketSession session, SignalingMessage msg) throws IOException {
        String workspaceId = msg.getWorkspaceId();
        if (workspaceId == null) {
            return;
        }
        PeerMeta sender = sessionToPeer.get(session.getId());
        if (sender != null) {
            msg.setSenderPeerId(sender.peerId());
            msg.setSenderName(sender.peerName());
        }
        if (msg.getTimestamp() == null) {
            msg.setTimestamp(System.currentTimeMillis());
        }
        broadcastToWorkspace(workspaceId, null, msg);
    }

    private void broadcastToWorkspace(String workspaceId, String excludePeerId, Object messageObj) throws IOException {
        Map<String, WebSocketSession> peers = workspaceSessions.get(workspaceId);
        if (peers == null) return;

        String json = objectMapper.writeValueAsString(messageObj);
        TextMessage textMessage = new TextMessage(json);

        for (Map.Entry<String, WebSocketSession> entry : peers.entrySet()) {
            if (excludePeerId == null || !entry.getKey().equals(excludePeerId)) {
                WebSocketSession s = entry.getValue();
                if (s.isOpen()) {
                    synchronized (s) {
                        s.sendMessage(textMessage);
                    }
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        PeerMeta meta = sessionToPeer.remove(session.getId());
        if (meta != null) {
            Map<String, WebSocketSession> peers = workspaceSessions.get(meta.workspaceId());
            if (peers != null) {
                peers.remove(meta.peerId());
                if (peers.isEmpty()) {
                    workspaceSessions.remove(meta.workspaceId());
                }
            }

            // Remove associated transfers
            transferRegistry.entrySet().removeIf(e -> e.getValue().equals(meta.peerId()));

            Map<String, Object> leaveNotify = Map.of(
                "type", "peer-left",
                "workspaceId", meta.workspaceId(),
                "peerId", meta.peerId()
            );
            broadcastToWorkspace(meta.workspaceId(), meta.peerId(), leaveNotify);
            log.info("Peer left: peerId={}, workspaceId={}", meta.peerId(), meta.workspaceId());
        }
    }

    private void send(WebSocketSession session, Object obj) throws IOException {
        if (session.isOpen()) {
            String json = objectMapper.writeValueAsString(obj);
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        }
    }

    private String extractTokenFromUri(URI uri) {
        if (uri == null || uri.getQuery() == null) return null;
        for (String param : uri.getQuery().split("&")) {
            String[] pair = param.split("=");
            if (pair.length == 2 && "token".equalsIgnoreCase(pair[0])) {
                return pair[1];
            }
        }
        return null;
    }
}
