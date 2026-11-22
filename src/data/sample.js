// Sample data so the app opens in a realistic working state. All companies are fictional.
import { buildX12 } from '../lib/x12.js';

export const OUR_IDS = { qualifier: 'ZZ', id: 'GOODENOUGH', testId: 'GOODENOUGHT', as2Id: 'GOODENOUGH-AS2' };

export const partners = [
  {
    id: 'atlas', name: 'Atlas Cold Chain', role: 'Shipper', status: 'Live',
    isaId: 'ATLASCOLD', testIsaId: 'ATLASCOLDT', version: '004010',
    connection: { type: 'sftp-hosted', host: 'sftp.goodenoughedi.example', username: 'atlas-cold', auth: 'SSH key', allowedIps: ['203.0.113.10', '203.0.113.11'], inbound: '/inbound', outbound: '/outbound', healthy: true },
    sets: [
      { set: '204', dir: 'in', guideline: 'atlas-204', mapping: 'atlas-204-load', stage: 'Live', ack: true },
      { set: '990', dir: 'out', guideline: 'std-990', mapping: null, stage: 'Live', ack: true },
      { set: '214', dir: 'out', guideline: 'std-214', mapping: null, stage: 'Testing', ack: true },
      { set: '210', dir: 'out', guideline: 'std-210', mapping: null, stage: 'Not started', ack: true },
    ],
    contacts: [
      { name: 'Priya Nandakumar', title: 'EDI analyst', email: 'edi@atlascold.example', phone: '(614) 555-0142' },
      { name: 'Marcus Webb', title: 'Transportation manager', email: 'mwebb@atlascold.example', phone: '(614) 555-0177' },
    ],
    checklist: [
      { label: 'Partner guideline received', done: true },
      { label: 'IDs and connection details exchanged', done: true },
      { label: 'SSH key added and test login confirmed', done: true },
      { label: '204 test files passed', done: true },
      { label: '214 test files passed', done: false },
      { label: '210 test files passed', done: false },
      { label: 'Go-live date agreed', done: false },
    ],
  },
  {
    id: 'northline', name: 'Northline Foods', role: 'Shipper', status: 'Live',
    isaId: 'NORTHLINE', testIsaId: 'NORTHLINET', version: '004010',
    connection: { type: 'sftp-remote', host: 'edi.northlinefoods.example', username: 'goodenough', auth: 'SSH key', allowedIps: [], inbound: '/to_carrier', outbound: '/from_carrier', healthy: true },
    sets: [
      { set: '204', dir: 'in', guideline: 'northline-204', mapping: 'northline-204-load', stage: 'Live', ack: true },
      { set: '990', dir: 'out', guideline: 'std-990', mapping: null, stage: 'Live', ack: true },
      { set: '214', dir: 'out', guideline: 'std-214', mapping: null, stage: 'Live', ack: true },
    ],
    contacts: [{ name: 'Dana Ruiz', title: 'Logistics IT', email: 'edi-support@northlinefoods.example', phone: '(312) 555-0110' }],
    checklist: [
      { label: 'Partner guideline received', done: true },
      { label: 'IDs and connection details exchanged', done: true },
      { label: 'SFTP login to their server confirmed', done: true },
      { label: 'All transaction sets passed testing', done: true },
      { label: 'Go-live date agreed', done: true },
    ],
  },
  {
    id: 'bluewater', name: 'Bluewater Retail', role: 'Customer', status: 'Live',
    isaId: 'BLUEWATER', testIsaId: 'BLUEWATERT', version: '004010',
    connection: { type: 'as2', host: 'https://as2.bluewaterretail.example/receive', username: 'BLUEWATER-AS2', auth: 'Certificate · expires Mar 2027', allowedIps: ['198.51.100.24'], inbound: '', outbound: '', healthy: true },
    sets: [
      { set: '214', dir: 'out', guideline: 'std-214', mapping: null, stage: 'Live', ack: true },
      { set: '210', dir: 'out', guideline: 'std-210', mapping: null, stage: 'Live', ack: true },
    ],
    contacts: [{ name: 'Tom Okoro', title: 'Supply chain systems', email: 'b2b@bluewaterretail.example', phone: '(216) 555-0193' }],
    checklist: [
      { label: 'Partner guideline received', done: true },
      { label: 'AS2 certificates exchanged', done: true },
      { label: 'Test MDN receipts confirmed', done: true },
      { label: 'All transaction sets passed testing', done: true },
      { label: 'Go-live date agreed', done: true },
    ],
  },
  {
    id: 'ridgeback', name: 'Ridgeback Carriers', role: 'Carrier', status: 'Onboarding',
    isaId: 'RIDGEBACK', testIsaId: 'RIDGEBACKT', version: '004010',
    connection: { type: 'sftp-hosted', host: 'sftp.goodenoughedi.example', username: 'ridgeback', auth: 'Password (switch to SSH key)', allowedIps: [], inbound: '/inbound', outbound: '/outbound', healthy: false },
    sets: [
      { set: '204', dir: 'out', guideline: 'std-204-out', mapping: null, stage: 'Testing', ack: true },
      { set: '990', dir: 'in', guideline: 'std-990', mapping: null, stage: 'Testing', ack: true },
      { set: '214', dir: 'in', guideline: 'std-214', mapping: null, stage: 'Not started', ack: true },
    ],
    contacts: [{ name: 'Jess Albright', title: 'Dispatch lead', email: 'dispatch@ridgeback.example', phone: '(330) 555-0158' }],
    checklist: [
      { label: 'Partner guideline received', done: true },
      { label: 'IDs and connection details exchanged', done: true },
      { label: 'SSH key added and test login confirmed', done: false },
      { label: '204 test files passed', done: false },
      { label: '990 test files passed', done: false },
      { label: 'Go-live date agreed', done: false },
    ],
  },
];

