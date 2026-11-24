// Checks the X12 reader, splitter and 997 builder against the sample files and a few
// hand-made broken files. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build997, parseX12, readDelimiters, splitInterchange, txSegments, validate } from '../src/lib/x12.js';
import { guidelines } from '../src/data/sample.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = (name) => fs.readFileSync(path.join(ROOT, 'samples', name), 'utf8');
let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}
const shape = (file) => file.groups.map((g) => g.sets.length);
const allErrors = (file) => file.groups.flatMap((g) => g.sets.flatMap((s) => s.errors));

test('old samples read as one clean set with * ~ >', () => {
  for (const name of ['northline-204-good.edi', 'atlas-204-bad.edi', 'wrong-folder-204.edi']) {
    const file = splitInterchange(sample(name));
    assert.deepEqual(file.delimiters, { element: '*', component: '>', segment: '~', repetition: null });
    assert.deepEqual(shape(file), [1]);
    assert.deepEqual(allErrors(file), []);
    assert.equal(file.groups[0].sets[0].st, 3);
    assert.equal(file.groups[0].sets[0].end, 18);
  }
});

test('pipes, ^ terminators and CRLF (00501)', () => {
  const raw = sample('northline-204-pipes-crlf.edi');
  assert.ok(raw.includes('^\r\n'));
  const file = splitInterchange(raw);
  assert.deepEqual(file.delimiters, { element: '|', component: ':', segment: '^', repetition: '{' });
  assert.deepEqual(shape(file), [1]);
  assert.deepEqual(allErrors(file), []);
  const n4 = file.segments.find((s) => s.id === 'N4');
  assert.deepEqual(n4.elements, ['Joliet', 'IL', '60431']);
  assert.equal(file.segments[0].elements[15], ':');
});

test('three 204s in one group, the second missing its pickup date', () => {
  const file = splitInterchange(sample('atlas-204-three-sets.edi'));
  assert.deepEqual(shape(file), [3]);
  assert.deepEqual(allErrors(file), []);
  const sets = file.groups[0].sets;
  assert.deepEqual(sets.map((s) => [s.control, s.st, s.end]), [['0001', 3, 18], ['0002', 19, 34], ['0003', 35, 50]]);
  const g = guidelines.find((x) => x.id === 'atlas-204');
  const raw = sample('atlas-204-three-sets.edi');
  const errs = sets.map((s) => validate(txSegments({ raw, part: { gs: 2, ge: 51, st: s.st, end: s.end } }), g));
  assert.deepEqual(errs.map((e) => e.length), [0, 1, 0]);
  assert.equal(errs[1][0].line, 24); // G62*10 in the second set, numbered as in the file
});

test('two groups, BOM and line-break terminators', () => {
  const raw = sample('northline-204-two-groups.edi');
  assert.equal(raw.charCodeAt(0), 0xfeff);
  const file = splitInterchange(raw);
  assert.equal(file.delimiters.segment, '\n');
  assert.deepEqual(shape(file), [1, 2]);
  assert.deepEqual(file.groups.map((g) => g.control), ['4960', '4961']);
  assert.deepEqual(allErrors(file), []);
  // A set's own segments plus its envelope, and nothing from the other sets.
  const g2 = file.groups[1];
  const segs = txSegments({ raw, part: { gs: g2.gs, ge: g2.ge, st: g2.sets[1].st, end: g2.sets[1].end } });
  assert.deepEqual(segs.map((s) => s.id).slice(0, 4), ['ISA', 'GS', 'ST', 'B2']);
  assert.equal(segs.find((s) => s.id === 'B2').elements[3], '30243');
  assert.equal(segs.filter((s) => s.id === 'ST').length, 1);
  assert.deepEqual(segs.slice(-2).map((s) => s.id), ['GE', 'IEA']);
});

test('partner 997 for two files', () => {
  const file = splitInterchange(sample('northline-997-two-files.edi'));
  assert.deepEqual(shape(file), [2]);
  assert.equal(file.groups[0].code, 'FA');
  assert.deepEqual(file.segments.filter((s) => s.id === 'AK1').map((s) => s.elements[1]), ['4813', '4814']);
});

test('CR terminators with LF after, leading blank lines and spaces', () => {
  const raw = `\n  ${sample('northline-204-good.edi').replace(/~\n?/g, '\r\n')}`;
  assert.equal(readDelimiters(raw).segment, '\r');
  assert.deepEqual(shape(splitInterchange(raw)), [1]);
  assert.equal(parseX12(raw).length, 20);
});

