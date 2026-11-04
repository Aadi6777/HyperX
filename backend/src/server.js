import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { SignalingServer } from './signaling/signalingServer.js';

import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import transferRoutes from './routes/transferRoutes.js';
import crdtRoutes from './routes/crdtRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Global CORS Middleware - allows local development and production Vercel frontends
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

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

// Root informational endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'HyperX Backend',
    version: '2.0.0',
    signaling: '/ws/signaling',
    health: '/api/v1/health',
    status: 'ONLINE'
  });
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

  server.listen(PORT, HOST, () => {
    console.log('===========================================================');
    console.log(`🚀 HyperX MERN Backend Server running on http://${HOST}:${PORT}`);
    console.log(`   - REST Health:       http://localhost:${PORT}/api/v1/health`);
    console.log(`   - REST Auth:         http://localhost:${PORT}/api/v1/auth`);
    console.log(`   - REST Rooms:        http://localhost:${PORT}/api/v1/rooms`);
    console.log(`   - REST CRDT:         http://localhost:${PORT}/api/v1/crdt`);
    console.log(`   - WebSocket Mesh:    ws://localhost:${PORT}/ws/signaling`);
    console.log('===========================================================');
  });
}

startServer().catch((err) => {
  console.error('[Fatal] Server failed to start:', err);
  process.exit(1);
});

export { app, server, signalingServer };
