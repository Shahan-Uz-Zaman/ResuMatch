import jwt from 'jsonwebtoken';
import { db } from '../db.js';

export function requireAuth(req, res, next) {
  const token = req.cookies?.resumatch_token;
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
    req.user = user;
    next();
  } catch {
    res.clearCookie('resumatch_token');
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}
