// Small X12 helpers: build sample files, read them into segments, check them against a
// partner guideline, run a mapping that turns an inbound file into TMS JSON, and run an
// outbound mapping that turns TMS JSON into a partner's X12.

const GS_CODES = { '204': 'SM', '990': 'GF', '214': 'QM', '210': 'IM', '997': 'FA' };
// The set a group's functional code (GS-01, AK1-01) stands for.
export const SET_FOR_CODE = Object.fromEntries(Object.entries(GS_CODES).map(([set, code]) => [code, set]));

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

// The built-in layout of each set, used when a partner has no outbound mapping.
function defaultBody(set, f) {
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
      return ack997Body({ code: GS_CODES[f.ackSet], control: Number(f.ackControl), sets: [{ set: f.ackSet, control: '0001', errors: f.accepted ? [] : [{ text: 'Rejected' }] }] });
    default:
      return [];
  }
}

// Values every outbound file gets from the moment it's built, on top of the TMS fields.
export function stampFields(set, fields, date) {
  const s = stamp(date);
  const extra = set === '214' ? { date: s.ccyymmdd, time: '0000' } : ['990', '210'].includes(set) ? { date: s.ccyymmdd } : {};
  return { ...fields, ...extra };
}

// Builds a complete interchange (ISA through IEA), one segment per line. `body` is a list of
// segment lines (e.g. from runOutboundMapping); without it the set's built-in layout is used.
// `bodies` puts several transaction sets of the same kind in the one group (used for 997s).
export function buildX12({ set, control, senderId, receiverId, date, usage = 'P', fields, body, bodies, version = '004010' }) {
  const s = stamp(date);
  const group = String(Number(control));
  const inner = (bodies || [body || defaultBody(set, fields)]).flatMap((lines, i) => {
    const setControl = String(i + 1).padStart(4, '0');
    const seg = [`ST*${set}*${setControl}`, ...lines];
    return [...seg, `SE*${seg.length + 1}*${setControl}`];
  });
  // 00501 files use ISA-11 as the repetition separator; earlier versions put U there.
  const isa5 = version.startsWith('005');
  const lines = [
    `ISA*00*${pad('', 10)}*00*${pad('', 10)}*ZZ*${pad(senderId, 15)}*ZZ*${pad(receiverId, 15)}*${s.yymmdd}*${s.hhmm}*${isa5 ? '^' : 'U'}*${isa5 ? '00501' : '00401'}*${control}*0*${usage}*>`,
    `GS*${GS_CODES[set]}*${senderId}*${receiverId}*${s.ccyymmdd}*${s.hhmm}*${group}*X*${version}`,
    ...inner,
    `GE*${bodies ? bodies.length : 1}*${group}`,
    `IEA*1*${control}`,
  ];
  return lines.map((l) => `${l}~`).join('\n');
}

// ---- Reading files ----
// Partners pick their own separators, and the ISA says which. The character right after
// "ISA" separates elements, ISA-16 is the component separator, and the character after
// ISA-16 ends every segment. The ISA is fixed width (106 characters with its terminator),
// but we count element separators instead of columns, so an ID that wasn't padded properly
// doesn't throw everything off. From version 00501, ISA-11 is the repetition separator.
// Files we build ourselves always use * ~ and >.
const DEFAULT_DELIMITERS = { element: '*', component: '>', segment: '~', repetition: null };
const NOT_X12 = 'This doesn’t look like an X12 file. It should start with an ISA segment.';

// Takes off a byte order mark and anything blank before the ISA.
const cleanStart = (raw) => String(raw ?? '').replace(/^﻿/, '').replace(/^\s+/, '');

