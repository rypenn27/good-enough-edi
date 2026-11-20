// What happens to a file: inbound files are matched to a partner, checked against their
// guideline and answered with a 997; outbound actions update the transaction's history.
import { envelope, parseX12, validate } from '../src/lib/x12.js';
import { makeTransaction, OUR_IDS } from '../src/data/sample.js';

const now = () => new Date().toISOString();

export function nextControl(db) {
  db.lastControl += 1;
  return String(db.lastControl).padStart(9, '0');
}

function guidelineFor(db, partner, set, dir) {
  const link = partner?.sets.find((s) => s.set === set && s.dir === dir);
  return db.guidelines.find((g) => g.id === link?.guideline);
}

// Checks an inbound transaction. Returns a new object; a failure marks it failed and rejected.
export function check(db, tx) {
  if (tx.dir !== 'in' || tx.status === 'resolved') return tx;
  const partner = db.partners.find((p) => p.id === tx.partnerId);
  const errors = validate(parseX12(tx.raw), guidelineFor(db, partner, tx.set, 'in'));
  if (!errors.length) return { ...tx, errors };
  const alreadyRejected = tx.events.some((e) => e.text.startsWith('997 rejection'));
  const events = alreadyRejected
    ? tx.events
    : [...tx.events, { at: tx.time, text: `${errors.length} problem${errors.length > 1 ? 's' : ''} found` }, { at: tx.time, text: '997 rejection sent to partner' }, { at: tx.time, text: 'Alert emailed to the EDI team' }];
  return { ...tx, errors, status: 'failed', ack: 'Rejected', events };
}

// Builds the 997 that answers an inbound file and records it as an outbound transaction.
function make997(db, partner, inbound, env) {
  const accepted = inbound.errors.length === 0;
  const tx = makeTransaction({
    env: inbound.env, dir: 'out', partner, set: '997', control: nextControl(db),
    ref: `${accepted ? 'Accepts' : 'Rejects'} ${inbound.set} ${inbound.control}`, status: 'sent',
    fields: { ackSet: inbound.set, ackControl: env.group || inbound.control, accepted },
  });
  return { ...tx, ack: '—', via: inbound.via, events: [{ at: now(), text: `Built automatically for ${inbound.set} ${inbound.control}` }] };
}

// Reads one inbound file. `partner` is set when the file came from that partner's folder.
// Returns { error } or { tx, ack } and adds both transactions to db.
export function processInbound(db, raw, { via, partner: folderPartner, fileName }) {
  const segments = parseX12(raw);
  if (!segments.length || segments[0].id !== 'ISA') return { error: 'This doesn’t look like an X12 file. It should start with an ISA segment.' };
  const env = envelope(segments);
  const partner = db.partners.find((p) => p.isaId === env.senderId || p.testIsaId === env.senderId);
  if (!partner) return { error: `No trading partner has the sender ID "${env.senderId}". Add the partner first, or check the ISA-06 value.` };
  if (folderPartner && folderPartner.id !== partner.id) return { error: `This file is in ${folderPartner.name}’s folder but was sent by ${partner.name} (${env.senderId}).` };
  if (![OUR_IDS.id, OUR_IDS.testId].includes(env.receiverId)) return { error: `This file is addressed to "${env.receiverId}", not to your ID ${OUR_IDS.id}.` };

  const isTest = env.usage === 'T' || env.senderId === partner.testIsaId;
  const received = via === 'Folder' ? `File ${fileName} picked up from ${partner.id}/inbound` : 'File uploaded by hand';
  let tx = {
    id: `tx-in-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: now(), env: isTest ? 'test' : 'production',
    dir: 'in', partnerId: partner.id, set: env.set, control: env.control, ref: fileName || 'Uploaded file',
    status: 'delivered', ack: 'Sent', via, raw, fields: null, errors: [],
    events: [{ at: now(), text: received }, { at: now(), text: `Matched to partner ${partner.name}` }, { at: now(), text: 'Checked against guideline' }],
  };
  tx = check(db, tx);
  if (!tx.errors.length) tx.events.push({ at: now(), text: 'Delivered to TMS' }, { at: now(), text: '997 acceptance sent to partner' });

  // A 997 is never answered with another 997.
  const ack = env.set === '997' ? null : make997(db, partner, tx, env);
  db.transactions.unshift(...[ack, tx].filter(Boolean));
  return { tx, ack, partner };
}

export function findTx(db, id) {
  return db.transactions.findIndex((t) => t.id === id);
}

export function reprocess(db, i) {
  const t = db.transactions[i];
  const fresh = check(db, { ...t, status: 'delivered', ack: 'Sent', events: [...t.events, { at: now(), text: 'Reprocessed' }] });
  db.transactions[i] = fresh.errors.length ? fresh : { ...fresh, events: [...fresh.events, { at: now(), text: 'Delivered to TMS' }] };
  return db.transactions[i];
}

export function resolve(db, i) {
  const t = db.transactions[i];
  db.transactions[i] = { ...t, status: 'resolved', events: [...t.events, { at: now(), text: 'Marked resolved' }] };
  return db.transactions[i];
}

export function resend(db, i) {
  const t = db.transactions[i];
  db.transactions[i] = { ...t, status: 'awaiting997', ack: 'Pending', events: [...t.events, { at: now(), text: 'Sent again' }] };
  return db.transactions[i];
}

const TEST_FIELDS = {
  '990': { shipmentId: 'TEST', action: 'A' },
  '214': { shipmentId: 'TEST', status: 'X3', city: 'Akron', state: 'OH' },
  '210': { invoice: 'TEST', shipmentId: 'TEST', amount: 100 },
};

export function sendTest(db, partner) {
  const out = partner.sets.find((s) => s.dir === 'out' && TEST_FIELDS[s.set]);
  if (!out) return null;
  const tx = makeTransaction({ env: 'test', dir: 'out', partner, set: out.set, control: nextControl(db), ref: `Test ${out.set}`, status: 'awaiting997', fields: TEST_FIELDS[out.set] });
  db.transactions.unshift(tx);
  return tx;
}