export const guidelines = [
  {
    id: 'atlas-204', name: 'Atlas 204 v2', set: '204', partnerId: 'atlas',
    rules: [
      { seg: 'B2', el: 4, required: true, text: 'B2-04 shipment ID is required.' },
      { seg: 'L11', el: 1, required: true, text: 'L11 PO number is required.' },
      { seg: 'S5', minCount: 2, text: 'At least one pickup and one delivery stop are required.' },
      { seg: 'G62', el: 2, required: true, text: 'G62 date is missing. The guideline requires a date on every stop.' },
      { seg: 'N4', el: 3, pattern: '^\\d{5}(\\d{4})?$', text: 'N4 ZIP code must be 5 or 9 digits.' },
    ],
  },
  {
    id: 'northline-204', name: 'Northline 204 v1', set: '204', partnerId: 'northline',
    rules: [
      { seg: 'B2', el: 4, required: true, text: 'B2-04 shipment ID is required.' },
      { seg: 'S5', minCount: 2, text: 'At least one pickup and one delivery stop are required.' },
      { seg: 'N4', el: 3, pattern: '^\\d{5}(\\d{4})?$', text: 'N4 ZIP code must be 5 or 9 digits.' },
      { seg: 'L3', el: 1, required: true, text: 'L3-01 weight is required.' },
    ],
  },
  { id: 'std-204-out', name: 'Standard 204 (outbound)', set: '204', partnerId: null, rules: [{ seg: 'B2', el: 4, required: true, text: 'B2-04 shipment ID is required.' }] },
  { id: 'std-990', name: 'Standard 990', set: '990', partnerId: null, rules: [{ seg: 'B1', el: 4, pattern: '^[AD]$', text: 'B1-04 must be A (accept) or D (decline).' }] },
  { id: 'std-214', name: 'Standard 214', set: '214', partnerId: null, rules: [{ seg: 'AT7', el: 1, required: true, text: 'AT7-01 status code is required.' }] },
  { id: 'std-210', name: 'Standard 210', set: '210', partnerId: null, rules: [{ seg: 'B3', el: 3, required: true, text: 'B3-03 invoice number is required.' }] },
];

