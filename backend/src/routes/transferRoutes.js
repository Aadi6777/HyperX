import { Router } from 'express';
import { recordTransfer, getTransfers, getActivityLogs } from '../controllers/transferController.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/record', optionalAuthMiddleware, recordTransfer);
router.get('/history', optionalAuthMiddleware, getTransfers);
router.get('/activity', optionalAuthMiddleware, getActivityLogs);

export default router;

