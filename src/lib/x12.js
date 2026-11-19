// Small X12 helpers: build sample files, read them into segments, check them against a
// partner guideline, and run a mapping that turns an inbound file into TMS JSON.

const GS_CODES = { '204': 'SM', '990': 'GF', '214': 'QM', '210': 'IM', '997': 'FA' };

export const SET_NAMES = {
  '204': 'Load Tender',
  '990': 'Tender Response',
  '214': 'Shipment Status',
  '210': 'Freight Invoice',
  '997': 'Functional Acknowledgment',
};

export const SEGMENT_NAMES = {
  ISA: 'Interchange header', GS: 'Group header', ST: 'Transaction set header',
  B2: 'Shipment information', B2A: 'Purpose', L11: 'Reference', S5: 'Stop',
  G62: 'Date/time', N1: 'Name', N3: 'Address', N4: 'City/state/ZIP', L3: 'Totals',
  B1: 'Tender response', B10: 'Shipment reference', LX: 'Line number', AT7: 'Shipment status',
  MS1: 'Location', B3: 'Invoice information', AK1: 'Group response header',
  AK2: 'Set response header', AK5: 'Set response trailer', AK9: 'Group response trailer',
  SE: 'Transaction set trailer', GE: 'Group trailer', IEA: 'Interchange trailer',
};

const ELEMENT_LABELS = {
  'ISA-06': 'Sender ID', 'ISA-08': 'Receiver ID', 'ISA-09': 'Date', 'ISA-10': 'Time',
  'ISA-13': 'Interchange control #', 'ISA-15': 'Usage (P/T)',
  'GS-01': 'Functional code', 'GS-06': 'Group control #', 'GS-08': 'Version',
  'ST-01': 'Set', 'ST-02': 'Set control #',
  'B2-02': 'SCAC', 'B2-04': 'Shipment ID', 'B2-06': 'Payment method',
  'B2A-01': 'Purpose (00 new, 01 cancel)',
  'L11-01': 'Reference number', 'L11-02': 'Qualifier',
  'S5-01': 'Stop #', 'S5-02': 'Reason (LD pickup, UL delivery)',
  'G62-01': 'Qualifier (10 pickup, 70 delivery)', 'G62-02': 'Date',
  'N1-01': 'Entity (SH shipper, CN consignee)', 'N1-02': 'Name',
  'N3-01': 'Street', 'N4-01': 'City', 'N4-02': 'State', 'N4-03': 'ZIP',
  'L3-01': 'Weight', 'L3-05': 'Charge',
  'B1-02': 'Shipment ID', 'B1-04': 'Action (A accept, D decline)',
  'B10-02': 'Shipment ID', 'AT7-01': 'Status code', 'AT7-05': 'Date', 'AT7-06': 'Time',
  'MS1-01': 'City', 'MS1-02': 'State',
  'B3-03': 'Invoice #', 'B3-07': 'Amount (cents)', 'B3-06': 'Invoice date',
  'AK1-02': 'Group control #', 'AK2-01': 'Set', 'AK5-01': 'Result (A accepted, R rejected)',
  'AK9-01': 'Group result',
};

const pad = (s, n) => String(s).padEnd(n, ' ').slice(0, n);
const two = (n) => String(n).padStart(2, '0');

function stamp(date) {
  return {
    yymmdd: `${two(date.getFullYear() % 100)}${two(date.getMonth() + 1)}${two(date.getDate())}`,
    ccyymmdd: `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`,
    hhmm: `${two(date.getHours())}${two(date.getMinutes())}`,
  };
}

function body(set, f) {
  switch (set) {
    case '204':
      return [
        `B2**GEBK**${f.shipmentId}**PP`,
        `B2A*${f.purpose || '00'}`,
        `L11*${f.po}*PO`,
        'S5*1*LD',
        f.pickup.date ? `G62*10*${f.pickup.date}` : 'G62*10',
        `N1*SH*${f.pickup.name}`,
        `N3*${f.pickup.street}`,
        `N4*${f.pickup.city}*${f.pickup.state}*${f.pickup.zip}`,
        'S5*2*UL',
        f.delivery.date ? `G62*70*${f.delivery.date}` : 'G62*70',
        `N1*CN*${f.delivery.name}`,
        `N3*${f.delivery.street}`,
        `N4*${f.delivery.city}*${f.delivery.state}*${f.delivery.zip}`,
        `L3*${f.weight}*G***${f.rate}`,
      ];
    case '990':
      return [`B1*GEBK*${f.shipmentId}*${f.date}*${f.action}`];
    case '214':
      return [
        `B10*${f.shipmentId}*${f.shipmentId}*GEBK`,
        'LX*1',
        `AT7*${f.status}*NS***${f.date}*${f.time}`,
        `MS1*${f.city}*${f.state}`,
      ];
    case '210':
      return [`B3**${f.invoice}*${f.shipmentId}*PP**${f.date}*${Math.round(f.amount * 100)}`];
    case '997':
      return [`AK1*${GS_CODES[f.ackSet]}*${Number(f.ackControl)}`, `AK2*${f.ackSet}*0001`, `AK5*${f.accepted ? 'A' : 'R'}`, `AK9*${f.accepted ? 'A' : 'R'}*1*1*${f.accepted ? 1 : 0}`];
    default:
      return [];
  }
}

