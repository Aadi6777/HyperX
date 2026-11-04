import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String
  },
  userFullName: {
    type: String,
    required: true
  },
  userEmail: {
    type: String,
    default: ''
  },
  action: {
    type: String,
    required: true
  },
  details: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
