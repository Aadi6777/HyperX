import { Room } from '../models/Room.js';
import { isConnectedToMongo, inMemoryStore } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateShortCode(len = 8) {
  let code = '';
  for (let i = 0; i < len; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

export async function getRooms(req, res) {
  try {
    if (isConnectedToMongo) {
      const rooms = await Room.find().sort({ createdAt: -1 }).limit(50);
      return res.json(rooms.map(r => ({
        id: r._id.toString(),
        code: r.code,
        name: r.name,
        slug: r.slug,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        currentUserRole: req.user ? (r.ownerId === req.user.id ? 'OWNER' : 'MEMBER') : 'MEMBER',
        memberCount: r.members?.length || 1,
        createdAt: r.createdAt
      })));
    }

    // In-memory fallback
    const list = Array.from(inMemoryStore.rooms.values()).map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      slug: r.slug,
      ownerId: r.ownerId,
      ownerName: r.ownerName,
      currentUserRole: req.user ? (r.ownerId === req.user.id ? 'OWNER' : 'MEMBER') : 'MEMBER',
      memberCount: r.members?.length || 1,
      createdAt: r.createdAt
    }));
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: 'Error retrieving rooms', error: err.message });
  }
}

export async function createRoom(req, res) {
  try {
    const { name, code } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Room name is required' });
    }

    const roomCode = (code ? code.trim().toUpperCase() : generateShortCode(8));
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const ownerId = req.user?.id || 'peer_guest_' + uuidv4().substring(0, 6);
    const ownerName = req.user?.fullName || 'Guest Operator';

    if (isConnectedToMongo) {
      const existing = await Room.findOne({ code: roomCode });
      if (existing) {
        return res.status(400).json({ message: 'A room with this code already exists' });
      }

      const room = new Room({
        code: roomCode,
        name: name.trim(),
        slug,
        ownerId,
        ownerName,
        members: [{
          userId: ownerId,
          email: req.user?.email || '',
          fullName: ownerName,
          role: 'OWNER',
          joinedAt: new Date()
        }]
      });
      await room.save();

      return res.status(201).json({
        id: room._id.toString(),
        code: room.code,
        name: room.name,
        slug: room.slug,
        ownerId: room.ownerId,
        ownerName: room.ownerName,
        currentUserRole: 'OWNER',
        memberCount: 1,
        createdAt: room.createdAt
      });
    }

    // In-memory fallback
    const newRoom = {
      id: 'room_' + uuidv4().substring(0, 8),
      code: roomCode,
      name: name.trim(),
      slug,
      ownerId,
      ownerName,
      members: [{
        id: 'm_' + uuidv4().substring(0, 6),
        userId: ownerId,
        email: req.user?.email || '',
        fullName: ownerName,
        role: 'OWNER',
        joinedAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString()
    };
    inMemoryStore.rooms.set(newRoom.id, newRoom);
    inMemoryStore.rooms.set(newRoom.code, newRoom);

    return res.status(201).json({
      id: newRoom.id,
      code: newRoom.code,
      name: newRoom.name,
      slug: newRoom.slug,
      ownerId: newRoom.ownerId,
      ownerName: newRoom.ownerName,
      currentUserRole: 'OWNER',
      memberCount: 1,
      createdAt: newRoom.createdAt
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error creating room', error: err.message });
  }
}

export async function getMembers(req, res) {
  try {
    const { id } = req.params;
    if (isConnectedToMongo) {
      const room = await Room.findById(id).catch(() => Room.findOne({ code: id.toUpperCase() }));
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      return res.json(room.members);
    }

    const room = inMemoryStore.rooms.get(id) || inMemoryStore.rooms.get(id.toUpperCase());
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    return res.json(room.members);
  } catch (err) {
    return res.status(500).json({ message: 'Error fetching members', error: err.message });
  }
}

export async function addMember(req, res) {
  try {
    const { id } = req.params;
    const { email, role = 'MEMBER' } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const cleanName = email.split('@')[0].replace(/[._-]/g, ' ');
    const memberName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

    if (isConnectedToMongo) {
      const room = await Room.findById(id).catch(() => Room.findOne({ code: id.toUpperCase() }));
      if (!room) return res.status(404).json({ message: 'Room not found' });

      room.members.push({
        userId: 'usr_' + uuidv4().substring(0, 8),
        email: email.toLowerCase(),
        fullName: memberName,
        role,
        joinedAt: new Date()
      });
      await room.save();
      return res.status(201).json(room.members[room.members.length - 1]);
    }

    const room = inMemoryStore.rooms.get(id) || inMemoryStore.rooms.get(id.toUpperCase());
    if (!room) return res.status(404).json({ message: 'Room not found' });

    const newMem = {
      id: 'm_' + uuidv4().substring(0, 6),
      userId: 'usr_' + uuidv4().substring(0, 8),
      email: email.toLowerCase(),
      fullName: memberName,
      role,
      joinedAt: new Date().toISOString()
    };
    room.members.push(newMem);
    return res.status(201).json(newMem);
  } catch (err) {
    return res.status(500).json({ message: 'Error adding member', error: err.message });
  }
}