export function readDelimiters(raw) {
  const text = cleanStart(raw);
  if (!text.startsWith('ISA')) return { error: NOT_X12 };
  const element = text[3];
  if (!element || /[\sA-Za-z0-9]/.test(element)) return { error: `${NOT_X12} The character after "ISA" should be the element separator.` };
  let at = 3;
  for (let n = 2; n <= 16; n++) {
    at = text.indexOf(element, at + 1);
    if (at < 0 || at > 200) return { error: `The ISA segment is cut short: it should have 16 elements separated by "${element}".` };
  }
  const component = text[at + 1];
  const segment = text[at + 2];
  if (!component || /[\sA-Za-z0-9]/.test(component) || component === element) return { error: 'ISA-16 should be the component separator, a single symbol such as > or :.' };
  if (!segment || /[A-Za-z0-9 ]/.test(segment) || [element, component].includes(segment)) return { error: 'The ISA segment should end with a segment terminator, such as ~, right after ISA-16.' };
  const isa = text.slice(0, at + 1).split(element);
  const repetition = isa[12] >= '00501' && /^[^\sA-Za-z0-9]$/.test(isa[11]) ? isa[11] : null;
  return { element, component, segment, repetition };
}

// Reads a file into { delimiters, segments, error }. Each segment is
// { line, id, elements, text }; element n is elements[n - 1] and `line` counts segments
// from 1. Blank space and line breaks after each terminator are ignored. A file without a
// valid ISA is read with the usual * and ~ and comes back with an error.
export function readX12(raw) {
  const found = readDelimiters(raw);
  const delimiters = found.error ? DEFAULT_DELIMITERS : found;
  const segments = cleanStart(raw)
    .split(delimiters.segment)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text, i) => {
      const [id, ...elements] = text.split(delimiters.element);
      return { line: i + 1, id, elements: elements.map((e) => e.trim()), text };
    });
  return { delimiters, segments, error: found.error };
}

export function parseX12(raw) {
  return readX12(raw).segments;
}

const sameControl = (a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) === Number(b) : a === b);

