import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import { SignalingServer } from './signaling/signalingServer.js';

import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import transferRoutes from './routes/transferRoutes.js';
import crdtRoutes from './routes/crdtRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Global CORS Middleware - allows cross-origin requests when running separate dev servers
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Request logging middleware
app.use((req, res, next) => {
  if (req.path !== '/api/v1/health') {
    console.log(`[HTTP] ${req.method} ${req.path}`);
  }
  next();
});

// REST API Routes
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/rooms', roomRoutes);
app.use('/api/v1/workspaces', roomRoutes); // Alias for seamless backward compatibility
app.use('/api/v1/transfers', transferRoutes);
app.use('/api/v1/crdt', crdtRoutes);

// Static assets & SPA fallback for production deployment
if (fs.existsSync(frontendDist)) {
  console.log(`[Static] Serving frontend static assets from: ${frontendDist}`);
  app.use(express.static(frontendDist));

  // SPA fallback for non-API client routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    const indexPath = path.join(frontendDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    next();
  });
} else {
  // Informational endpoint when running backend standalone without frontend build
  app.get('/', (req, res) => {
    res.json({
      service: 'Nexora Platform',
      version: '2.0.0',
      signaling: '/ws/signaling',
      health: '/api/v1/health',
      status: 'ONLINE',
      note: 'Frontend dist not found. Run "npm run build" to build frontend.'
    });
  });
}

// 404 handler for unmatched API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ message: `API route ${req.method} ${req.path} not found` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Error] Unhandled request error:', err);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

// Create HTTP and WebSocket Server
const server = http.createServer(app);
const signalingServer = new SignalingServer(server);

// Boot server
async function startServer() {
  await connectDB();

  return new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      console.log('===========================================================');
      console.log(`🚀 Nexora Backend Server running on http://${HOST}:${PORT}`);
      console.log(`   - REST Health:       http://localhost:${PORT}/api/v1/health`);
      console.log(`   - REST Auth:         http://localhost:${PORT}/api/v1/auth`);
      console.log(`   - REST Rooms:        http://localhost:${PORT}/api/v1/rooms`);
      console.log(`   - REST CRDT:         http://localhost:${PORT}/api/v1/crdt`);
      console.log(`   - WebSocket Mesh:    ws://localhost:${PORT}/ws/signaling`);
      console.log('===========================================================');
      resolve();
    });
  });
}

const serverReady = startServer().catch((err) => {
  console.error('[Fatal] Server failed to start:', err);
  process.exit(1);
});

export { app, server, signalingServer, serverReady };
