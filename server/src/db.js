import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Load the repository-level .env before constructing the pool. Importing this
// module from either the API or the schema command therefore uses the same URL.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
pool.on('error', (err) => console.error('Unexpected PostgreSQL pool error', err));
