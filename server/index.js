// Good Enough EDI API: serves the app's data, watches the local inbox for new files,
// sends new files to the TMS by webhook, and takes outbound files from the TMS.
import express from 'express';
import { loadDb, saveDb, seedDb } from './db.js';
import { INBOX, deliver, ensureFolders, scan, syncControl } from './inbox.js';
import { findTx, processInbound, reprocess, resend, resolve, sendOutbound, sendTest, tmsPayload } from './process.js';
import { createWebhooks } from './webhooks.js';
import { mockTmsRouter } from './mockTms.js';

const PORT = 3002;
const SCAN_EVERY_MS = 2000;

let db = loadDb();
ensureFolders(db);
if (syncControl(db)) saveDb(db);

const fire = createWebhooks({ getDb: () => db, save: saveDb });

// After an inbound file is read: tell the TMS about it, and about any file it acknowledges.
function afterInbound(result) {
  if (result.error) return;
  const { tx, acked } = result;
  if (tx.errors.length) fire('transaction.failed', tmsPayload(db, tx), null);
  else if (tx.set === '997') fire('ack.received', { transactionId: acked?.id ?? null, set: acked?.set, control: acked?.control, ref: acked?.ref, status: acked?.status ?? 'unmatched', partner: tx.partnerId }, null);
  if (tx.set === '997') {
    const i = findTx(db, tx.id);
    if (i >= 0 && db.transactions[i].status === 'delivering') db.transactions[i] = { ...db.transactions[i], status: 'delivered' };
  } else if (!tx.errors.length) {
    fire('transaction.received', tmsPayload(db, tx), tx.id);
  }
}

const sentPayload = (tx) => ({ transactionId: tx.id, partner: tx.partnerId, set: tx.set, control: tx.control, ref: tx.ref, env: tx.env, fields: tx.fields });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/mock-tms', mockTmsRouter());

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
  afterInbound(result);
  saveDb(db);
  res.json({ txId: result.tx.id, errors: result.tx.errors.length, version: db.version });
});

// The TMS sends 990s, 214s, 210s (and 204s to carriers) here, using the API key.
//   POST /api/outbound  { partnerId, set, env?, ref?, fields }
app.post('/api/outbound', (req, res) => {
  const key = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!key || key !== db.settings.apiKey) return res.status(401).json({ error: 'Missing or wrong API key. Send it in the X-API-Key header.' });
  const result = sendOutbound(db, req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  deliver(result.partner, result.tx);
  fire('transaction.sent', sentPayload(result.tx), result.tx.id);
  saveDb(db);
  res.status(201).json({ transactionId: result.tx.id, control: result.tx.control, file: `${result.partner.id}/outbound/${result.tx.set}_${result.tx.control}.edi`, status: result.tx.status });
});

const ACTIONS = { reprocess, resolve, resend };
app.post('/api/transactions/:id/:action', (req, res) => {
  const action = ACTIONS[req.params.action];
  const i = findTx(db, req.params.id);
  if (!action) return res.status(404).json({ error: `Unknown action "${req.params.action}".` });
  if (i < 0) return res.status(404).json({ error: 'That transaction doesn’t exist.' });
  const tx = action(db, i);
  if (tx.error) return res.status(400).json({ error: tx.error });
  if (req.params.action === 'resend') {
    deliver(partnerOf(tx), tx);
    fire('transaction.sent', sentPayload(tx), tx.id);
  }
  if (req.params.action === 'reprocess' && !tx.errors.length) fire('transaction.received', tmsPayload(db, tx), tx.id);
  saveDb(db);
  res.json({ errors: tx.errors.length, version: db.version });
});

app.post('/api/partners/:id/send-test', (req, res) => {
  const partner = db.partners.find((p) => p.id === req.params.id);
  if (!partner) return res.status(404).json({ error: 'That partner doesn’t exist.' });
  const result = sendTest(db, partner);
  if (!result) return res.status(400).json({ error: `${partner.name} has no outbound 990, 214 or 210 set up to test with.` });
  if (result.error) return res.status(400).json({ error: result.error });
  const { tx } = result;
  deliver(partner, tx);
  fire('transaction.sent', sentPayload(tx), tx.id);
  saveDb(db);
  res.json({ txId: tx.id, version: db.version });
});

app.post('/api/reset', (req, res) => {
  const version = db.version;
  db = seedDb();
  db.version = version;
  ensureFolders(db);
  syncControl(db);
  saveDb(db);
  res.json({ version: db.version });
});

setInterval(() => {
  try {
    const handled = scan(db);
    if (handled.length) {
      handled.forEach(afterInbound);
      saveDb(db);
    }
  } catch (err) {
    console.error('Inbox scan failed:', err.message);
  }
}, SCAN_EVERY_MS);

app.listen(PORT, () => {
  console.log(`Good Enough EDI API on http://localhost:${PORT}`);
  console.log(`Watching ${INBOX}\\<partner>\\inbound every ${SCAN_EVERY_MS / 1000}s`);
});
