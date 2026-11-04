import { CrdtDoc } from '../models/CrdtDoc.js';
import { isConnectedToMongo, inMemoryStore } from '../config/db.js';

export async function getCrdtDoc(req, res) {
  try {
    const { roomId } = req.params;
    if (!roomId) {
      return res.status(400).json({ message: 'roomId parameter is required' });
    }

    if (isConnectedToMongo) {
      let doc = await CrdtDoc.findOne({ roomId });
      if (!doc) {
        doc = new CrdtDoc({
          roomId,
          title: `Room ${roomId.toUpperCase()} Scratchpad`,
          content: `# Collaborative Swarm Scratchpad (${roomId.toUpperCase()})\n\n- Real-time CRDT updates sync instantly to all peers\n- Paste notes, code, magnet links, or checksums\n`,
          version: 1,
          lastModifiedBy: 'System'
        });
        await doc.save();
      }
      return res.json(doc);
    }

    // In-memory fallback
    let doc = inMemoryStore.crdtDocs.get(roomId);
    if (!doc) {
      doc = {
        roomId,
        title: `Room ${roomId.toUpperCase()} Scratchpad`,
        content: `# Collaborative Swarm Scratchpad (${roomId.toUpperCase()})\n\n- Real-time CRDT updates sync instantly to all peers\n- Paste notes, code, magnet links, or checksums\n`,
        version: 1,
        lastModifiedBy: 'System',
        updatedAt: new Date().toISOString()
      };
      inMemoryStore.crdtDocs.set(roomId, doc);
    }
    return res.json(doc);
  } catch (err) {
    return res.status(500).json({ message: 'Error retrieving CRDT document', error: err.message });
  }
}

export async function updateCrdtDoc(req, res) {
  try {
    const { roomId } = req.params;
    const { content, title, modifiedBy, peerId, version } = req.body;

    if (content === undefined && title === undefined) {
      return res.status(400).json({ message: 'content or title must be provided' });
    }

    if (isConnectedToMongo) {
      let doc = await CrdtDoc.findOne({ roomId });
      if (!doc) {
        doc = new CrdtDoc({ roomId });
      }
      if (content !== undefined) doc.content = content;
      if (title !== undefined) doc.title = title;
      if (version !== undefined) doc.version = version;
      doc.lastModifiedBy = modifiedBy || req.user?.fullName || 'Peer';
      if (peerId) doc.lastModifiedPeerId = peerId;
      doc.updatedAt = new Date();
      await doc.save();
      return res.json(doc);
    }

    let doc = inMemoryStore.crdtDocs.get(roomId) || { roomId, version: 1 };
    if (content !== undefined) doc.content = content;
    if (title !== undefined) doc.title = title;
    if (version !== undefined) doc.version = version;
    doc.lastModifiedBy = modifiedBy || req.user?.fullName || 'Peer';
    if (peerId) doc.lastModifiedPeerId = peerId;
    doc.updatedAt = new Date().toISOString();
    inMemoryStore.crdtDocs.set(roomId, doc);

    return res.json(doc);
  } catch (err) {
    return res.status(500).json({ message: 'Error updating CRDT document', error: err.message });
  }
}
