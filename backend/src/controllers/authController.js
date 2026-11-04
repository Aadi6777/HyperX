import { User } from '../models/User.js';
import { isConnectedToMongo, inMemoryStore } from '../config/db.js';
import { signToken } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export async function register(req, res) {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ message: 'Email, password, and full name are required' });
    }

    if (isConnectedToMongo) {
      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        return res.status(400).json({ message: 'User already exists with this email' });
      }

      const user = new User({
        email: email.toLowerCase(),
        password,
        fullName,
        role: 'MEMBER'
      });
      await user.save();

      const token = signToken(user);
      return res.status(201).json({
        token,
        tokenType: 'Bearer',
        user: {
          id: user._id.toString(),
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          createdAt: user.createdAt
        }
      });
    }

    // In-Memory Fallback
    const normEmail = email.toLowerCase();
    if (inMemoryStore.users.has(normEmail)) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const memUser = {
      id: 'usr_' + uuidv4().substring(0, 8),
      email: normEmail,
      password: hashedPassword,
      fullName,
      role: 'MEMBER',
      createdAt: new Date().toISOString()
    };
    inMemoryStore.users.set(normEmail, memUser);

    const token = signToken(memUser);
    return res.status(201).json({
      token,
      tokenType: 'Bearer',
      user: {
        id: memUser.id,
        email: memUser.email,
        fullName: memUser.fullName,
        role: memUser.role,
        createdAt: memUser.createdAt
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ message: 'Internal server error during registration', error: err.message });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const normEmail = email.toLowerCase();

    if (isConnectedToMongo) {
      const user = await User.findOne({ email: normEmail });
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const token = signToken(user);
      return res.json({
        token,
        tokenType: 'Bearer',
        user: {
          id: user._id.toString(),
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          createdAt: user.createdAt
        }
      });
    }

    // In-Memory Fallback
    let memUser = inMemoryStore.users.get(normEmail);
    if (!memUser) {
      // Auto-create demo user for smooth testing experience
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const cleanName = email.split('@')[0].replace(/[._-]/g, ' ');
      memUser = {
        id: 'usr_' + uuidv4().substring(0, 8),
        email: normEmail,
        password: hashedPassword,
        fullName: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
        role: 'MEMBER',
        createdAt: new Date().toISOString()
      };
      inMemoryStore.users.set(normEmail, memUser);
    } else {
      const isMatch = await bcrypt.compare(password, memUser.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
    }

    const token = signToken(memUser);
    return res.json({
      token,
      tokenType: 'Bearer',
      user: {
        id: memUser.id,
        email: memUser.email,
        fullName: memUser.fullName,
        role: memUser.role,
        createdAt: memUser.createdAt
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Internal server error during login', error: err.message });
  }
}

export async function getMe(req, res) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  return res.json({
    id: req.user.id || req.user._id,
    email: req.user.email,
    fullName: req.user.fullName,
    role: req.user.role || 'MEMBER',
    createdAt: req.user.createdAt || new Date().toISOString()
  });
}