const RULES_204 = [
  { seg: 'B2', el: 4, fn: 'copy', target: 'externalRef' },
  { seg: 'B2A', el: 1, fn: 'purpose', target: 'action' },
  { seg: 'ISA', el: 6, fn: 'partner', target: 'customer' },
  { seg: 'L11', el: 1, whereEl: 2, whereEq: 'PO', fn: 'copy', target: 'poNumber' },
  { seg: 'N1', el: 2, whereEl: 1, whereEq: 'SH', fn: 'copy', target: 'pickup.name' },
  { seg: 'N4', el: 1, occurrence: 1, fn: 'copy', target: 'pickup.city' },
  { seg: 'N4', el: 2, occurrence: 1, fn: 'copy', target: 'pickup.state' },
  { seg: 'N4', el: 3, occurrence: 1, fn: 'copy', target: 'pickup.zip' },
  { seg: 'G62', el: 2, whereEl: 1, whereEq: '10', fn: 'date', target: 'pickup.date' },
  { seg: 'N1', el: 2, whereEl: 1, whereEq: 'CN', fn: 'copy', target: 'delivery.name' },
  { seg: 'N4', el: 1, occurrence: 2, fn: 'copy', target: 'delivery.city' },
  { seg: 'N4', el: 2, occurrence: 2, fn: 'copy', target: 'delivery.state' },
  { seg: 'N4', el: 3, occurrence: 2, fn: 'copy', target: 'delivery.zip' },
  { seg: 'G62', el: 2, whereEl: 1, whereEq: '70', fn: 'date', target: 'delivery.date' },
  { seg: 'L3', el: 1, fn: 'number', target: 'weightLbs' },
  { seg: 'L3', el: 5, fn: 'money', target: 'rate' },
];

const withIds = (rules, prefix) => rules.map((r, i) => ({ id: `${prefix}-${i + 1}`, occurrence: 1, whereEl: '', whereEq: '', ...r }));

export const mappings = [
  { id: 'atlas-204-load', name: 'Atlas 204 → Load', partnerId: 'atlas', set: '204', version: 3, status: 'Draft', sampleTxId: 'tx-377', rules: withIds(RULES_204, 'a') },
  { id: 'northline-204-load', name: 'Northline 204 → Load', partnerId: 'northline', set: '204', version: 1, status: 'Live', sampleTxId: 'tx-4812', rules: withIds(RULES_204, 'n') },
];

// ---- Transactions ----

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

function load(id, po, from, to, weight, rate, opts = {}) {
  const tomorrow = new Date(Date.now() + 86400000);
  const later = new Date(Date.now() + 2 * 86400000);
  return {
    shipmentId: id, po, weight, rate, purpose: opts.purpose,
    pickup: { ...from, date: opts.noPickupDate ? '' : ymd(tomorrow) },
    delivery: { ...to, date: ymd(later) },
  };
}

const PLACES = {
  atlasDc: { name: 'Atlas Cold Chain DC 4', street: '1200 Freezer Way', city: 'Columbus', state: 'OH', zip: '43215' },
  harbor: { name: 'Harbor Market #12', street: '88 Lakeshore Blvd', city: 'Akron', state: 'OH', zip: '44308' },
  harborBad: { name: 'Harbor Market #12', street: '88 Lakeshore Blvd', city: 'Akron', state: 'OH', zip: '4410' },
  northPlant: { name: 'Northline Foods Plant 2', street: '400 Mill Rd', city: 'Joliet', state: 'IL', zip: '60431' },
  bluewaterDc: { name: 'Bluewater Retail DC East', street: '9 Commerce Pkwy', city: 'Erie', state: 'PA', zip: '16509' },
};

// [minutesAgo, env, dir, partnerId, set, control, ref, status, fields]
const SPECS = [
  [6, 'production', 'in', 'northline', '204', '000004812', 'Load 30117', 'delivered', load('30117', 'NF-55120', PLACES.northPlant, PLACES.bluewaterDc, 41200, 1875)],
  [6, 'production', 'out', 'northline', '990', '000002203', 'Load 30117 · Accept', 'awaiting997', { shipmentId: '30117', action: 'A' }],
  [11, 'production', 'out', 'bluewater', '214', '000002202', 'Load 30098 · Arrived', 'acknowledged', { shipmentId: '30098', status: 'X3', city: 'Erie', state: 'PA' }],
  [17, 'production', 'in', 'atlas', '204', '000000377', 'Load 30116', 'delivered', load('30116', 'PO-88213', PLACES.atlasDc, PLACES.harborBad, 38000, 2150, { noPickupDate: true })],
  [28, 'production', 'out', 'bluewater', '210', '000002201', 'Invoice 7741', 'acknowledged', { invoice: '7741', shipmentId: '30091', amount: 1640 }],
  [43, 'production', 'in', 'northline', '204', '000004811', 'Load 30115 · Cancel', 'delivered', load('30115', 'NF-55102', PLACES.northPlant, PLACES.harbor, 36000, 1720, { purpose: '01' })],
  [50, 'production', 'out', 'ridgeback', '204', '000002200', 'Load 30101 tender', 'awaiting997', load('30101', 'PO-88190', PLACES.atlasDc, PLACES.harbor, 39500, 1450)],
  [64, 'production', 'in', 'atlas', '204', '000000376', 'Load 30114', 'delivered', load('30114', 'PO-88207', PLACES.atlasDc, PLACES.harbor, 40100, 2090)],
  [65, 'production', 'out', 'atlas', '990', '000002199', 'Load 30114 · Accept', 'acknowledged', { shipmentId: '30114', action: 'A' }],
  [96, 'production', 'out', 'northline', '214', '000002198', 'Load 30110 · Picked up', 'acknowledged', { shipmentId: '30110', status: 'AF', city: 'Joliet', state: 'IL' }],
  [130, 'production', 'out', 'bluewater', '214', '000002197', 'Load 30098 · Delivered', 'rejected', { shipmentId: '30098', status: 'D1', city: 'Erie', state: 'PA' }],
  [190, 'production', 'in', 'northline', '204', '000004810', 'Load 30112', 'delivered', load('30112', 'NF-55091', PLACES.northPlant, PLACES.atlasDc, 42000, 1990)],
  [25, 'test', 'in', 'ridgeback', '990', '000000912', 'Load 30101 · Decline', 'delivered', { shipmentId: '30101', action: 'D' }],
  [40, 'test', 'out', 'ridgeback', '204', '000000058', 'Test tender', 'acknowledged', load('TEST1', 'TEST-PO', PLACES.atlasDc, PLACES.harbor, 10000, 500)],
  [75, 'test', 'out', 'atlas', '214', '000000057', 'Test status · Arrived', 'acknowledged', { shipmentId: 'TEST2', status: 'X3', city: 'Akron', state: 'OH' }],
];

