# HyperX

> High-Speed Zero-RAM P2P Streaming & Real-Time CRDT Swarm Collaboration Platform

---

### The Problem HyperX Solves

Most web file-sharing solutions choke and crash when you drop a large file. The browser buffers the entire payload into JavaScript heap RAM, causing the tab to freeze, stutter, or outright crash with `Out of Memory` errors.

Centralized cloud storage also requires uploading massive multi-gigabyte files to intermediary servers first, paying high egress costs, waiting twice for uploads and downloads, and creating privacy concerns.

**HyperX takes a radically different approach:**
- Files stream **directly between browsers peer-to-peer** via native WebRTC DataChannels.
- The browser reads files slice-by-slice as sequential byte streams (`ReadableStream` & `WritableStream`), immediately feeding chunks into local `IndexedDB` storage with active backpressure control.
- Even if you stream **50GB+** files, browser RAM consumption stays completely flat and negligible.
- Peers in a room can collaborate simultaneously on a live **Conflict-Free Replicated Data Type (CRDT) scratchpad**, share code, exchange notes, and transfer files across the swarm.

---

### Architecture & Tech Stack

HyperX is built on a modern high-performance full-stack architecture:

- **MongoDB & Mongoose**:
  - `User`: BCrypt password hashing, JWT stateless authentication, usage metrics.
  - `Room` / `Workspace`: Dynamic room code routing (e.g. `#room=K7M2QX9P`), membership roles, and isolation.
  - `Transfer`: Granular transfer audit trail (filename, size, chunks, checksum, duration, speed, sender, receiver).
  - `CrdtDoc`: Real-time collaborative scratchpad persistence with version tracking.
  - *Zero-Failure Resilience*: Auto-detects local/Atlas MongoDB; automatically falls back to an embedded high-speed in-memory store if the daemon is offline so the app always boots cleanly.
- **Express.js**:
  - High-throughput REST API (`/api/v1/health`, `/api/v1/auth`, `/api/v1/rooms`, `/api/v1/transfers`, `/api/v1/crdt`).
  - CORS, JSON streaming parsers, and security middleware.
- **React 18 & TypeScript (Vite)**:
  - Cyber-glassmorphism Bauhaus UI.
  - WebRTC DataChannels, Web Streams API, IndexedDB chunk cache, and Web Crypto API (AES-256-GCM).
- **Node.js & WebSockets (`ws`)**:
  - High-performance unified HTTP + WebSocket server running on port `8080`.
  - Room mesh presence, SDP offer/answer/ICE candidate routing, and **Automatic Signaling Relay Fallback** if direct UDP/STUN is blocked.

---

### How HyperX Differs from HyperLink (Competitive Analysis)

| Feature | HyperLink (Friend's Reference) | **HyperX (Our Project)** |
| :--- | :--- | :--- |
| **Tech Stack** | Next.js 15 + Supabase (PostgreSQL) + PeerJS | **Node.js, Express, MongoDB & React Native Engine** |
| **WebRTC Core** | Third-party PeerJS library wrapper | **Pure Native `RTCPeerConnection` with Perfect Negotiation** |
| **Symmetric NAT Handling** | None (Fails/aborts if direct P2P fails) | **Automatic WebSocket Signaling Relay Fallback (Zero Aborts)** |
| **Collaboration** | Single 1-to-1 file drop only | **Multi-Peer Swarm + Real-time Collaborative CRDT Scratchpad** |
| **Chunking & Flow Control** | Standard file slices | **64KB Adaptive Dynamic Backpressure (`bufferedAmountLow`)** |
| **Resumability** | Basic state | **Bitmask Ranges (`have` / `want`) Recovery Protocol** |
| **Database Lock-in** | Supabase Cloud dependent | **Self-contained MongoDB + Automatic In-Memory Fallback** |

---

### System Architecture Diagram

```
   [ Sender Browser ]                               [ Receiver Browser ]
    ┌────────────────────────────────────────────────────────┐
    │ File Slicing (Streams API - 64KB chunks)               │
    │ Client-Side AES-256-GCM Web Crypto                     │
    │ Persistent IndexedDB Chunk Storage                     │
    │ Live CRDT Scratchpad Editor                            │
    └──────────┬─────────────────────────────────┬───────────┘
               │                                 │
               │  Direct WebRTC DataChannel      │
               │  (Primary Bulk Encrypted P2P)   │
               └────────────────────────────────►│
                                                 │
                                                 ▼
                                          Stream Assembly
                                          SHA-256 Checksum
                                          IndexedDB File Save
                        ▲                 ▲
                        │                 │
                SDP/ICE │                 │ SDP/ICE
                + Relay │                 │ + Relay
                        ▼                 ▼
              ┌─────────────────────────────────────┐
              │    Node.js / Express Signaling      │
              │   (WebSocket / JWT / Rooms / CRDT)  │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
                           MongoDB 7.0
                    (Mongoose Schema Models)
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

Both servers will start simultaneously:
- **Frontend App**: `http://localhost:5173`
- **Backend API**: `http://localhost:8080/api/v1/health`
- **Signaling Mesh**: `ws://localhost:8080/ws/signaling`

#### 3. Run Backend Automated Test Suite
```bash
npm test
```

---

### Docker Compose (Full Stack)

```bash
docker compose up --build
```
Spins up:
1. `hyperx-mongo`: MongoDB 7 container
2. `hyperx-backend`: Node.js Express & WebSocket server
3. `hyperx-frontend`: React 18 production build served via Nginx
