// Stores everything in one JSON file (data/db.json). Fine for a proof of concept;
// a real version would use Postgres. It lives outside server/ because `node --watch`
// restarts the server whenever anything in server/ changes, including its own saves.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partners, guidelines, mappings, sampleSettings, sampleTransactions } from '../src/data/sample.js';
import { check } from './process.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export function seedDb() {
  const db = structuredClone({ version: 1, partners, guidelines, mappings, settings: sampleSettings, transactions: [], inboxErrors: [] });
  db.transactions = sampleTransactions().map((tx) => check(db, tx));
  db.lastControl = Math.max(...db.transactions.map((t) => Number(t.control)));
  return db;
}

export function loadDb() {
  if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const db = seedDb();
  saveDb(db);
  return db;
}

// Bumps the version so the browser knows to refetch, then writes via a temp file
// so a crash mid-write can't leave a half-written database.
export function saveDb(db) {
  db.version += 1;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
