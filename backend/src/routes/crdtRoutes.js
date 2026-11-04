import { Router } from 'express';
import { getCrdtDoc, updateCrdtDoc } from '../controllers/crdtController.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/:roomId', optionalAuthMiddleware, getCrdtDoc);
router.post('/:roomId', optionalAuthMiddleware, updateCrdtDoc);

export default router;

