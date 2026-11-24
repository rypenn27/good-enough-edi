// What happens to a file: inbound files are matched to a partner and split into their
// transaction sets; each set is checked against the partner's guideline and the whole file is
// answered with one 997 interchange; partner 997s are matched to the files they answer;
// outbound files are built from TMS data, through the partner's outbound mapping when one is linked.
import { SET_FOR_CODE, build997, envelope, groupResult, mappingDirection, parseX12, runMapping, runOutboundMapping, splitInterchange, stampFields, txSegments, validate } from '../src/lib/x12.js';
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
  // Envelope problems were found when the file was split and don't change on reprocess.
  const errors = [...(tx.envelopeErrors || []), ...validate(txSegments(tx), guidelineFor(db, partner, tx.set, 'in'))];
  if (!errors.length) return { ...tx, errors };
  const alreadyFound = tx.events.some((e) => / problems? found$/.test(e.text));
  const events = alreadyFound
    ? tx.events
    : [...tx.events, { at: tx.time, text: `${errors.length} problem${errors.length > 1 ? 's' : ''} found` }, ...(tx.set === '997' ? [] : [{ at: tx.time, text: '997 rejection sent to partner' }]), { at: tx.time, text: 'Alert emailed to the EDI team' }];
  return { ...tx, errors, status: 'failed', ack: 'Rejected', events };
}

// The JSON a TMS receives for an inbound transaction: the partner's mapping output when
// there is one, otherwise just the basics.
export function tmsPayload(db, tx) {
  const partner = db.partners.find((p) => p.id === tx.partnerId);
  const mapping = db.mappings.find((m) => m.partnerId === tx.partnerId && m.set === tx.set && mappingDirection(m) === 'in');
  const ctx = { partnerName: (isaId) => db.partners.find((p) => p.isaId === isaId || p.testIsaId === isaId)?.name };
  const base = { transactionId: tx.id, partner: { id: partner?.id, name: partner?.name }, set: tx.set, control: tx.control, env: tx.env };
  if (tx.errors.length) return { ...base, errors: tx.errors.map((e) => e.text) };
  if (mapping) return { ...base, mapping: `${mapping.name} v${mapping.version}`, data: runMapping(txSegments(tx), mapping.rules, ctx).output };
  return { ...base, data: tx.fields };
}

// Builds the one 997 interchange that answers an inbound file: a 997 per functional group
// received, each with an AK2/AK5 pair per transaction set. Groups that are themselves 997s
// are never answered. Records it as an outbound transaction; returns null if there's
// nothing to answer.
function make997(db, partner, file, entries, env) {
  const groups = file.groups
    .filter((g) => g.code !== 'FA' && g.sets.some((s) => s.set !== '997'))
    .map((g) => ({ code: g.code, control: g.control, count: Number(g.count) || g.sets.length, problems: g.problems, sets: g.sets.map((s) => ({ set: s.set, control: s.control, st: s.st, errors: entries.get(s).errors })) }));
  if (!groups.length) return null;
  const first = entries.values().next().value;
  const control = nextControl(db);
  const isTest = first.env === 'test';
  const raw = build997({
    control, date: new Date(), usage: isTest ? 'T' : 'P', version: file.groups.find((g) => g.version)?.version || '004010',
    senderId: isTest ? OUR_IDS.testId : OUR_IDS.id, receiverId: env.senderId, groups,
  });
  const sets = groups.flatMap((g) => g.sets);
  const ok = sets.filter((s) => !s.errors.length).length;
  const ref = sets.length === 1
    ? `${ok ? 'Accepts' : 'Rejects'} ${sets[0].set} ${env.control}`
    : `Answers ${sets.length} sets in ${env.control}: ${ok} accepted, ${sets.length - ok} rejected`;
  const summary = groups.map((g) => `group ${g.control} ${groupResult(g)}`).join(', ');
  return {
    id: `tx-${Number(control)}`, time: now(), env: first.env, dir: 'out', partnerId: partner.id, set: '997', control, ref,
    status: 'sent', ack: '—', via: first.via, raw, errors: [],
    fields: { answers: env.control, groups: groups.map((g) => ({ code: g.code, control: g.control, result: groupResult(g), sets: g.sets.map((s) => ({ set: s.set, control: s.control, accepted: !s.errors.length })) })) },
    events: [{ at: now(), text: `Built automatically for interchange ${env.control} (${summary})` }],
  };
}

