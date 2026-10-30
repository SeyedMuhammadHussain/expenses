import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, requireAdmin, signToken } from './auth.js';

const app = express();
const port = process.env.PORT || 4000;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /^(change[_-]?me|replace|your)/i.test(process.env.JWT_SECRET)) throw new Error('Set JWT_SECRET to a random secret at least 32 characters long; placeholder values are rejected.');
const clientOrigins = (process.env.CLIENT_URL || '').split(',').map(origin => origin.trim()).filter(Boolean);
if (!clientOrigins.length) throw new Error('CLIENT_URL must contain the frontend origin.');
for (const origin of clientOrigins) {
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error(`Invalid CLIENT_URL origin: ${origin}`); }
  if (parsed.origin !== origin || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error(`CLIENT_URL must be an origin only${process.env.NODE_ENV === 'production' ? ' using HTTPS' : ''}: ${origin}`);
}
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: clientOrigins, credentials: true }));
app.use(express.json({ limit: '30kb' })); app.use(cookieParser());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
const cookieOptions = () => {
  const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', maxAge: 7 * 864e5, path: '/' };
};
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const emailSchema = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const passwordSchema = z.string().min(10).max(128).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be 72 UTF-8 bytes or fewer.');
const credentials = z.object({ email: emailSchema, password: passwordSchema });
const dateSchema = z.string().refine(value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}, 'Date must be a valid calendar date in YYYY-MM-DD format.');
const amountSchema = z.union([z.string(),z.number()]).transform(value=>String(value)).refine(value=>/^\d{1,10}(?:\.\d{1,2})?$/.test(value),'Amount must be positive and have no more than two decimal places.').refine(value=>Number(value)>0,'Amount must be greater than zero.');
const transactionSchema = z.object({ kind:z.enum(['income','expense']), amount:amountSchema, transaction_date:dateSchema, category:z.string().trim().min(1).max(80), description:z.string().trim().max(500).default(''), payment_method:z.string().trim().min(1).max(40).default('cash') });
const validate = (schema, value) => { const result=schema.safeParse(value); if(!result.success) throw Object.assign(new Error(result.error.issues[0]?.message || 'Invalid input.'),{status:400}); return result.data; };
app.get('/api/health', (_req,res)=>res.json({ok:true}));

app.post('/api/auth/register', wrap(async(req,res)=>{
  const input=validate(credentials.extend({display_name:z.string().trim().min(1).max(80)}),req.body);
  const hash=await bcrypt.hash(input.password,12);
  try { const {rows}=await pool.query('INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) RETURNING id,email,role,display_name,created_at',[input.email,hash,input.display_name]); const user=rows[0]; res.cookie('daybook',signToken(user),cookieOptions()).status(201).json({user}); }
  catch(e) { if(e.code==='23505') return res.status(409).json({error:'An account with this email already exists.'}); throw e; }
}));
app.post('/api/auth/login',wrap(async(req,res)=>{
  const input=validate(credentials,req.body); const {rows}=await pool.query('SELECT id,email,password_hash,role,display_name,created_at FROM users WHERE email=$1',[input.email]); const user=rows[0];
  if(!user || !(await bcrypt.compare(input.password,user.password_hash))) return res.status(401).json({error:'Email or password is incorrect.'});
  delete user.password_hash; res.cookie('daybook',signToken(user),cookieOptions()).json({user});
}));
app.post('/api/auth/logout',(_req,res)=>{const secure=process.env.COOKIE_SECURE==='true'||process.env.NODE_ENV==='production';res.clearCookie('daybook',{httpOnly:true,secure,sameSite:secure?'none':'lax',path:'/'}).json({ok:true});});
app.get('/api/auth/me',requireAuth,wrap(async(req,res)=>{const {rows}=await pool.query('SELECT id,email,role,display_name,created_at FROM users WHERE id=$1',[req.auth.sub]); if(!rows[0])return res.status(401).json({error:'Account not found.'}); res.json({user:rows[0]});}));
app.patch('/api/auth/profile',requireAuth,wrap(async(req,res)=>{const body=validate(z.object({display_name:z.string().trim().min(1).max(80)}),req.body); const {rows}=await pool.query('UPDATE users SET display_name=$1,updated_at=now() WHERE id=$2 RETURNING id,email,role,display_name,created_at',[body.display_name,req.auth.sub]); res.json({user:rows[0]});}));