const ACK_FOR = { delivered: 'Sent', awaiting997: 'Pending', acknowledged: 'Accepted', rejected: 'Rejected', failed: 'Rejected', sent: 'Pending', resolved: 'Rejected' };

export function makeTransaction({ minutesAgo = 0, env, dir, partner, set, control, ref, status, fields }) {
  const date = new Date(Date.now() - minutesAgo * 60000);
  const ours = env === 'test' ? OUR_IDS.testId : OUR_IDS.id;
  const theirs = env === 'test' ? partner.testIsaId : partner.isaId;
  const extra = set === '990' ? { date: ymd(date) } : set === '214' ? { date: ymd(date), time: '0000' } : set === '210' ? { date: ymd(date) } : {};
  const raw = buildX12({
    set, control, date, usage: env === 'test' ? 'T' : 'P',
    senderId: dir === 'in' ? theirs : ours,
    receiverId: dir === 'in' ? ours : theirs,
    fields: { ...fields, ...extra },
  });
  const via = partner.connection.type === 'as2' ? 'AS2' : 'SFTP';
  const t = (sec) => new Date(date.getTime() + sec * 1000).toISOString();
  const events = dir === 'in'
    ? [
        { at: t(0), text: `File received over ${via}` },
        { at: t(1), text: `Matched to partner ${partner.name}` },
        { at: t(1), text: 'Checked against guideline' },
      ]
    : [
        { at: t(0), text: 'Built from TMS data' },
        { at: t(1), text: `Sent to ${partner.name} over ${via}` },
      ];
  if (status === 'acknowledged') events.push({ at: t(40), text: '997 received: accepted' });
  if (status === 'rejected') events.push({ at: t(40), text: '997 received: rejected by partner' });
  return {
    id: `tx-${Number(control)}`, time: date.toISOString(), env, dir, partnerId: partner.id, set, control, ref,
    status, ack: ACK_FOR[status], via, raw, fields, events, errors: [],
  };
}

export function sampleTransactions() {
  return SPECS.map(([minutesAgo, env, dir, partnerId, set, control, ref, status, fields]) =>
    makeTransaction({ minutesAgo, env, dir, partner: partners.find((p) => p.id === partnerId), set, control, ref, status, fields }),
  );
}

export const sampleSettings = {
  companyName: 'Good Enough Brokerage',
  notifyEmail: 'edi-team@goodenoughbrokerage.example',
  retentionDays: 90,
  apiKey: 'ge_live_7Q2mXc91rTb4Lw0pZs8kVn3e',
  webhooks: [
    // The built-in Test TMS (Test TMS page). Point this at your real TMS when you have one.
    { id: 'wh-1', url: 'http://localhost:3002/api/mock-tms/webhook', events: ['transaction.received', 'transaction.failed', 'transaction.sent', 'ack.received'], active: true },
  ],
};
