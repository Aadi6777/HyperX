import mongoose from 'mongoose';

const crdtDocSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    default: 'Room Scratchpad'
  },
  content: {
    type: String,
    default: ''
  },
  version: {
    type: Number,
    default: 1
  },
  lastModifiedBy: {
    type: String,
    default: 'Peer'
  },
  lastModifiedPeerId: {
    type: String
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export const CrdtDoc = mongoose.model('CrdtDoc', crdtDocSchema);

