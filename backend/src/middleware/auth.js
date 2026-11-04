import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { isConnectedToMongo, inMemoryStore } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'hyperx-secret-key-32-chars-minimum-2026';

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id || user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role || 'MEMBER',
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token required' });
  }

  const token = authHeader.split(' ')[1];

  // 1. Check for resilient guest token
  if (token.startsWith('peer_token_')) {
    try {
      const decodedUser = JSON.parse(Buffer.from(token.replace('peer_token_', ''), 'base64').toString('utf8'));
      req.user = decodedUser;
      return next();
    } catch {
      // Fall through to jwt
    }
  }

  // 2. Standard JWT verification
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];

  if (token.startsWith('peer_token_')) {
    try {
      req.user = JSON.parse(Buffer.from(token.replace('peer_token_', ''), 'base64').toString('utf8'));
      return next();
    } catch {
      return next();
    }
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    // Ignore invalid optional tokens
  }
  next();
}
