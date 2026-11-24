// Builds the 997 a partner would send back for several of our outbound files at once, so you
// can try a 997 that acknowledges more than one file. Our control numbers change as files are
// sent, so it reads them from data/db.json or takes them on the command line.
//
//   node scripts/make-partner-997.js <partner id> [control ...] [--reject] [--stdout]
//
// With no control numbers it answers every file waiting on a 997 from that partner. The 997
// is written to edi-inbox/<partner>/inbound (where the running server picks it up), or
// printed with --stdout. --reject rejects the files instead of accepting them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build997 } from '../src/lib/x12.js';
import { OUR_IDS } from '../src/data/sample.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODES = { '204': 'SM', '990': 'GF', '214': 'QM', '210': 'IM' };

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [partnerId, ...controls] = args.filter((a) => !a.startsWith('--'));
if (!partnerId) {
  console.error('Usage: node scripts/make-partner-997.js <partner id> [control ...] [--reject] [--stdout]');
  process.exit(1);
}

const dbFile = path.join(ROOT, 'data', 'db.json');
const db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : { partners: [], transactions: [] };
const partner = db.partners.find((p) => p.id === partnerId);
const sent = db.transactions.filter((t) => t.dir === 'out' && t.partnerId === partnerId && t.set !== '997');

// Each file we send is its own group, whose control number (GS-06) is the file's number.
const files = controls.length
  ? controls.map((c) => sent.find((t) => Number(t.control) === Number(c)) || { control: c, set: '990', env: 'production' })
  : sent.filter((t) => t.status === 'awaiting997');
if (!files.length) {
  console.error(`No files from us to ${partnerId} are waiting on a 997. Send some first, or give control numbers.`);
  process.exit(1);
}

const test = files[0].env === 'test';
const theirId = (test ? partner?.testIsaId : partner?.isaId) || partnerId.toUpperCase();
const accepted = !flags.has('--reject');
const raw = build997({
  control: String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), date: new Date(), usage: test ? 'T' : 'P',
  senderId: theirId, receiverId: test ? OUR_IDS.testId : OUR_IDS.id,
  groups: files.map((t) => ({ code: CODES[t.set], control: String(Number(t.control)), sets: [{ set: t.set, control: '0001', errors: accepted ? [] : [{ text: 'Rejected by partner' }] }] })),
});

const list = files.map((t) => `${t.set} ${t.control}`).join(', ');
if (flags.has('--stdout')) process.stdout.write(`${raw}\n`);
else {
  const out = path.join(ROOT, 'edi-inbox', partnerId, 'inbound', `${partnerId}-997-${Date.now()}.edi`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, raw);
  console.log(`Wrote ${path.relative(ROOT, out)}: ${accepted ? 'accepts' : 'rejects'} ${list}`);
}
