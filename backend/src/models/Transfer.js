import mongoose from 'mongoose';

const transferSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    index: true
  },
  transferCode: {
    type: String,
    uppercase: true,
    trim: true,
    index: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  totalChunks: {
    type: Number,
    default: 1
  },
  mimeType: {
    type: String,
    default: 'application/octet-stream'
  },
  senderPeerId: {
    type: String,
    required: true
  },
  senderName: {
    type: String,
    default: 'Anonymous Peer'
  },
  receiverPeerId: {
    type: String
  },
  receiverName: {
    type: String
  },
  checksum: {
    type: String
  },
  durationSeconds: {
    type: Number,
    default: 0
  },
  speedMBps: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['PENDING', 'STREAMING', 'COMPLETED', 'FAILED'],
    default: 'COMPLETED'
  },
  completedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const Transfer = mongoose.model('Transfer', transferSchema);

