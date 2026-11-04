import { isConnectedToMongo, activeDatabaseType } from '../config/db.js';

export function getHealth(req, res) {
  const dbStatus = isConnectedToMongo ? 'CONNECTED (MongoDB)' : 'CONNECTED (Resilient In-Memory Mesh)';

  return res.json({
    status: 'UP',
    service: 'Nexora Backend',
    version: '2.0.0',
    database: dbStatus,
    activeDatabaseType,
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    memoryUsageMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    timestamp: new Date().toISOString()
  });
}
