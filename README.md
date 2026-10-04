# HyperX

> Process of HyperX

---

### The Problem HyperX Solves

Most web apps choke and crash when you drag and drop a large file. The browser tries to buffer the entire file into JavaScript memory (RAM), causing the tab to freeze, stutter, or outright crash with `Out of Memory` errors.

On top of that, traditional cloud storage services require uploading massive multi-gigabyte files to centralized servers first, paying high bandwidth costs, waiting twice for uploads and downloads, and creating privacy concerns.

**HyperX** takes a different approach:
- Files stream **directly between browsers peer-to-peer** via WebRTC DataChannels.
- The browser reads files slice-by-slice as sequential byte streams (`ReadableStream` & `WritableStream`), immediately feeding chunks into local `IndexedDB` storage with active backpressure control.
- Even if you stream **50GB+** files, browser RAM consumption stays flat and negligible.

---

### The Engineering Process of HyperX

We build HyperX step-by-step across 10 disciplined phases to ensure every layer is resilient, battle-tested, and interview-ready:

```
[Phase 1]  🟢 Foundation & Setup        (Spring Boot 3.3, React 18 + TS, PostgreSQL, Flyway V1)
[Phase 2]  🟢 Auth & Identity           (JWT, BCrypt, Stateless Security, RBAC)
[Phase 3]  🟢 Workspace Boundaries      (Multi-tenant isolation, roles, activity audit logs)
[Phase 4]  🟢 WebRTC Signaling Engine   (STUN/TURN, SDP offer/answer exchange via WebSockets)
[Phase 5]  🟢 Zero-RAM Chunk Engine     (Adaptive backpressure, 256KB–2MB dynamic chunking)
[Phase 6]  🟢 Local Chunk Cache         (Persistent IndexedDB assembly & file reconstruction)
[Phase 7]  🟢 Resumable Transfers       (Bitmask recovery, network reconnection handling)
[Phase 8]  🟢 End-to-End Encryption     (Client-side AES-256-GCM + SHA-256 verification)
[Phase 9]  🟢 Peer Collaboration        (Real-time chat, notifications, file annotations)
[Phase 10] 🟢 Production Deployment    (Vercel frontend, Dockerized backend, CI/CD)
```

---

### System Architecture at a Glance

```
  [ Sender Browser ]                               [ Receiver Browser ]
   ┌────────────────────────────────────────────────────────┐
   │ File Chunking (Streams API)                            │
   │ AES-256-GCM Web Crypto                                 │
   │ IndexedDB Local Cache                                  │
   └──────────┬─────────────────────────────────┬───────────┘
              │                                 │
              │  Direct WebRTC DataChannel      │
              │  (Bulk Encrypted P2P Chunks)    │
              └────────────────────────────────►│
                                                │
                                                ▼
                                         Stream Assembly
                                         SHA-256 Checksum
                                         IndexedDB File Save
                      ▲                 ▲
                      │                 │
              SDP/ICE │                 │ SDP/ICE
             Exchange │                 │ Exchange
                      ▼                 ▼
             ┌───────────────────────────────────┐
             │    Spring Boot Signaling Server   │
             │   (WebSocket / JWT / Workspaces)  │
             └─────────────────┬─────────────────┘
                               │
                               ▼
                       PostgreSQL 16
                   (Flyway Schema State)
```

---

### Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Vanilla CSS (cyber/glassmorphic theme).
- **Client Storage & Streaming**: WebRTC DataChannels, Streams API, IndexedDB, Web Crypto API.
- **Backend**: Java 21, Spring Boot 3.3, Spring Security, Spring WebSocket.
- **Database & Migrations**: PostgreSQL 16 managed strictly through versioned Flyway scripts (`V1__init.sql`).
- **Orchestration & Deploy**: Docker Compose, Vercel edge deployment ready.

---

### Getting Started Locally

#### 1. Clone the repository
```bash
git clone https://github.com/Aadi6777/HyperX.git
cd HyperX
```

#### 2. Start PostgreSQL via Docker
```bash
docker compose up -d postgres
```

#### 3. Run the Spring Boot Backend
```bash
cd backend
./mvnw spring-boot:run
```
*The backend runs on `http://localhost:8080`. Flyway automatically runs database migrations on startup.*

#### 4. Run the React Frontend
```bash
cd ../frontend
npm install
npm run dev
```
*Open `http://localhost:5173` to view the live dashboard and capability probes.*

---

### Deploying the Frontend to Vercel

HyperX is pre-configured with root and nested `vercel.json` configurations:

1. Import the repository `https://github.com/Aadi6777/HyperX` in your **Vercel Dashboard**.
2. Select `frontend` as the root directory (or keep the default root, which automatically runs `cd frontend && npm install && npm run build`).
3. Set `VITE_API_BASE_URL` to your backend signaling server URL.
4. Click **Deploy**.

---

### Current Status: All 10 Phases Complete 🚀

- [x] **Phase 1: Project Setup & Baseline**
  - Database schema & Flyway migrations for `users`, `workspaces`, `members`
  - Health diagnostic API (`/api/v1/health`)
  - Stateless security & CORS configuration
  - React + Vite dashboard with live hardware and browser capability probes
- [x] **Phase 2: Authentication & Identity Management**
  - BCrypt password hashing, stateless JWT issuance and verification
  - User registration, login, and `/api/v1/auth/me` endpoints
- [x] **Phase 3: Workspace Boundaries & Multi-tenancy**
  - Workspace creation with slug isolation, member roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`)
  - Real-time audit trail and file transfer logging (`activity_logs`, `transfer_records`)
- [x] **Phase 4: WebRTC Signaling Engine**
  - Spring WebSocket signaling handler (`/ws/signaling`)
  - STUN/TURN integration, SDP offer/answer exchanges, and ICE candidate negotiation
- [x] **Phase 5: Zero-RAM Chunk Engine**
  - Dynamic chunking (512KB slices) with Web Streams API
  - Active backpressure control via `bufferedAmount` & `bufferedamountlow`
- [x] **Phase 6: Local Chunk Cache**
  - Client-side IndexedDB persistence (`HyperX_ChunkStorage`)
  - Safe byte reconstruction and direct file assembly without browser RAM spikes
- [x] **Phase 7: Resumable Transfers**
  - Bitmask chunk tracker and recovery protocol
  - Pause, resume, and partial transfer completion
- [x] **Phase 8: End-to-End Encryption**
  - Client-side AES-256-GCM encryption with PBKDF2 key derivation
  - Real-time SHA-256 integrity verification
- [x] **Phase 9: Peer Collaboration**
  - Real-time workspace chat with live online peer presence
  - Chunk heatmap visualizer and audit trail viewer
- [x] **Phase 10: Production Deployment**
  - Multi-stage Dockerfile for Spring Boot Backend & React Frontend (Nginx SPA)
  - Full Docker Compose orchestration and Vercel edge deployment configuration