// Splits an interchange into its groups (GS..GE) and transaction sets (ST..SE) and checks the
// envelope: ISA-13 = IEA-02, IEA-01 = number of groups, GS-06 = GE-02, GE-01 = number of sets,
// ST-02 = SE-02 and SE-01 = number of segments from ST to SE. Returns { error } for a file
// without a valid ISA, otherwise:
//   { delimiters, segments, problems, groups: [{ code, control, version, count (GE-01), gs, ge, problems,
//     sets: [{ set, control, st, end, problems, errors }] }] }
// gs, ge, st and end are line numbers (ge is null when the GE is missing). Each problem is
// { line, text } plus `ak5` or `ak9`, the code our 997 reports it with. A set's `errors` are
// every envelope problem that touches it: its own, its group's and the whole file's.
export function splitInterchange(raw) {
  const { delimiters, segments, error } = readX12(raw);
  if (error) return { error };
  const isa = segments[0];
  const problems = [];
  const groups = [];
  let group = null;
  let set = null;
  let iea = null;
  const problem = (line, text, code = {}) => ({ line, text, ...code });

  const closeSet = (lastLine) => {
    set.end = lastLine;
    set.problems.push(problem(set.st, `Transaction set ${set.control} (ST at line ${set.st}) has no SE.`, { ak5: '2' }));
    set = null;
  };
  const closeGroup = (line) => {
    if (set) closeSet(line - 1);
    group.problems.push(problem(group.gs, `Group ${group.control} (GS at line ${group.gs}) has no GE.`, { ak9: '2' }));
    group = null;
  };

  for (const seg of segments.slice(1)) {
    const el = (n) => seg.elements[n - 1] || '';
    if (iea) {
      problems.push(problem(seg.line, `${seg.id} at line ${seg.line} comes after the IEA, which should end the file.`));
      continue;
    }
    if (seg.id === 'GS') {
      if (group) closeGroup(seg.line);
      group = { code: el(1), control: el(6), version: el(8), gs: seg.line, ge: null, problems: [], sets: [] };
      groups.push(group);
    } else if (seg.id === 'ST') {
      if (set) closeSet(seg.line - 1);
      if (!group) {
        group = { code: '', control: '', version: '', gs: null, ge: null, problems: [problem(seg.line, `ST at line ${seg.line} isn’t inside a group (GS).`, { ak9: '2' })], sets: [] };
        groups.push(group);
      }
      set = { set: el(1), control: el(2), st: seg.line, end: null, problems: [] };
      group.sets.push(set);
    } else if (seg.id === 'SE') {
      if (!set) {
        (group?.problems || problems).push(problem(seg.line, `SE at line ${seg.line} has no ST before it.`));
        continue;
      }
      const count = seg.line - set.st + 1;
      if (String(Number(el(1))) !== String(count)) set.problems.push(problem(seg.line, `SE-01 says the set has ${el(1) || 'no'} segments, but it has ${count} from ST to SE.`, { ak5: '4' }));
      if (!sameControl(el(2), set.control)) set.problems.push(problem(seg.line, `SE-02 control number "${el(2)}" doesn’t match ST-02 "${set.control}".`, { ak5: '3' }));
      set.end = seg.line;
      set = null;
    } else if (seg.id === 'GE') {
      if (set) closeSet(seg.line - 1);
      if (!group) {
        problems.push(problem(seg.line, `GE at line ${seg.line} has no GS before it.`));
        continue;
      }
      group.ge = seg.line;
      group.count = el(1);
      if (String(Number(el(1))) !== String(group.sets.length)) group.problems.push(problem(seg.line, `GE-01 says group ${group.control} has ${el(1) || 'no'} transaction sets, but it has ${group.sets.length}.`, { ak9: '5' }));
      if (!sameControl(el(2), group.control)) group.problems.push(problem(seg.line, `GE-02 control number "${el(2)}" doesn’t match GS-06 "${group.control}".`, { ak9: '4' }));
      group = null;
    } else if (seg.id === 'IEA') {
      if (group) closeGroup(seg.line);
      iea = seg;
      if (String(Number(el(1))) !== String(groups.length)) problems.push(problem(seg.line, `IEA-01 says the file has ${el(1) || 'no'} groups, but it has ${groups.length}.`));
      if (!sameControl(el(2), isa.elements[12])) problems.push(problem(seg.line, `IEA-02 control number "${el(2)}" doesn’t match ISA-13 "${isa.elements[12]}".`));
    } else if (!set) {
      (group?.problems || problems).push(problem(seg.line, `${seg.id} at line ${seg.line} is outside any transaction set (ST to SE).`));
    }
  }
  const last = segments[segments.length - 1].line;
  if (set) closeSet(last);
  if (group) closeGroup(last + 1);
  if (!iea) problems.push(problem(null, 'The file has no IEA at the end. It may have been cut off.'));

  for (const g of groups) for (const s of g.sets) s.errors = [...problems, ...g.problems, ...s.problems];
  return { delimiters, segments, problems, groups };
}

// The segments an inbound transaction is about. An entry from a file holding several
// transaction sets keeps the whole file as received in `raw`, plus `part`: the line numbers
// of its group's GS and GE and its own ST through its last line. We keep the real file
// rather than a rebuilt copy so line numbers match what the partner sent (handy when telling
// them "line 37 is wrong") and Download gives back their actual file. Entries from
// single-set files have no `part` and use the whole file.
export function txSegments(tx) {
  const all = parseX12(tx?.raw || '');
  const p = tx?.part;
  if (!p) return all;
  return all.filter((s) => s.id === 'ISA' || s.id === 'IEA' || s.line === p.gs || s.line === p.ge || (s.line >= p.st && s.line <= p.end));
}