test('not X12 gives a clear error', () => {
  assert.match(splitInterchange('hello').error, /should start with an ISA/);
  assert.match(splitInterchange('ISA*00*short~').error, /cut short/);
  assert.match(splitInterchange('').error, /should start with an ISA/);
});

test('envelope problems land on the right sets', () => {
  const lines = sample('atlas-204-three-sets.edi').split('\n');
  lines[33] = 'SE*15*0002~'; // second set's count is off by one
  lines[49] = 'SE*16*0009~'; // third set's control doesn't match
  lines[50] = 'GE*2*411~'; // wrong count and control
  lines[51] = 'IEA*2*000000999~';
  const file = splitInterchange(lines.join('\n'));
  const [a, b, c] = file.groups[0].sets;
  const fileTexts = file.problems.map((p) => p.text);
  assert.equal(file.problems.length, 2);
  assert.ok(fileTexts.some((t) => t.includes('IEA-01')) && fileTexts.some((t) => t.includes('IEA-02')));
  assert.deepEqual(file.groups[0].problems.map((p) => p.ak9), ['5', '4']);
  assert.deepEqual(b.problems.map((p) => [p.ak5, p.line]), [['4', 34]]);
  assert.deepEqual(c.problems.map((p) => [p.ak5, p.line]), [['3', 50]]);
  assert.equal(a.problems.length, 0);
  assert.equal(a.errors.length, 4); // file and group problems still touch it
});

test('missing SE, GE and IEA are reported, not thrown', () => {
  const lines = sample('atlas-204-three-sets.edi').split('\n');
  lines.splice(33, 1); // drop the second SE
  const cut = lines.slice(0, 40).join('\n'); // and stop partway through the third set
  const file = splitInterchange(cut);
  assert.deepEqual(shape(file), [3]);
  const [, b, c] = file.groups[0].sets;
  assert.equal(b.end, 33);
  assert.ok(b.problems.some((p) => p.ak5 === '2'));
  assert.ok(c.problems.some((p) => p.ak5 === '2'));
  assert.ok(file.groups[0].problems.some((p) => p.ak9 === '2'));
  assert.ok(file.problems.some((p) => p.text.includes('no IEA')));
});

test('997 builder: AK1, AK2/AK5 per set, AK3/AK4 and AK9 counts', () => {
  const raw = build997({
    control: '000000123', senderId: 'GOODENOUGH', receiverId: 'ATLASCOLD', date: new Date(2026, 11, 2, 8, 30),
    groups: [
      { code: 'SM', control: '410', sets: [
        { set: '204', control: '0001', st: 3, errors: [] },
        { set: '204', control: '0002', st: 19, errors: [{ line: 23, seg: 'G62', el: 2, fault: 'missing', text: 'x' }, { line: 30, seg: 'N4', el: 3, fault: 'format', value: '4430', text: 'y' }] },
        { set: '204', control: '0003', st: 35, errors: [] },
      ] },
      { code: 'SM', control: '411', problems: [{ ak9: '4' }], sets: [{ set: '204', control: '0001', st: 3, errors: [{ ak9: '4', text: 'z' }] }] },
      { code: 'SM', control: '412', sets: [{ set: '204', control: '0001', st: 3, errors: [] }] },
    ],
  });
  const file = splitInterchange(raw);
  assert.deepEqual(allErrors(file), []);
  assert.deepEqual(shape(file), [3]);
  assert.equal(file.groups[0].code, 'FA');
  const body = (i) => { const s = file.groups[0].sets[i]; return file.segments.slice(s.st, s.end - 1).map((x) => x.text); };
  assert.deepEqual(body(0), ['AK1*SM*410', 'AK2*204*0001', 'AK5*A', 'AK2*204*0002', 'AK3*G62*5**8', 'AK4*2**1', 'AK3*N4*12**8', 'AK4*3**7*4430', 'AK5*R*5', 'AK2*204*0003', 'AK5*A', 'AK9*P*3*3*2']);
  assert.deepEqual(body(1), ['AK1*SM*411', 'AK2*204*0001', 'AK5*R*5', 'AK9*R*1*1*0*4']);
  assert.deepEqual(body(2), ['AK1*SM*412', 'AK2*204*0001', 'AK5*A', 'AK9*A*1*1*1']);
});

console.log(`\n${passed} checks passed`);
