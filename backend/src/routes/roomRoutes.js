import { Router } from 'express';
import { getRooms, createRoom, getMembers, addMember } from '../controllers/roomController.js';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/', optionalAuthMiddleware, getRooms);
router.post('/', optionalAuthMiddleware, createRoom);
router.get('/:id/members', optionalAuthMiddleware, getMembers);
router.post('/:id/members', optionalAuthMiddleware, addMember);

export default router;
