import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  email: { type: String, default: '' },
  fullName: { type: String, required: true },
  role: { type: String, enum: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'], default: 'MEMBER' },
  joinedAt: { type: Date, default: Date.now }
}, { _id: true });

const roomSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    lowercase: true,
    trim: true
  },
  ownerId: {
    type: String,
    required: true
  },
  ownerName: {
    type: String,
    required: true
  },
  members: [memberSchema],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const Room = mongoose.model('Room', roomSchema);