app.get('/api/transactions',requireAuth,wrap(async(req,res)=>{
 const filters=validate(z.object({from:dateSchema.optional(),to:dateSchema.optional(),kind:z.enum(['income','expense']).optional(),search:z.string().trim().max(100).optional()}),req.query);
 if(filters.from&&filters.to&&filters.from>filters.to)throw Object.assign(new Error('The start date must be on or before the end date.'),{status:400});
 const clauses=['user_id=$1'],params=[req.auth.sub];
 for(const [key,col] of [['from','transaction_date >='],['to','transaction_date <='],['kind','kind =']]) if(filters[key]) { params.push(filters[key]); clauses.push(`${col} $${params.length}`); }
 if(filters.search){params.push(`%${filters.search}%`);clauses.push(`(category ILIKE $${params.length} OR description ILIKE $${params.length})`);}
 const {rows}=await pool.query(`SELECT id,kind,amount::text AS amount,transaction_date,category,description,payment_method,created_at FROM transactions WHERE ${clauses.join(' AND ')} ORDER BY transaction_date DESC,created_at DESC LIMIT 1000`,params);res.json({transactions:rows});
}));
app.post('/api/transactions',requireAuth,wrap(async(req,res)=>{const t=validate(transactionSchema,req.body);const {rows}=await pool.query('INSERT INTO transactions(user_id,kind,amount,transaction_date,category,description,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,kind,amount::text AS amount,transaction_date,category,description,payment_method,created_at',[req.auth.sub,t.kind,t.amount,t.transaction_date,t.category,t.description,t.payment_method]);res.status(201).json({transaction:rows[0]});}));
app.put('/api/transactions/:id',requireAuth,wrap(async(req,res)=>{const id=validate(z.string().uuid(),req.params.id);const t=validate(transactionSchema,req.body);const {rows}=await pool.query('UPDATE transactions SET kind=$1,amount=$2,transaction_date=$3,category=$4,description=$5,payment_method=$6,updated_at=now() WHERE id=$7 AND user_id=$8 RETURNING id,kind,amount::text AS amount,transaction_date,category,description,payment_method,created_at',[t.kind,t.amount,t.transaction_date,t.category,t.description,t.payment_method,id,req.auth.sub]);if(!rows[0])return res.status(404).json({error:'Transaction not found.'});res.json({transaction:rows[0]});}));
app.delete('/api/transactions/:id',requireAuth,wrap(async(req,res)=>{const id=validate(z.string().uuid(),req.params.id);const result=await pool.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2',[id,req.auth.sub]);if(!result.rowCount)return res.status(404).json({error:'Transaction not found.'});res.json({ok:true});}));
app.get('/api/summary',requireAuth,wrap(async(req,res)=>{
 const filters=validate(z.object({from:dateSchema.optional(),to:dateSchema.optional()}),req.query);
 const to=filters.to||new Date().toISOString().slice(0,10),from=filters.from||new Date(Date.now()-29*864e5).toISOString().slice(0,10);
 if(from>to)throw Object.assign(new Error('The start date must be on or before the end date.'),{status:400});
 const values=[req.auth.sub,from,to];
 const [totalsResult,daysResult]=await Promise.all([
  pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind='income'),0)::text AS income,COALESCE(SUM(amount) FILTER (WHERE kind='expense'),0)::text AS expense,(COALESCE(SUM(amount) FILTER (WHERE kind='income'),0)-COALESCE(SUM(amount) FILTER (WHERE kind='expense'),0))::text AS profit FROM transactions WHERE user_id=$1 AND transaction_date BETWEEN $2 AND $3`,values),
  pool.query(`SELECT transaction_date::text,kind,SUM(amount)::float AS total FROM transactions WHERE user_id=$1 AND transaction_date BETWEEN $2 AND $3 GROUP BY transaction_date,kind ORDER BY transaction_date`,values),
 ]);
 res.json({from,to,...totalsResult.rows[0],days:daysResult.rows});
}));

// Admin routes expose account metadata and activity counts only, never transaction details.
app.get('/api/admin/stats',requireAuth,requireAdmin,wrap(async(_req,res)=>{const {rows}=await pool.query(`SELECT (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM transactions) transactions,(SELECT count(*)::int FROM users WHERE created_at>=now()-interval '30 days') new_users,(SELECT count(*)::int FROM transactions WHERE created_at>=now()-interval '30 days') recent_activity`);res.json(rows[0]);}));
app.get('/api/admin/users',requireAuth,requireAdmin,wrap(async(req,res)=>{const query=validate(z.object({search:z.string().trim().max(100).optional()}),req.query);const search=`%${query.search||''}%`;const {rows}=await pool.query('SELECT u.id,u.email,u.role,u.display_name,u.created_at,count(t.id)::int transaction_count FROM users u LEFT JOIN transactions t ON t.user_id=u.id WHERE u.email ILIKE $1 OR u.display_name ILIKE $1 GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200',[search]);res.json({users:rows});}));
app.patch('/api/admin/users/:id/role',requireAuth,requireAdmin,wrap(async(req,res)=>{const id=validate(z.string().uuid(),req.params.id);const body=validate(z.object({role:z.enum(['user','admin'])}),req.body);if(id===req.auth.sub&&body.role==='user')return res.status(400).json({error:'You cannot remove your own administrator role.'});const {rows}=await pool.query('UPDATE users SET role=$1,updated_at=now() WHERE id=$2 RETURNING id,email,role,display_name',[body.role,id]);if(!rows[0])return res.status(404).json({error:'User not found.'});res.json({user:rows[0]});}));
app.use((err,_req,res,_next)=>{console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Something went wrong. Please try again.'});});

async function initializeAdmin(){const email=process.env.INITIAL_ADMIN_EMAIL,password=process.env.INITIAL_ADMIN_PASSWORD;if(!email&&!password)return;if(!email||!password)throw new Error('Set both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD, or neither.');const normalized=emailSchema.parse(email);if(password.length<16)throw new Error('INITIAL_ADMIN_PASSWORD must be at least 16 characters.');const hash=await bcrypt.hash(password,12);await pool.query(`INSERT INTO users(email,password_hash,display_name,role) VALUES($1,$2,'Administrator','admin') ON CONFLICT(email) DO NOTHING`,[normalized,hash]);console.log('Initial administrator checked; remove INITIAL_ADMIN_* variables after first startup.');}
const server = await initializeAdmin()
  .then(() => pool.query('SELECT 1'))
  .then(() => new Promise((resolve, reject) => {
    const listener = app.listen(port, '0.0.0.0', () => {
      console.log(`API listening on ${port}`);
      resolve(listener);
    });
    listener.once('error', reject);
  }))
  .catch(err => { console.error('Startup failed', err); process.exit(1); });

export { app, server };
