// A stand-in TMS for testing. It receives webhooks at /api/mock-tms/webhook and keeps them
// in data/mock-tms.json, so the Test TMS page can show what a real TMS would get.
// It can also pretend to be down, to show what happens when deliveries fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'mock-tms.json');
const KEEP = 200;

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { down: false, received: [] };
  }
}

function store(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function mockTmsRouter() {
  const router = express.Router();
  let state = load();

  router.post('/webhook', (req, res) => {
    if (state.down) return res.status(503).json({ error: 'Test TMS is set to be down.' });
    state.received.unshift({ id: `rcv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), ...req.body });
    state.received = state.received.slice(0, KEEP);
    store(state);
    res.json({ ok: true });
  });

  router.get('/', (req, res) => res.json(state));

  router.put('/down', (req, res) => {
    state.down = Boolean(req.body?.down);
    store(state);
    res.json(state);
  });

  router.post('/clear', (req, res) => {
    state = { ...state, received: [] };
    store(state);
    res.json(state);
  });

  return router;
}
