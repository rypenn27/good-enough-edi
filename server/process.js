// What happens to a file: inbound files are matched to a partner, checked against their
// guideline and answered with a 997; partner 997s are matched to the file they answer;
// outbound files are built from TMS data.
import { envelope, parseX12, runMapping, validate } from '../src/lib/x12.js';
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

// The JSON a TMS receives for an inbound transaction: the partner's mapping output when
// there is one, otherwise just the basics.
export function tmsPayload(db, tx) {
  const partner = db.partners.find((p) => p.id === tx.partnerId);
  const mapping = db.mappings.find((m) => m.partnerId === tx.partnerId && m.set === tx.set);
  const ctx = { partnerName: (isaId) => db.partners.find((p) => p.isaId === isaId || p.testIsaId === isaId)?.name };
  const base = { transactionId: tx.id, partner: { id: partner?.id, name: partner?.name }, set: tx.set, control: tx.control, env: tx.env };
  if (tx.errors.length) return { ...base, errors: tx.errors.map((e) => e.text) };
  if (mapping) return { ...base, mapping: `${mapping.name} v${mapping.version}`, data: runMapping(parseX12(tx.raw), mapping.rules, ctx).output };
  return { ...base, data: tx.fields };
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

// A partner's 997 answers one of our outbound files: AK1-02 is that file's group control
// number and AK2-01 its set. Marks the matching file acknowledged or rejected.
function apply997(db, partner, segments, inbound) {
  const ak1 = segments.find((s) => s.id === 'AK1');
  const ak2 = segments.find((s) => s.id === 'AK2');
  const result = segments.find((s) => s.id === 'AK5')?.elements[0] || segments.find((s) => s.id === 'AK9')?.elements[0];
  const group = Number(ak1?.elements[1]);
  const set = ak2?.elements[0];
  const accepted = result === 'A' || result === 'E';
  const i = db.transactions.findIndex((t) => t.dir === 'out' && t.partnerId === partner.id && t.set !== '997' && Number(t.control) === group && (!set || t.set === set));
  if (!ak1 || i < 0) {
    inbound.ref = `997 for group ${ak1?.elements[1] || '?'}`;
    inbound.events.push({ at: now(), text: `Doesn’t match any file sent to ${partner.name}` });
    return null;
  }
  const out = db.transactions[i];
  inbound.ref = `${accepted ? 'Accepts' : 'Rejects'} ${out.set} ${out.control}`;
  inbound.events.push({ at: now(), text: `Matched to ${out.set} ${out.control} (${out.ref})` });
  db.transactions[i] = {
    ...out, status: accepted ? 'acknowledged' : 'rejected', ack: accepted ? 'Accepted' : 'Rejected',
    events: [...out.events, { at: now(), text: `997 received: ${accepted ? 'accepted' : 'rejected by partner'}` }],
  };
  return db.transactions[i];
}

// Reads one inbound file. `partner` is set when the file came from that partner's folder.
// Returns { error } or { tx, ack, partner, acked } and adds the transactions to db.
// Passing files are left as 'delivering'; the caller sends them to the TMS.
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
    status: 'delivering', ack: 'Sent', via, raw, fields: null, errors: [],
    events: [{ at: now(), text: received }, { at: now(), text: `Matched to partner ${partner.name}` }, { at: now(), text: 'Checked against guideline' }],
  };
  tx = check(db, tx);

  // A 997 is never answered with another 997; it's matched to the file it answers.
  let acked = null;
  if (env.set === '997') {
    tx.ack = '—';
    acked = apply997(db, partner, segments, tx);
  } else if (!tx.errors.length) {
    tx.events.push({ at: now(), text: '997 acceptance sent to partner' });
  }
  const ack = env.set === '997' ? null : make997(db, partner, tx, env);
  db.transactions.unshift(...[ack, tx].filter(Boolean));
  return { tx, ack, partner, acked };
}

const REQUIRED = {
  '990': ['shipmentId', 'action'],
  '214': ['shipmentId', 'status', 'city', 'state'],
  '210': ['invoice', 'shipmentId', 'amount'],
  '204': ['shipmentId', 'po', 'pickup', 'delivery', 'weight', 'rate'],
};
const REF = {
  '990': (f) => `Load ${f.shipmentId} · ${f.action === 'A' ? 'Accept' : 'Decline'}`,
  '214': (f) => `Load ${f.shipmentId} · ${f.status}`,
  '210': (f) => `Invoice ${f.invoice}`,
  '204': (f) => `Load ${f.shipmentId} tender`,
};

// Builds an outbound file from TMS data: { partnerId, set, env, ref, fields }.
// Returns { error } or { tx, partner } and adds the transaction to db.
export function sendOutbound(db, { partnerId, set, env = 'production', ref, fields } = {}) {
  const partner = db.partners.find((p) => p.id === partnerId);
  if (!partner) return { error: `No trading partner has the ID "${partnerId}".` };
  if (!REQUIRED[set]) return { error: `Set "${set}" can’t be sent. Use 990, 214, 210 or 204.` };
  if (!partner.sets.some((s) => s.set === set && s.dir === 'out')) return { error: `${partner.name} isn’t set up to receive ${set}s from you.` };
  if (!['production', 'test'].includes(env)) return { error: 'env must be "production" or "test".' };
  const missing = REQUIRED[set].filter((k) => fields?.[k] === undefined || fields[k] === '');
  if (missing.length) return { error: `Missing ${missing.join(', ')} in fields.` };
  if (set === '210' && isNaN(Number(fields.amount))) return { error: 'amount must be a number.' };

  const tx = makeTransaction({ env, dir: 'out', partner, set, control: nextControl(db), ref: ref || REF[set](fields), status: 'awaiting997', fields });
  const errors = validate(parseX12(tx.raw), guidelineFor(db, partner, set, 'out'));
  if (errors.length) {
    db.lastControl -= 1; // nothing was sent, so give the number back
    return { error: `This ${set} doesn’t pass the ${partner.name} guideline: ${errors.map((e) => e.text).join(' ')}` };
  }
  tx.events = [{ at: now(), text: 'Built from TMS data (API)' }, { at: now(), text: `Placed in ${partner.id}/outbound for the partner to pick up` }];
  db.transactions.unshift(tx);
  return { tx, partner };
}

export function findTx(db, id) {
  return db.transactions.findIndex((t) => t.id === id);
}

export function reprocess(db, i) {
  const t = db.transactions[i];
  db.transactions[i] = check(db, { ...t, status: 'delivering', ack: 'Sent', events: [...t.events, { at: now(), text: 'Reprocessed' }] });
  return db.transactions[i];
}

export function resolve(db, i) {
  const t = db.transactions[i];
  db.transactions[i] = { ...t, status: 'resolved', events: [...t.events, { at: now(), text: 'Marked resolved' }] };
  return db.transactions[i];
}

export function resend(db, i) {
  const t = db.transactions[i];
  db.transactions[i] = { ...t, status: 'awaiting997', ack: 'Pending', sentAt: now(), events: [...t.events, { at: now(), text: 'Sent again' }] };
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
