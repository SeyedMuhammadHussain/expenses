import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const schemaPath = fileURLToPath(new URL('../../database/schema.sql', import.meta.url));

async function setupDatabase() {
  let client;
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    const schema = await readFile(schemaPath, 'utf8');
    client = await pool.connect();
    await client.query('BEGIN');
    try {
      await client.query(schema);
      await client.query('COMMIT');
      console.log('Database schema initialized successfully.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client?.release();
    await pool.end();
  }
}

setupDatabase().catch(error => {
  console.error('Database setup failed:', error.message);
  process.exitCode = 1;
});