const ackAccepted = (code) => code === 'A' || code === 'E';

// The answers in one 997 transaction set: [{ group, code, set, result, wholeGroup }].
// AK1 opens a group (AK1-02 is the GS-06 of the group being answered), each AK2/AK5 pair
// answers one set in it, and AK9 closes it. A partner that sends no AK2s answers the whole
// group with the AK9 alone.
function readAcks(segments) {
  const answers = [];
  let group = null;
  const finish = (ak9) => {
    if (group.sets.length) group.sets.forEach((s) => answers.push({ group: group.control, code: group.code, set: s.set, result: s.result || ak9 }));
    else answers.push({ group: group.control, code: group.code, set: SET_FOR_CODE[group.code], result: ak9, wholeGroup: true });
    group = null;
  };
  for (const s of segments) {
    if (s.id === 'AK1') {
      if (group) finish(null);
      group = { code: s.elements[0], control: s.elements[1], sets: [] };
    } else if (s.id === 'AK2' && group) group.sets.push({ set: s.elements[0], result: null });
    else if (s.id === 'AK5' && group?.sets.length) group.sets[group.sets.length - 1].result = s.elements[0];
    else if (s.id === 'AK9' && group) finish(s.elements[0]);
  }
  if (group) finish(null);
  return answers;
}

// A partner's 997 answers our outbound files. Each of our files is its own group, whose
// GS-06 is the file's control number. Marks every file it answers acknowledged or rejected
// (a group-level AK9 of P with no AK2s can't say which set failed, so it counts as rejected)
// and returns the files it matched.
function apply997(db, partner, segments, inbound) {
  const answers = readAcks(segments);
  const matched = [];
  const missed = [];
  for (const a of answers) {
    const hits = db.transactions
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.dir === 'out' && t.partnerId === partner.id && t.set !== '997' && Number(t.control) === Number(a.group) && (!a.set || t.set === a.set));
    if (!hits.length) missed.push(a.group || '?');
    for (const { t: out, i } of a.wholeGroup ? hits : hits.slice(0, 1)) {
      const accepted = ackAccepted(a.result);
      db.transactions[i] = {
        ...out, status: accepted ? 'acknowledged' : 'rejected', ack: accepted ? 'Accepted' : 'Rejected',
        events: [...out.events, { at: now(), text: `997 received: ${accepted ? 'accepted' : 'rejected by partner'}${a.wholeGroup ? ' (whole group)' : ''}` }],
      };
      matched.push(db.transactions[i]);
      inbound.events.push({ at: now(), text: `Matched to ${out.set} ${out.control} (${out.ref}): ${accepted ? 'accepted' : 'rejected'}` });
    }
  }
  if (missed.length) inbound.events.push({ at: now(), text: `Group${missed.length > 1 ? 's' : ''} ${missed.join(', ')} ${missed.length > 1 ? 'don’t' : 'doesn’t'} match any file sent to ${partner.name}` });
  if (!matched.length) inbound.ref = `997 for group${answers.length > 1 ? 's' : ''} ${answers.map((a) => a.group || '?').join(', ') || '?'}`;
  else if (matched.length === 1) inbound.ref = `${matched[0].status === 'acknowledged' ? 'Accepts' : 'Rejects'} ${matched[0].set} ${matched[0].control}`;
  else inbound.ref = `Answers ${matched.length} files: ${matched.map((t) => `${t.set} ${t.control} ${t.status === 'acknowledged' ? 'accepted' : 'rejected'}`).join(', ')}`;
  return matched;
}