// ---- 997s ----
// The body of one 997 answering one functional group:
//   group: { code (GS-01), control (GS-06), count (GE-01, optional), problems (group level),
//            sets: [{ set (ST-01), control (ST-02), st (line of the ST), errors }] }
// A set with no errors is accepted (AK5 A). A rejected set gets AK3/AK4 lines for each
// problem we can point at a segment and element, and AK5 R with a reason code. AK9 is
// A when every set was accepted, P when some were and R when none were.
const AK4_CODES = { missing: '1', format: '7' };
const ackValue = (v) => String(v ?? '').replace(/[*~>^]/g, ' ').slice(0, 99);

export function ack997Body(group) {
  const lines = [`AK1*${group.code}*${group.control}`];
  let accepted = 0;
  for (const s of group.sets) {
    lines.push(`AK2*${s.set}*${s.control}`);
    const pointed = s.errors.filter((e) => e.line && e.seg && s.st && e.line >= s.st);
    for (const line of [...new Set(pointed.map((e) => e.line))]) {
      const onLine = pointed.filter((e) => e.line === line);
      lines.push(`AK3*${onLine[0].seg}*${line - s.st + 1}**8`);
      onLine.filter((e) => e.el).forEach((e) => lines.push(`AK4*${e.el}**${AK4_CODES[e.fault] || '7'}${e.value ? `*${ackValue(e.value)}` : ''}`));
    }
    if (!s.errors.length) {
      accepted += 1;
      lines.push('AK5*A');
    } else {
      const codes = [...new Set(s.errors.map((e) => e.ak5).filter(Boolean))];
      lines.push(`AK5*R*${(codes.length ? codes : ['5']).slice(0, 5).join('*')}`);
    }
  }
  const n = group.sets.length;
  const result = accepted === n ? 'A' : accepted ? 'P' : 'R';
  const groupCodes = [...new Set((group.problems || []).map((e) => e.ak9).filter(Boolean))].slice(0, 5);
  lines.push(['AK9', result, group.count ?? n, n, accepted, ...groupCodes].join('*'));
  return lines;
}

// A whole 997 interchange: one GS*FA group holding one 997 per group being answered.
export function build997({ groups, ...envelopeFields }) {
  return buildX12({ ...envelopeFields, set: '997', bodies: groups.map(ack997Body) });
}

// The result a 997 gives a group: A, P or R (see ack997Body).
export function groupResult(group) {
  const ok = group.sets.filter((s) => !s.errors.length).length;
  return ok === group.sets.length ? 'A' : ok ? 'P' : 'R';
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
    setControl: st?.elements[1] || '',
  };
}

// Guideline rules: { seg, el, required } | { seg, el, pattern } | { seg, minCount }.
// Problems found on a segment also say which element and why, for the 997's AK3/AK4.
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
      if (rule.required && !value) errors.push({ line: s.line, text: rule.text, seg: rule.seg, el: rule.el, fault: 'missing' });
      else if (rule.pattern && value && !new RegExp(rule.pattern).test(value)) {
        errors.push({ line: s.line, text: `${rule.text} Found "${value}".`, seg: rule.seg, el: rule.el, fault: 'format', value });
      }
    }
  }
  return errors;
}

// ---- Mapping engine ----

// Mappings made before outbound mappings existed have no direction; they're inbound.
export const mappingDirection = (m) => m?.direction || 'in';

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

// ---- Outbound mapping engine ----
// An outbound mapping (direction 'out') lists the body segments of the file in order:
//   segments: [{ id, seg: 'B1', optional, elements: [{ id, kind, value, path, fn, required }] }]
// kind 'fixed' sends `value` as is; kind 'field' reads `path` (e.g. 'pickup.city') from the
// TMS fields and runs transform `fn`. An optional segment is left out when none of its
// fields have a value.

const twoDigits = (v) => String(v).padStart(2, '0');

