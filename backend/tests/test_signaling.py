import pytest
from starlette.testclient import TestClient
from app.main import app

def test_websocket_signaling_full_lifecycle():
    client = TestClient(app)
    with client.websocket_connect("/ws/signaling") as ws1:
        # 1. Alice joins
        ws1.send_json({
            "type": "join",
            "workspaceId": "test-ws-room",
            "peerId": "peer-alice",
            "peerName": "Alice"
        })
        
        # Expect empty peers list initially
        resp = ws1.receive_json()
        assert resp["type"] == "peers"
        assert resp["workspaceId"] == "test-ws-room"
        assert isinstance(resp["peers"], list)
        assert len(resp["peers"]) == 0

        # 2. Bob joins
        with client.websocket_connect("/ws/signaling") as ws2:
            ws2.send_json({
                "type": "join",
                "workspaceId": "test-ws-room",
                "peerId": "peer-bob",
                "peerName": "Bob"
            })
            
            # Bob receives Alice in peers
            resp_bob = ws2.receive_json()
            assert resp_bob["type"] == "peers"
            assert any(p["peerId"] == "peer-alice" for p in resp_bob["peers"])

            # Alice receives peer-joined for Bob
            resp_alice = ws1.receive_json()
            assert resp_alice["type"] == "peer-joined"
            assert resp_alice["peerId"] == "peer-bob"

            # 3. Alice announces transfer code
            ws1.send_json({
                "type": "transfer-announce",
                "workspaceId": "test-ws-room",
                "transferId": "HX-DEMO-99"
            })
            ack = ws1.receive_json()
            assert ack["type"] == "transfer-registered"
            assert ack["transferId"] == "HX-DEMO-99"

            # 4. Bob requests transfer code
            ws2.send_json({
                "type": "transfer-request",
                "workspaceId": "test-ws-room",
                "transferId": "HX-DEMO-99"
            })

            # Alice receives forwarded transfer-request
            fwd = ws1.receive_json()
            assert fwd["type"] == "transfer-request"
            assert fwd["senderPeerId"] == "peer-bob"

            # 5. Alice accepts transfer (testing auto-injected senderPeerId)
            ws1.send_json({
                "type": "transfer-accept",
                "workspaceId": "test-ws-room",
                "transferId": "HX-DEMO-99",
                "targetPeerId": "peer-bob",
                "manifest": {"fileName": "video.mp4", "fileSize": 1024}
            })
            accept_msg = ws2.receive_json()
            assert accept_msg["type"] == "transfer-accept"
            assert accept_msg["senderPeerId"] == "peer-alice"
            assert accept_msg["manifest"]["fileName"] == "video.mp4"

            # 6. Bob sends WebRTC offer to Alice
            ws2.send_json({
                "type": "offer",
                "workspaceId": "test-ws-room",
                "targetPeerId": "peer-alice",
                "sdp": {"type": "offer", "sdp": "v=0 mock sdp"}
            })
            offer_msg = ws1.receive_json()
            assert offer_msg["type"] == "offer"
            assert offer_msg["senderPeerId"] == "peer-bob"

            # 7. Alice replies with WebRTC answer
            ws1.send_json({
                "type": "answer",
                "workspaceId": "test-ws-room",
                "targetPeerId": "peer-bob",
                "sdp": {"type": "answer", "sdp": "v=0 mock answer"}
            })
            answer_msg = ws2.receive_json()
            assert answer_msg["type"] == "answer"
            assert answer_msg["senderPeerId"] == "peer-alice"

            # 8. ICE Candidate exchange
            ws2.send_json({
                "type": "ice-candidate",
                "workspaceId": "test-ws-room",
                "targetPeerId": "peer-alice",
                "candidate": {"candidate": "candidate:1 1 UDP ..."}
            })
            candidate_msg = ws1.receive_json()
            assert candidate_msg["type"] == "ice-candidate"
            assert candidate_msg["senderPeerId"] == "peer-bob"

            # 9. Bitmask sync exchange
            ws1.send_json({
                "type": "bitmask-sync",
                "workspaceId": "test-ws-room",
                "targetPeerId": "peer-bob",
                "completedChunks": [0, 1, 2]
            })
            bitmask_msg = ws2.receive_json()
            assert bitmask_msg["type"] == "bitmask-sync"
            assert bitmask_msg["completedChunks"] == [0, 1, 2]

            # 10. Workspace Chat Broadcast
            ws2.send_json({
                "type": "chat",
                "workspaceId": "test-ws-room",
                "text": "Hello Alice!"
            })
            chat_msg = ws1.receive_json()
            assert chat_msg["type"] == "chat"
            assert chat_msg["senderPeerId"] == "peer-bob"
            assert chat_msg["text"] == "Hello Alice!"

            # 11. Bob sends leave message
            ws2.send_json({
                "type": "leave"
            })
        
        # After Bob disconnects/leaves, Alice receives peer-left
        left_msg = ws1.receive_json()
        assert left_msg["type"] == "peer-left"
        assert left_msg["peerId"] == "peer-bob"
