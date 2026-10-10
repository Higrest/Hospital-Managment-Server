import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

delete process.env.DATABASE_URL;

export const pool = new pg.Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '6543', 10),
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

pool.on('connect', () => {
  console.log('PostgreSQL database pool connected successfully');
});
