// Editor for an outbound mapping: the segments of the file a partner gets, each element a
// fixed value or a TMS field, with a live preview of the file built from sample TMS data.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { PageHeader, Pill } from '../components/ui.jsx';
import { OUT_TRANSFORMS, SEGMENT_NAMES, SET_NAMES, buildX12, elementLabel, fieldPaths, parseX12, runOutboundMapping, stampFields, validate } from '../lib/x12.js';
import { OUR_IDS } from '../data/sample.js';

const BODY_START = 4; // the preview's first body line comes after ISA, GS and ST
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blankElement = () => ({ id: newId('e'), kind: 'fixed', value: '', path: '', fn: 'copy', required: false });
const nn = (n) => String(n).padStart(2, '0');

// Moves item i of a list by delta places (no-op at either end).
function move(list, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function MoveButtons({ label, index, count, onMove, onRemove }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${label}`} onClick={onRemove}>✕</button>
    </span>
  );
}

function ElementRow({ seg, el, index, count, result, bad, pathsId, onChange, onMove, onRemove }) {
  const label = elementLabel(seg || 'XX', index + 1);
  const isField = el.kind === 'field';
  return (
    <tr className={bad ? 'row-bad' : undefined}>
      <td className="mono">{seg || '?'}-{nn(index + 1)}<div className="muted small">{/^[A-Z0-9]+-\d+$/.test(label) ? '' : label}</div></td>
      <td>
        <select className="cell" aria-label={`Source for ${seg}-${nn(index + 1)}`} value={el.kind} onChange={(e) => onChange({ kind: e.target.value })}>
          <option value="fixed">Fixed value</option>
          <option value="field">TMS field</option>
        </select>
      </td>
      <td>
        {isField ? (
          <input className="cell mono" aria-label="TMS field path" placeholder="pickup.city" list={pathsId} value={el.path} onChange={(e) => onChange({ path: e.target.value.trim() })} style={{ width: 130 }} />
        ) : (
          <input className="cell mono" aria-label="Fixed value" placeholder="(empty)" value={el.value} onChange={(e) => onChange({ value: e.target.value })} style={{ width: 130 }} />
        )}
      </td>
      <td>
        {isField && (
          <select className="cell" aria-label="Transform" value={el.fn} onChange={(e) => onChange({ fn: e.target.value })}>
            {Object.entries(OUT_TRANSFORMS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        )}
      </td>
      <td>
        {isField && (
          <input type="checkbox" aria-label={`${seg}-${nn(index + 1)} is required`} checked={!!el.required} onChange={(e) => onChange({ required: e.target.checked })} style={{ minHeight: 0, width: 16, height: 16 }} />
        )}
      </td>
      <td>
        {result.ok ? <span className="result-ok">{result.value === '' ? <span className="muted">(empty)</span> : result.value}</span> : <span className="result-bad">{result.note}</span>}
      </td>
      <td><MoveButtons label={`${seg}-${nn(index + 1)}`} index={index} count={count} onMove={onMove} onRemove={onRemove} /></td>
    </tr>
  );
}

export default function OutboundMappingEditor({ mapping }) {
  const { state, dispatch, notify } = useStore();
  const navigate = useNavigate();
  const [sampleText, setSampleText] = useState(() => JSON.stringify(mapping.sample || {}, null, 2));
  const [sampleError, setSampleError] = useState('');
  const [newSeg, setNewSeg] = useState('');
  const date = useMemo(() => new Date(), []);

  const partner = state.partners.find((p) => p.id === mapping.partnerId);
  const link = partner?.sets.find((s) => s.set === mapping.set && s.dir === 'out');
  const linked = link?.mapping === mapping.id;
  const guideline = state.guidelines.find((g) => g.id === link?.guideline);

  // The preview: the whole file as the partner would get it in Test.
  const fields = stampFields(mapping.set, mapping.sample || {}, date);
  const run = runOutboundMapping(mapping, fields);
  const raw = buildX12({ set: mapping.set, control: '000000001', senderId: OUR_IDS.testId, receiverId: partner?.testIsaId || 'PARTNER', date, usage: 'T', fields, body: run.lines });
  const lines = parseX12(raw);
  const checks = validate(lines, guideline);
  const badLines = new Set([
    ...checks.map((c) => c.line),
    ...run.problems.map((p) => run.segments[p.segment]?.line).filter((l) => l != null).map((l) => l + BODY_START),
  ]);
  const badEls = new Set(run.problems.map((p) => `${p.segment}-${p.el}`));
  const badSegs = new Set(run.problems.map((p) => p.segment));
  const paths = [...new Set([...fieldPaths(mapping.sample || {}), ...Object.keys(fields)])];
  const pathsId = `paths-${mapping.id}`;

  const update = (fn, edit = true) => dispatch({ type: 'updateMapping', id: mapping.id, edit, fn });
  const editSegments = (fn) => update((m) => ({ ...m, segments: fn(m.segments) }));
  const setSegment = (i, patch) => editSegments((segs) => segs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const editElements = (i, fn) => editSegments((segs) => segs.map((s, j) => (j === i ? { ...s, elements: fn(s.elements) } : s)));

  const addSegment = () => {
    editSegments((segs) => [...segs, { id: newId('s'), seg: newSeg.trim().toUpperCase(), optional: false, elements: [blankElement()] }]);
    setNewSeg('');
  };

  const changeSample = (text) => {
    setSampleText(text);
    try {
      const sample = JSON.parse(text);
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) throw new Error('not an object');
      setSampleError('');
      update((m) => ({ ...m, sample }), false);
    } catch {
      setSampleError('This isn’t valid JSON yet. It needs to be one object, like { "shipmentId": "30117" }. The preview uses the last version that was.');
    }
  };

  const useForPartner = () => {
    dispatch({ type: 'updatePartner', id: partner.id, fn: (p) => ({ ...p, sets: p.sets.map((s) => (s.set === mapping.set && s.dir === 'out' ? { ...s, mapping: mapping.id } : s)) }) });
    notify(`${partner.name}’s ${mapping.set}s will be built with this mapping.`);
  };

  const remove = () => {
    if (!window.confirm(`Delete “${mapping.name}”?${linked ? ` ${partner.name}’s ${mapping.set}s will go back to the built-in layout.` : ''}`)) return;
    dispatch({ type: 'removeMapping', id: mapping.id });
    navigate('/mappings');
    notify('Mapping deleted.');
  };

  const ready = !run.problems.length && !checks.length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Mappings', to: '/mappings' }, { label: mapping.name }]}
        title={mapping.name}
        pill={<Pill status={mapping.status}>{mapping.status} v{mapping.version}</Pill>}
        subtitle={
          <>
            Outbound {mapping.set} {SET_NAMES[mapping.set]} for <Link to={`/partners/${partner?.id}`}>{partner?.name}</Link> ·{' '}
            {linked ? `Used for every ${mapping.set} sent to ${partner?.name}` : link ? `Not in use: ${partner?.name}’s ${mapping.set}s use ${link.mapping ? 'another mapping' : 'the built-in layout'}` : `${partner?.name} isn’t set up to receive ${mapping.set}s`}
          </>
        }
        actions={
          <>
            {link && !linked && <button type="button" className="btn" onClick={useForPartner}>Use for {partner.name}’s {mapping.set}s</button>}
            <button type="button" className="btn btn-danger" onClick={remove}>Delete</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={mapping.status === 'Live'}
              onClick={() => {
                update((m) => ({ ...m, status: 'Live' }), false);
                notify(`v${mapping.version} is live.`);
              }}
            >
              {mapping.status === 'Live' ? 'Live' : `Publish v${mapping.version}`}
            </button>
          </>
        }
      />

      <section className="card card-pad">
        <label className="field" style={{ maxWidth: 420 }}>
          Mapping name
          <input value={mapping.name} onChange={(e) => update((m) => ({ ...m, name: e.target.value }), false)} />
        </label>
      </section>

      <div className="cols">
        <section className="card" style={{ flex: '3 1 640px' }}>
          <div className="card-head">
            <div>
              <h2>Segments</h2>
              <div className="muted small">In the order they go in the file. ISA, GS, ST and the trailers are added for you.</div>
            </div>
            <div className="actions">
              <label htmlFor="new-seg" className="sr-only">New segment ID</label>
              <input id="new-seg" className="mono" placeholder="L11" value={newSeg} onChange={(e) => setNewSeg(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && addSegment()} style={{ width: 80 }} />
              <button type="button" className="btn" onClick={addSegment}>Add segment</button>
            </div>
          </div>
          <datalist id={pathsId}>{paths.map((p) => <option key={p} value={p} />)}</datalist>
          {mapping.segments.map((s, i) => {
            const res = run.segments[i];
            return (
              <div key={s.id} className={badSegs.has(i) ? 'out-seg err' : 'out-seg'}>
                <div className="out-seg-head">
                  <span className="muted small">{i + 1}.</span>
                  <input className="cell mono" aria-label={`Segment ${i + 1} ID`} placeholder="ID" value={s.seg} onChange={(e) => setSegment(i, { seg: e.target.value.toUpperCase() })} style={{ width: 64 }} />
                  <span className="muted">{SEGMENT_NAMES[res.seg] || 'Segment'}</span>
                  <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={!!s.optional} onChange={(e) => setSegment(i, { optional: e.target.checked })} style={{ minHeight: 0 }} />
                    Leave out when its TMS fields are empty
                  </label>
                  {!res.included && <Pill status="resolved">Left out for this sample</Pill>}
                  <span style={{ marginLeft: 'auto' }}>
                    <MoveButtons label={`segment ${i + 1} (${s.seg})`} index={i} count={mapping.segments.length} onMove={(d) => editSegments((segs) => move(segs, i, d))} onRemove={() => editSegments((segs) => segs.filter((_, j) => j !== i))} />
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Element</th><th>Source</th><th>Value or field</th><th>Transform</th><th>Required</th><th>Sample result</th><th><span className="sr-only">Move or remove</span></th></tr></thead>
                    <tbody>
                      {s.elements.map((el, j) => (
                        <ElementRow
                          key={el.id}
                          seg={res.seg}
                          el={el}
                          index={j}
                          count={s.elements.length}
                          result={res.results[j]}
                          bad={res.included && badEls.has(`${i}-${j + 1}`)}
                          pathsId={pathsId}
                          onChange={(patch) => editElements(i, (els) => els.map((x, k) => (k === j ? { ...x, ...patch } : x)))}
                          onMove={(d) => editElements(i, (els) => move(els, j, d))}
                          onRemove={() => editElements(i, (els) => els.filter((_, k) => k !== j))}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => editElements(i, (els) => [...els, blankElement()])} style={{ alignSelf: 'flex-start' }}>
                  Add {s.seg || 'segment'}-{nn(s.elements.length + 1)}
                </button>
              </div>
            );
          })}
          {!mapping.segments.length && <div className="empty">No segments yet. Type an ID like B1 above and press Add segment.</div>}
        </section>

        <aside className="col-side" style={{ flex: '1 1 360px' }}>
          <section className="card card-pad">
            <h2>Sample TMS data</h2>
            <div className="muted small">Paste what your TMS sends in <span className="mono">fields</span>. <span className="mono">date</span>{mapping.set === '214' && <> and <span className="mono">time</span></>} are filled in with the moment the file is built.</div>
            <label htmlFor="sample-json" className="sr-only">Sample TMS JSON</label>
            <textarea id="sample-json" value={sampleText} onChange={(e) => changeSample(e.target.value)} spellCheck={false} />
            {sampleError && <div className="form-error">{sampleError}</div>}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Preview</h2>
              {ready ? <Pill status="Live">Ready to send</Pill> : <Pill status="failed">{run.problems.length + checks.length} problem{run.problems.length + checks.length === 1 ? '' : 's'}</Pill>}
            </div>
            <div className="x12" style={{ borderTop: '1px solid var(--line-soft)' }}>
              {lines.map((l) => (
                <div key={l.line} className={badLines.has(l.line) ? 'x12-line err' : 'x12-line'}>
                  <span className="ln">{l.line}</span>{l.text}~
                </div>
              ))}
            </div>
            <div className="card-pad" style={{ borderTop: '1px solid var(--line-soft)' }}>
              {run.problems.length > 0 && (
                <div>
                  <strong className="small">Can’t build the file from this data</strong>
                  <ul className="form-error" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {run.problems.map((p, k) => <li key={k}>{p.text}</li>)}
                  </ul>
                  <div className="muted small">The API answers a request like this with a 400 error and sends nothing.</div>
                </div>
              )}
              <div>
                <strong className="small">Guideline check{guideline ? `: ${guideline.name}` : ''}</strong>
                {!guideline ? (
                  <div className="muted small">{partner?.name}’s {mapping.set} has no guideline, so nothing is checked.</div>
                ) : checks.length ? (
                  <ul className="form-error" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {checks.map((c, k) => <li key={k}>{c.line ? <span className="mono">Line {c.line} · </span> : null}{c.text}</li>)}
                  </ul>
                ) : (
                  <div className="small" style={{ color: 'var(--ok-text)' }}>Passes every rule.</div>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
