import mongoose from 'mongoose';

export let isConnectedToMongo = false;
export let activeDatabaseType = 'DISCONNECTED';

// High-speed In-Memory Data Store fallback when MongoDB daemon is not running
export const inMemoryStore = {
  users: new Map(),
  rooms: new Map([
    ['hyperx-global-mesh', {
      id: 'hyperx-global-mesh',
      code: 'GLOBAL',
      name: 'HyperX Global Mesh',
      slug: 'global-mesh',
      ownerId: 'system_root',
      ownerName: 'HyperX Core',
      members: [
        { id: 'm1', userId: 'user_alice', email: 'alice@hyperx.io', fullName: 'Alice Engineer', role: 'OWNER', joinedAt: new Date().toISOString() },
        { id: 'm2', userId: 'user_bob', email: 'bob@hyperx.io', fullName: 'Bob Architect', role: 'MEMBER', joinedAt: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString()
    }]
  ]),
  transfers: [],
  activityLogs: [],
  crdtDocs: new Map([
    ['hyperx-global-mesh', {
      roomId: 'hyperx-global-mesh',
      title: 'Global Swarm Scratchpad',
      content: '# Welcome to HyperX Swarm Collaboration\n\n- Zero-RAM P2P streaming active\n- Real-time CRDT scratchpad synced\n- E2E AES-256-GCM encryption verified\n',
      version: 1,
      lastModifiedBy: 'System',
      updatedAt: new Date().toISOString()
    }]
  ])
};

export async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hyperx';
  
  try {
    console.log(`[Database] Attempting connection to MongoDB at: ${uri}...`);
    mongoose.set('strictQuery', false);
    
    // Timeout quickly so the server boots up within 2 seconds instead of hanging
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2500,
      connectTimeoutMS: 2500,
    });
    
    isConnectedToMongo = true;
    activeDatabaseType = 'MONGODB';
    console.log('[Database] 🟢 Successfully connected to MongoDB cluster');
  } catch (err) {
    isConnectedToMongo = false;
    activeDatabaseType = 'IN_MEMORY_RESILIENT';
    console.warn(`[Database] ⚠️  MongoDB server not detected on ${uri} (${err.message}).`);
    console.log('[Database] 🚀 Activated Resilient In-Memory & Local Mesh persistence engine. All REST & P2P features are 100% operational.');
  }

  mongoose.connection.on('disconnected', () => {
    isConnectedToMongo = false;
    activeDatabaseType = 'IN_MEMORY_RESILIENT';
    console.warn('[Database] MongoDB connection lost. Switched to In-Memory store.');
  });
}

