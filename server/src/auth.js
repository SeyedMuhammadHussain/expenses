import jwt from 'jsonwebtoken';
import { pool } from './db.js';
export function signToken(user) { return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' }); }
export function requireAuth(req, res, next) {
  const token = req.cookies?.daybook || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try { req.auth = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); next(); }
  catch { return res.status(401).json({ error: 'Your session expired. Please sign in again.' }); }
}
export async function requireAdmin(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT role FROM users WHERE id=$1', [req.auth?.sub]);
    if (rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
    next();
  } catch (err) { next(err); }
}
