# Nexora

> High-Speed Zero-RAM P2P Streaming & Real-Time Collaboration Platform

---

### The Problem Nexora Solves

Traditional web file-sharing platforms buffer large payloads directly into browser JavaScript heap memory, causing tabs to freeze, stutter, and crash with `Out of Memory` (OOM) errors when handling files over a few gigabytes. Furthermore, uploading multi-gigabyte files to centralized cloud servers consumes heavy bandwidth, incurs egress costs, and introduces latency and privacy risks.

**Nexora takes an architectural approach built for scale:**
- **Direct P2P Streaming**: Files stream directly browser-to-browser over native WebRTC DataChannels with STUN/TURN ICE negotiation.
- **Zero-RAM Slicing**: Files are read slice-by-slice as sequential 64KB byte streams with dynamic backpressure (`bufferedAmountLow`), immediately writing into local `IndexedDB` storage with constant $O(1)$ flatline memory consumption.
- **End-to-End Encryption**: Every transfer is encrypted client-side using Web Crypto API (`AES-256-GCM`) with SHA-256 checksum verification.
- **Real-Time Collaboration**: Peer rooms feature synchronized live notes, shared clipboard syncing, and instant QR-code room invites.
- **Resilient Persistence**: Powered by MongoDB with an automatic embedded in-memory fallback engine so the platform boots instantly under any environment.

---

### Architecture & Tech Stack

- **Backend (Node.js & Express)**:
  - High-throughput REST API (`/api/v1/health`, `/api/v1/auth`, `/api/v1/rooms`, `/api/v1/transfers`, `/api/v1/crdt`).
  - Native WebSocket Signaling (`ws`): Peer discovery, SDP offer/answer exchange, and ICE candidate negotiation with strict room isolation.
  - JWT Authentication: Cryptographically signed stateless access tokens with BCrypt password hashing.
  - MongoDB & Mongoose: User accounts, persistent room records, transfer audit logs, and document states.
  - Embedded In-Memory Engine: Resilient automatic fallback if MongoDB is not connected.
- **Frontend (React 18 & TypeScript / Vite)**:
  - Responsive Bauhaus UI with real-time transfer telemetry and HUD dashboards.
  - Pure native `RTCPeerConnection` and `RTCDataChannel` streaming engine.
  - Client-side AES-256-GCM encryption with browser Web Crypto API.
  - Chunked `IndexedDB` storage cache with range-based resume protocol.

---

### System Architecture Diagram

```
   [ Sender Browser ]                               [ Receiver Browser ]
    ┌────────────────────────────────────────────────────────┐
    │ 64KB Stream Slicing & Backpressure Control             │
    │ Client-Side AES-256-GCM Web Crypto                     │
    │ Persistent IndexedDB Chunk Storage                     │
    │ Real-Time Collaborative Notes & Clipboard              │
    └──────────┬─────────────────────────────────┬───────────┘
               │                                 │
               │  Direct WebRTC DataChannel      │
               │  (Encrypted P2P Binary Stream)  │
               └────────────────────────────────►│
                                                 │
                                                 ▼
                                          Stream Assembly
                                          SHA-256 Checksum
                                          IndexedDB File Save
                        ▲                 ▲
                        │                 │
                SDP/ICE │                 │ SDP/ICE
             Signaling  │                 │ Signaling
                        ▼                 ▼
              ┌─────────────────────────────────────┐
              │    Node.js / Express Signaling      │
              │  (WebSocket / JWT / Room Isolation) │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
                           MongoDB / Atlas
                    (Resilient In-Memory Fallback)
```

---

### Quick Start

#### 1. Clone the repository
```bash
git clone https://github.com/Aadi6777/HyperX.git
cd HyperX
```

#### 2. Run with One Command
```bash
./start.sh
```
*Or using npm:*
```bash
npm run dev
```

Both services start simultaneously:
- **Frontend App**: `http://localhost:5173`
- **Backend Health API**: `http://localhost:8080/api/v1/health`
- **WebSocket Signaling**: `ws://localhost:8080/ws/signaling`

#### 3. Run Automated Test Suite
```bash
npm test
```
Runs 7 comprehensive backend integration tests covering health diagnostics, registration, authentication security, room creation, document persistence, and WebSocket signaling.

---

### Deployment on Render (Unified Full-Stack)

1. Connect your repository to Render as a **Web Service**.
2. Settings:
   - **Root Directory**: Leave blank / empty
   - **Runtime**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
3. The Express backend serves both the React application bundle and the WebSocket signaling engine 24/7 on a single domain with zero configuration.

---

### Docker Compose

```bash
docker compose up --build
```
Spins up:
1. `nexora-mongo`: MongoDB 7 container
2. `nexora-backend`: Node.js Express & WebSocket signaling server
3. `nexora-frontend`: React production build served via Nginx