export const OUT_TRANSFORMS = {
  copy: { label: 'Copy', run: (v) => String(v) },
  upper: { label: 'Uppercase', run: (v) => String(v).toUpperCase() },
  date: {
    label: 'Date CCYYMMDD',
    run: (v) => {
      const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(v));
      return m ? `${m[1]}${m[2]}${m[3]}` : undefined;
    },
  },
  time: {
    label: 'Time HHMM',
    run: (v) => {
      const m = /(?:^|T)(\d{1,2}):?(\d{2})/.exec(String(v));
      return m ? `${twoDigits(m[1])}${m[2]}` : undefined;
    },
  },
  cents: { label: 'Money in cents', run: (v) => (v === '' || isNaN(Number(v)) ? undefined : String(Math.round(Number(v) * 100))) },
};

const ENVELOPE_IDS = ['ISA', 'GS', 'ST', 'SE', 'GE', 'IEA'];

export function getPath(obj, path) {
  return String(path || '').split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
}

// Every dotted path to a plain value in a TMS JSON object, for suggesting field paths.
export function fieldPaths(obj, prefix = '') {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return prefix ? [prefix] : [];
  return Object.entries(obj).flatMap(([k, v]) => fieldPaths(v, prefix ? `${prefix}.${k}` : k));
}

// One element's value: { ok, value, empty, note }. Separator characters are taken out of
// TMS values so they can't break the file.
export function runOutElement(el, fields) {
  if (el.kind !== 'field') return { ok: true, value: String(el.value ?? ''), empty: false };
  if (!el.path) return { ok: false, value: '', empty: true, note: 'has no TMS field chosen' };
  const raw = getPath(fields, el.path);
  if (raw === undefined || raw === null || raw === '') {
    return el.required ? { ok: false, value: '', empty: true, note: `needs ${el.path}, which is missing from the TMS data` } : { ok: true, value: '', empty: true };
  }
  const transform = OUT_TRANSFORMS[el.fn || 'copy'];
  const value = transform?.run(raw);
  if (value === undefined) return { ok: false, value: '', empty: false, note: `can’t turn "${raw}" (${el.path}) into ${transform?.label || el.fn}` };
  return { ok: true, value: value.replace(/[*~>]/g, ' '), empty: false };
}

// Runs an outbound mapping against TMS fields. Returns:
//   lines:    body segment lines for buildX12 (no ST/SE)
//   segments: per mapping segment { seg, included, line (index into lines or null), results }
//   problems: [{ segment, el, text }] where segment is the index in mapping.segments
export function runOutboundMapping(mapping, fields) {
  const lines = [];
  const problems = [];
  const segments = (mapping?.segments || []).map((s, i) => {
    const seg = String(s.seg || '').trim().toUpperCase();
    const results = s.elements.map((el) => runOutElement(el, fields));
    if (!/^[A-Z][A-Z0-9]{1,2}$/.test(seg)) problems.push({ segment: i, el: null, text: `Segment ${i + 1} needs an ID like B1 or L11.` });
    else if (ENVELOPE_IDS.includes(seg)) problems.push({ segment: i, el: null, text: `${seg} is part of the envelope, which is added automatically. Remove segment ${i + 1}.` });
    const hasFields = s.elements.some((el) => el.kind === 'field');
    const skipped = s.optional && hasFields && s.elements.every((el, j) => el.kind !== 'field' || results[j].empty);
    if (skipped) return { seg, included: false, line: null, results };
    results.forEach((r, j) => {
      if (!r.ok) problems.push({ segment: i, el: j + 1, text: `${seg || `Segment ${i + 1}`}-${twoDigits(j + 1)} ${r.note}.` });
    });
    const values = results.map((r) => r.value);
    while (values.length && values[values.length - 1] === '') values.pop(); // no trailing empty elements
    if (!values.length && problems.every((p) => p.segment !== i)) problems.push({ segment: i, el: null, text: `${seg} has no values. Give it one, or tick “Leave out when its TMS fields are empty”.` });
    lines.push([seg, ...values].join('*'));
    return { seg, included: true, line: lines.length - 1, results };
  });
  return { lines, segments, problems };
}
