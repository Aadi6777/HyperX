import { Transfer } from '../models/Transfer.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { isConnectedToMongo, inMemoryStore } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

export async function recordTransfer(req, res) {
  try {
    const {
      roomId = 'hyperx-global-mesh',
      transferCode,
      fileName,
      fileSize,
      totalChunks = 1,
      mimeType,
      senderPeerId = 'unknown',
      senderName = 'Peer',
      receiverPeerId,
      receiverName,
      checksum,
      durationSeconds = 0,
      speedMBps = 0,
      status = 'COMPLETED'
    } = req.body;

    if (!fileName || fileSize === undefined) {
      return res.status(400).json({ message: 'fileName and fileSize are required' });
    }

    if (isConnectedToMongo) {
      const record = new Transfer({
        roomId,
        transferCode,
        fileName,
        fileSize,
        totalChunks,
        mimeType,
        senderPeerId,
        senderName,
        receiverPeerId,
        receiverName,
        checksum,
        durationSeconds,
        speedMBps,
        status,
        completedAt: new Date()
      });
      await record.save();

      // Log activity
      const log = new ActivityLog({
        roomId,
        userId: req.user?.id,
        userFullName: req.user?.fullName || senderName,
        userEmail: req.user?.email || '',
        action: 'FILE_TRANSFER_COMPLETE',
        details: `Successfully transferred ${fileName} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`
      });
      await log.save();

      return res.status(201).json(record);
    }

    // In-memory fallback
    const memRecord = {
      id: 'tx_' + uuidv4().substring(0, 8),
      roomId,
      transferCode,
      fileName,
      fileSize,
      totalChunks,
      mimeType,
      senderPeerId,
      senderName,
      receiverPeerId,
      receiverName,
      checksum,
      durationSeconds,
      speedMBps,
      status,
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    inMemoryStore.transfers.unshift(memRecord);

    const memLog = {
      id: 'act_' + uuidv4().substring(0, 8),
      roomId,
      userId: req.user?.id,
      userFullName: req.user?.fullName || senderName,
      userEmail: req.user?.email || '',
      action: 'FILE_TRANSFER_COMPLETE',
      details: `Successfully transferred ${fileName} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`,
      createdAt: new Date().toISOString()
    };
    inMemoryStore.activityLogs.unshift(memLog);

    return res.status(201).json(memRecord);
  } catch (err) {
    return res.status(500).json({ message: 'Error recording transfer', error: err.message });
  }
}

export async function getTransfers(req, res) {
  try {
    const { roomId } = req.query;
    if (isConnectedToMongo) {
      const query = roomId ? { roomId } : {};
      const list = await Transfer.find(query).sort({ createdAt: -1 }).limit(100);
      return res.json(list);
    }

    let list = inMemoryStore.transfers;
    if (roomId) {
      list = list.filter(t => t.roomId === roomId);
    }
    return res.json(list.slice(0, 100));
  } catch (err) {
    return res.status(500).json({ message: 'Error fetching transfers', error: err.message });
  }
}

export async function getActivityLogs(req, res) {
  try {
    const { roomId } = req.query;
    if (isConnectedToMongo) {
      const query = roomId ? { roomId } : {};
      const logs = await ActivityLog.find(query).sort({ createdAt: -1 }).limit(100);
      return res.json(logs);
    }

    let logs = inMemoryStore.activityLogs;
    if (roomId) {
      logs = logs.filter(l => l.roomId === roomId);
    }
    return res.json(logs.slice(0, 100));
  } catch (err) {
    return res.status(500).json({ message: 'Error fetching activity logs', error: err.message });
  }
}

