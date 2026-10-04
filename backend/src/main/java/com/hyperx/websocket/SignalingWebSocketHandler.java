package com.hyperx.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class SignalingWebSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();

    // workspaceId -> (peerId -> WebSocketSession)
    private final Map<String, Map<String, WebSocketSession>> workspaceSessions = new ConcurrentHashMap<>();

    // sessionId -> PeerMeta
    private record PeerMeta(String sessionId, String peerId, String peerName, String workspaceId) {}
    private final Map<String, PeerMeta> sessionToPeer = new ConcurrentHashMap<>();

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
            default -> log.warn("Unknown message type: {}", type);
        }
    }

    private void handleJoin(WebSocketSession session, SignalingMessage msg) throws IOException {
        String workspaceId = msg.getWorkspaceId();
        String peerId = msg.getPeerId();
        String peerName = msg.getPeerName() != null ? msg.getPeerName() : "Anonymous Peer";

        if (workspaceId == null || peerId == null) {
            return;
        }

        workspaceSessions.computeIfAbsent(workspaceId, k -> new ConcurrentHashMap<>()).put(peerId, session);
        sessionToPeer.put(session.getId(), new PeerMeta(session.getId(), peerId, peerName, workspaceId));

        log.info("Peer joined: peerId={}, peerName={}, workspaceId={}", peerId, peerName, workspaceId);

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

    private void send(WebSocketSession session, Object messageObj) throws IOException {
        String json = objectMapper.writeValueAsString(messageObj);
        synchronized (session) {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(json));
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        PeerMeta meta = sessionToPeer.remove(session.getId());
        if (meta != null) {
            log.info("Peer disconnected: peerId={}, workspaceId={}", meta.peerId(), meta.workspaceId());
            Map<String, WebSocketSession> peers = workspaceSessions.get(meta.workspaceId());
            if (peers != null) {
                peers.remove(meta.peerId());
                if (peers.isEmpty()) {
                    workspaceSessions.remove(meta.workspaceId());
                } else {
                    Map<String, Object> leftMsg = Map.of(
                        "type", "peer-left",
                        "workspaceId", meta.workspaceId(),
                        "peerId", meta.peerId()
                    );
                    broadcastToWorkspace(meta.workspaceId(), meta.peerId(), leftMsg);
                }
            }
        }
    }
}