// Builds a complete interchange (ISA through IEA), one segment per line.
export function buildX12({ set, control, senderId, receiverId, date, usage = 'P', fields }) {
  const s = stamp(date);
  const group = String(Number(control));
  const inner = [`ST*${set}*0001`, ...body(set, fields)];
  inner.push(`SE*${inner.length + 1}*0001`);
  const lines = [
    `ISA*00*${pad('', 10)}*00*${pad('', 10)}*ZZ*${pad(senderId, 15)}*ZZ*${pad(receiverId, 15)}*${s.yymmdd}*${s.hhmm}*U*00401*${control}*0*${usage}*>`,
    `GS*${GS_CODES[set]}*${senderId}*${receiverId}*${s.ccyymmdd}*${s.hhmm}*${group}*X*004010`,
    ...inner,
    `GE*1*${group}`,
    `IEA*1*${control}`,
  ];
  return lines.map((l) => `${l}~`).join('\n');
}

// Splits a file into segments: [{ line, id, elements, text }]. Element n is elements[n - 1].
export function parseX12(raw) {
  return raw
    .split('~')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text, i) => {
      const [id, ...elements] = text.split('*');
      return { line: i + 1, id, elements: elements.map((e) => e.trim()), text };
    });
}

export function elementLabel(segId, n) {
  return ELEMENT_LABELS[`${segId}-${two(n)}`] || `${segId}-${two(n)}`;
}

export function envelope(segments) {
  const isa = segments.find((s) => s.id === 'ISA');
  const gs = segments.find((s) => s.id === 'GS');
  const st = segments.find((s) => s.id === 'ST');
  return {
    senderId: isa?.elements[5] || '',
    receiverId: isa?.elements[7] || '',
    control: isa?.elements[12] || '',
    usage: isa?.elements[14] || '',
    group: gs?.elements[5] || '',
    version: gs?.elements[7] || '',
    set: st?.elements[0] || '',
  };
}

// Guideline rules: { seg, el, required } | { seg, el, pattern } | { seg, minCount }.
export function validate(segments, guideline) {
  if (!guideline) return [];
  const errors = [];
  for (const rule of guideline.rules) {
    const matches = segments.filter((s) => s.id === rule.seg);
    if (rule.minCount) {
      if (matches.length < rule.minCount) errors.push({ line: null, text: rule.text });
      continue;
    }
    if (rule.required && matches.length === 0) {
      errors.push({ line: null, text: rule.text });
      continue;
    }
    for (const s of matches) {
      const value = s.elements[rule.el - 1] || '';
      if (rule.required && !value) errors.push({ line: s.line, text: rule.text });
      else if (rule.pattern && value && !new RegExp(rule.pattern).test(value)) {
        errors.push({ line: s.line, text: `${rule.text} Found "${value}".` });
      }
    }
  }
  return errors;
}

// ---- Mapping engine ----

export const TRANSFORMS = {
  copy: { label: 'Copy', run: (v) => v },
  number: { label: 'Number', run: (v) => (isNaN(Number(v)) ? undefined : Number(v)) },
  money: { label: 'Number, 2 decimals', run: (v) => (isNaN(Number(v)) ? undefined : Math.round(Number(v) * 100) / 100) },
  date: {
    label: 'Date YYYYMMDD',
    run: (v) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : undefined),
  },
  purpose: { label: '00 → new, 01 → cancel', run: (v) => ({ '00': 'new', '01': 'cancel' }[v]) },
  partner: { label: 'Look up partner', run: (v, ctx) => ctx.partnerName(v) },
};

export function describeSource(rule) {
  let s = `${rule.seg}-${two(rule.el)}`;
  if (rule.whereEl && rule.whereEq) s += ` where ${rule.seg}-${two(rule.whereEl)} = ${rule.whereEq}`;
  if (Number(rule.occurrence) > 1) s += ` (#${rule.occurrence})`;
  return s;
}

export function runRule(segments, rule, ctx) {
  const matches = segments.filter(
    (s) => s.id === rule.seg && (!rule.whereEl || !rule.whereEq || s.elements[rule.whereEl - 1] === rule.whereEq),
  );
  const seg = matches[(Number(rule.occurrence) || 1) - 1];
  const raw = seg ? seg.elements[rule.el - 1] : undefined;
  if (raw === undefined || raw === '') return { ok: false, value: null, note: 'missing' };
  const value = TRANSFORMS[rule.fn]?.run(raw, ctx);
  if (value === undefined) return { ok: false, value: null, note: `can't convert "${raw}"` };
  return { ok: true, value };
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  keys.slice(0, -1).forEach((k) => {
    cur[k] = cur[k] || {};
    cur = cur[k];
  });
  cur[keys[keys.length - 1]] = value;
}

export function runMapping(segments, rules, ctx) {
  const output = {};
  const results = rules.map((rule) => {
    const r = runRule(segments, rule, ctx);
    if (rule.target) setPath(output, rule.target, r.value);
    return r;
  });
  return { output, results, failed: results.filter((r) => !r.ok).length };
}