// Reads one inbound file. `partner` is set when the file came from that partner's folder.
// Returns { error } or { txs, tx (the first), ack, partner, acked } and adds the
// transactions to db. Each transaction set in the file becomes its own transaction, checked
// and mapped on its own; `acked` lists { by (the 997's transaction id), out (the file it
// answers) }. Passing sets are left as 'delivering'; the caller sends them to the TMS.
export function processInbound(db, raw, { via, partner: folderPartner, fileName }) {
  const file = splitInterchange(raw);
  if (file.error) return { error: file.error };
  const env = envelope(file.segments);
  const partner = db.partners.find((p) => p.isaId === env.senderId || p.testIsaId === env.senderId);
  if (!partner) return { error: `No trading partner has the sender ID "${env.senderId}". Add the partner first, or check the ISA-06 value.` };
  if (folderPartner && folderPartner.id !== partner.id) return { error: `This file is in ${folderPartner.name}’s folder but was sent by ${partner.name} (${env.senderId}).` };
  if (![OUR_IDS.id, OUR_IDS.testId].includes(env.receiverId)) return { error: `This file is addressed to "${env.receiverId}", not to your ID ${OUR_IDS.id}.` };
  const sets = file.groups.flatMap((g) => g.sets.map((s) => ({ g, s })));
  if (!sets.length) return { error: `This file has no transaction sets (ST to SE) to read. ${file.problems.map((p) => p.text).join(' ')}`.trim() };

  const isTest = env.usage === 'T' || env.senderId === partner.testIsaId;
  const received = via === 'Folder' ? `File ${fileName} picked up from ${partner.id}/inbound` : 'File uploaded by hand';
  const name = fileName || 'Uploaded file';
  const batch = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entries = new Map(); // split set → its transaction
  const acked = [];
  for (const [i, { g, s }] of sets.entries()) {
    const many = sets.length > 1;
    let tx = {
      id: `tx-in-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: now(), env: isTest ? 'test' : 'production',
      dir: 'in', partnerId: partner.id, set: s.set, control: env.control, ref: many ? `${name} · set ${i + 1} of ${sets.length}` : name,
      status: 'delivering', ack: 'Sent', via, raw, fields: null, errors: [], envelopeErrors: s.errors,
      source: { batch, file: fileName || null, interchange: env.control, group: g.control, set: s.control, index: i + 1, count: sets.length },
      ...(many ? { part: { gs: g.gs, ge: g.ge, st: s.st, end: s.end } } : {}),
      events: [
        { at: now(), text: received },
        { at: now(), text: `Matched to partner ${partner.name}` },
        ...(many ? [{ at: now(), text: `Set ${i + 1} of ${sets.length} in the file: group ${g.control}, set ${s.control}, lines ${s.st}–${s.end}` }] : []),
        { at: now(), text: 'Checked against guideline' },
      ],
    };
    tx = check(db, tx);
    // A 997 is never answered with another 997; it's matched to the files it answers.
    if (tx.set === '997') {
      tx.ack = '—';
      apply997(db, partner, txSegments(tx), tx).forEach((out) => acked.push({ by: tx.id, out }));
    } else if (!tx.errors.length) {
      tx.events.push({ at: now(), text: '997 acceptance sent to partner' });
    }
    entries.set(s, tx);
  }
  const txs = [...entries.values()];
  const ack = make997(db, partner, file, entries, env);
  db.transactions.unshift(...[ack, ...txs.slice().reverse()].filter(Boolean));
  return { txs, tx: txs[0], ack, partner, acked };
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

// The outbound mapping linked to a partner's set, if any.
export function outboundMapping(db, partner, set) {
  const link = partner?.sets.find((s) => s.set === set && s.dir === 'out');
  return db.mappings.find((m) => m.id === link?.mapping && mappingDirection(m) === 'out') || null;
}

// Builds an outbound file with the partner's mapping (or the built-in layout) and checks it
// against their guideline. Returns { error } or { tx }; doesn't add it to db.
function buildOutbound(db, partner, { env, set, control, ref, status, fields }) {
  const date = new Date();
  const mapping = outboundMapping(db, partner, set);
  let body;
  if (mapping) {
    const run = runOutboundMapping(mapping, stampFields(set, fields, date));
    if (run.problems.length) return { error: `This ${set} can’t be built with the mapping “${mapping.name}”: ${run.problems.map((p) => p.text).join(' ')}` };
    body = run.lines;
  }
  const tx = makeTransaction({ date, env, dir: 'out', partner, set, control, ref, status, fields, body });
  const errors = validate(parseX12(tx.raw), guidelineFor(db, partner, set, 'out'));
  if (errors.length) return { error: `This ${set} doesn’t pass the ${partner.name} guideline: ${errors.map((e) => e.text).join(' ')}` };
  return { tx, mapping };
}

const builtFrom = (mapping) => (mapping ? `Built from TMS data with mapping “${mapping.name}” v${mapping.version}` : 'Built from TMS data (built-in layout)');

// Builds an outbound file from TMS data: { partnerId, set, env, ref, fields }.
// Returns { error } or { tx, partner } and adds the transaction to db.
export function sendOutbound(db, { partnerId, set, env = 'production', ref, fields } = {}) {
  const partner = db.partners.find((p) => p.id === partnerId);
  if (!partner) return { error: `No trading partner has the ID "${partnerId}".` };
  if (!REQUIRED[set]) return { error: `Set "${set}" can’t be sent. Use 990, 214, 210 or 204.` };
  if (!partner.sets.some((s) => s.set === set && s.dir === 'out')) return { error: `${partner.name} isn’t set up to receive ${set}s from you.` };
  if (!['production', 'test'].includes(env)) return { error: 'env must be "production" or "test".' };
  if (!fields || typeof fields !== 'object') return { error: 'fields must be an object with the TMS data for the file.' };
  // A linked mapping says which values it needs; the built-in layouts need these.
  if (!outboundMapping(db, partner, set)) {
    const missing = REQUIRED[set].filter((k) => fields[k] === undefined || fields[k] === '');
    if (missing.length) return { error: `Missing ${missing.join(', ')} in fields.` };
    if (set === '210' && isNaN(Number(fields.amount))) return { error: 'amount must be a number.' };
  }

  const result = buildOutbound(db, partner, { env, set, control: nextControl(db), ref: ref || REF[set](fields), status: 'awaiting997', fields });
  if (result.error) {
    db.lastControl -= 1; // nothing was sent, so give the number back
    return result;
  }
  const { tx, mapping } = result;
  tx.events = [{ at: now(), text: `${builtFrom(mapping)} (API)` }, { at: now(), text: `Placed in ${partner.id}/outbound for the partner to pick up` }];
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

// Sends an outbound file again under the same control number. Files built from TMS data are
// rebuilt with the partner's current mapping, so a fixed mapping fixes the resent file.
// Returns the transaction, or { error }.
export function resend(db, i) {
  const t = db.transactions[i];
  let raw = t.raw;
  let text = 'Sent again';
  if (t.dir === 'out' && t.set !== '997' && t.fields) {
    const partner = db.partners.find((p) => p.id === t.partnerId);
    const result = buildOutbound(db, partner, t);
    if (result.error) return result;
    raw = result.tx.raw;
    text = `Rebuilt and sent again (${result.mapping ? `mapping “${result.mapping.name}” v${result.mapping.version}` : 'built-in layout'})`;
  }
  db.transactions[i] = { ...t, raw, status: 'awaiting997', ack: 'Pending', sentAt: now(), events: [...t.events, { at: now(), text }] };
  return db.transactions[i];
}

const TEST_FIELDS = {
  '990': { shipmentId: 'TEST', action: 'A', po: 'TEST-PO' },
  '214': { shipmentId: 'TEST', status: 'X3', city: 'Akron', state: 'OH', po: 'TEST-PO' },
  '210': { invoice: 'TEST', shipmentId: 'TEST', amount: 100, po: 'TEST-PO' },
};

// Sends a test file for the partner's first outbound 990, 214 or 210.
// Returns { tx }, { error }, or null when there's nothing to test with.
export function sendTest(db, partner) {
  const out = partner.sets.find((s) => s.dir === 'out' && TEST_FIELDS[s.set]);
  if (!out) return null;
  const result = buildOutbound(db, partner, { env: 'test', set: out.set, control: nextControl(db), ref: `Test ${out.set}`, status: 'awaiting997', fields: TEST_FIELDS[out.set] });
  if (result.error) {
    db.lastControl -= 1;
    return result;
  }
  result.tx.events[0] = { at: now(), text: builtFrom(result.mapping) };
  db.transactions.unshift(result.tx);
  return result;
}
