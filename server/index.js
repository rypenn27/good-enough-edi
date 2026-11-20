// Good Enough EDI API: serves the app's data and watches the local inbox for new files.
import express from 'express';
import { loadDb, saveDb, seedDb } from './db.js';
import { INBOX, deliver, ensureFolders, scan } from './inbox.js';
import { findTx, processInbound, reprocess, resend, resolve, sendTest } from './process.js';

const PORT = 3002;
const SCAN_EVERY_MS = 2000;

let db = loadDb();
ensureFolders(db);

const app = express();
app.use(express.json({ limit: '5mb' }));

const partnerOf = (tx) => db.partners.find((p) => p.id === tx.partnerId);

app.get('/api/state', (req, res) => res.json({ ...db, inboxPath: INBOX }));
app.get('/api/version', (req, res) => res.json({ version: db.version }));

// Partners, guidelines, mappings and settings are edited in the browser and saved whole.
app.put('/api/config', (req, res) => {
  const { partners, guidelines, mappings, settings } = req.body || {};
  if (![partners, guidelines, mappings].every(Array.isArray) || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Expected partners, guidelines, mappings and settings.' });
  }
  Object.assign(db, { partners, guidelines, mappings, settings });
  ensureFolders(db);
  saveDb(db);
  res.json({ version: db.version });
});

app.post('/api/upload', (req, res) => {
  const raw = String(req.body?.raw || '');
  const result = processInbound(db, raw, { via: 'Upload' });
  if (result.error) return res.status(400).json({ error: result.error });
  if (result.ack) deliver(result.partner, result.ack);
  saveDb(db);
  res.json({ txId: result.tx.id, errors: result.tx.errors.length, version: db.version });
});

const ACTIONS = { reprocess, resolve, resend };
app.post('/api/transactions/:id/:action', (req, res) => {
  const action = ACTIONS[req.params.action];
  const i = findTx(db, req.params.id);
  if (!action) return res.status(404).json({ error: `Unknown action "${req.params.action}".` });
  if (i < 0) return res.status(404).json({ error: 'That transaction doesn’t exist.' });
  const tx = action(db, i);
  if (req.params.action === 'resend') deliver(partnerOf(tx), tx);
  saveDb(db);
  res.json({ errors: tx.errors.length, version: db.version });
});

app.post('/api/partners/:id/send-test', (req, res) => {
  const partner = db.partners.find((p) => p.id === req.params.id);
  if (!partner) return res.status(404).json({ error: 'That partner doesn’t exist.' });
  const tx = sendTest(db, partner);
  if (!tx) return res.status(400).json({ error: `${partner.name} has no outbound 990, 214 or 210 set up to test with.` });
  deliver(partner, tx);
  saveDb(db);
  res.json({ txId: tx.id, version: db.version });
});

app.post('/api/reset', (req, res) => {
  const version = db.version;
  db = seedDb();
  db.version = version;
  ensureFolders(db);
  saveDb(db);
  res.json({ version: db.version });
});

setInterval(() => {
  try {
    if (scan(db)) saveDb(db);
  } catch (err) {
    console.error('Inbox scan failed:', err.message);
  }
}, SCAN_EVERY_MS);

app.listen(PORT, () => {
  console.log(`Good Enough EDI API on http://localhost:${PORT}`);
  console.log(`Watching ${INBOX}\\<partner>\\inbound every ${SCAN_EVERY_MS / 1000}s`);
});
