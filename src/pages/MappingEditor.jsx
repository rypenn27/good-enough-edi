import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { PageHeader, Pill } from '../components/ui.jsx';
import { SEGMENT_NAMES, TRANSFORMS, describeSource, elementLabel, mappingDirection, parseX12, runMapping } from '../lib/x12.js';
import OutboundMappingEditor from './OutboundMappingEditor.jsx';

// Opens the right editor for the mapping's direction. Keyed by id so moving between
// mappings starts each editor fresh.
export default function MappingEditor() {
  const { id } = useParams();
  const { state } = useStore();
  const mapping = state.mappings.find((m) => m.id === id);
  if (!mapping) return <p>That mapping doesn’t exist. <Link to="/mappings">Back to mappings</Link></p>;
  return mappingDirection(mapping) === 'out' ? <OutboundMappingEditor key={id} mapping={mapping} /> : <InboundMappingEditor key={id} mapping={mapping} />;
}

function InboundMappingEditor({ mapping }) {
  const { state, dispatch, notify } = useStore();
  const samples = state.transactions.filter((t) => t.partnerId === mapping.partnerId && t.set === mapping.set && t.dir === 'in');
  const [sampleId, setSampleId] = useState(mapping.sampleTxId || samples[0]?.id);
  const sample = state.transactions.find((t) => t.id === sampleId) || samples[0];
  const segments = useMemo(() => (sample ? parseX12(sample.raw) : []), [sample]);

  const partner = state.partners.find((p) => p.id === mapping.partnerId);
  const ctx = { partnerName: (isaId) => state.partners.find((p) => p.isaId === isaId || p.testIsaId === isaId)?.name };
  const run = runMapping(segments, mapping.rules, ctx);
  const edit = (fn) => dispatch({ type: 'updateMapping', id: mapping.id, edit: true, fn: (m) => ({ ...m, rules: fn(m.rules) }) });
  const setRule = (i, patch) => edit((rules) => rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Segment ids in the sample, in order, each listed once with its elements.
  const tree = [];
  segments.forEach((s) => {
    if (['ISA', 'GS', 'GE', 'IEA', 'SE'].includes(s.id) && s.id !== 'ISA') return;
    if (tree.some((t) => t.id === s.id)) return;
    tree.push({ id: s.id, els: s.elements.map((v, i) => i + 1).filter((n) => s.elements[n - 1]) });
  });

  const addRule = (seg = 'B2', el = 1) =>
    edit((rules) => [...rules, { id: `r-${Date.now()}`, seg, el, occurrence: 1, whereEl: '', whereEq: '', fn: 'copy', target: '' }]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Mappings', to: '/mappings' }, { label: mapping.name }]}
        title={mapping.name}
        pill={<Pill status={mapping.status}>{mapping.status} v{mapping.version}</Pill>}
        subtitle={<>Used by <Link to={`/partners/${partner?.id}`}>{partner?.name}</Link> for inbound {mapping.set}s</>}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={mapping.status === 'Live'}
            onClick={() => {
              dispatch({ type: 'updateMapping', id: mapping.id, fn: (m) => ({ ...m, status: 'Live' }) });
              notify(`v${mapping.version} is live. New ${mapping.set}s from ${partner?.name} will use it.`);
            }}
          >
            {mapping.status === 'Live' ? 'Live' : `Publish v${mapping.version}`}
          </button>
        }
      />

      <div className="cols">
        <section className="card card-pad" style={{ flex: '1 1 230px', maxHeight: 640, overflowY: 'auto' }}>
          <h2>EDI fields</h2>
          <div className="muted small">From the sample file. Click a field to add a rule for it.</div>
          {tree.map((t) => (
            <div key={t.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="tree-item group">{t.id} · {SEGMENT_NAMES[t.id] || 'Segment'}</span>
              {t.els.map((n) => (
                <button key={n} type="button" className="tree-item" style={{ paddingLeft: 24 }} onClick={() => addRule(t.id, n)}>
                  {t.id}-{String(n).padStart(2, '0')} · {elementLabel(t.id, n).replace(/^[A-Z0-9]+-\d+$/, '')}
                </button>
              ))}
            </div>
          ))}
        </section>

        <section className="card" style={{ flex: '3 1 620px' }}>
          <div className="card-head">
            <h2>Rules</h2>
            <button type="button" className="btn" onClick={() => addRule()}>Add rule</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Segment</th><th>Element</th><th>Only where</th><th>#</th><th>Transform</th><th>TMS field</th><th>Sample result</th><th><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {mapping.rules.map((r, i) => {
                  const res = run.results[i];
                  return (
                    <tr key={r.id}>
                      <td><input className="cell mono" aria-label="Segment" value={r.seg} onChange={(e) => setRule(i, { seg: e.target.value.toUpperCase() })} style={{ width: 58 }} /></td>
                      <td><input className="cell mono" aria-label="Element" type="number" min="1" value={r.el} onChange={(e) => setRule(i, { el: Number(e.target.value) })} style={{ width: 54 }} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input className="cell mono" aria-label="Condition element" placeholder="el" value={r.whereEl} onChange={(e) => setRule(i, { whereEl: e.target.value })} style={{ width: 40 }} />
                        {' = '}
                        <input className="cell mono" aria-label="Condition value" placeholder="value" value={r.whereEq} onChange={(e) => setRule(i, { whereEq: e.target.value.toUpperCase() })} style={{ width: 60 }} />
                      </td>
                      <td><input className="cell mono" aria-label="Occurrence" type="number" min="1" value={r.occurrence} onChange={(e) => setRule(i, { occurrence: Number(e.target.value) })} style={{ width: 46 }} /></td>
                      <td>
                        <select className="cell" aria-label="Transform" value={r.fn} onChange={(e) => setRule(i, { fn: e.target.value })}>
                          {Object.entries(TRANSFORMS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                        </select>
                      </td>
                      <td><input className="cell mono" aria-label="TMS field" placeholder="pickup.city" value={r.target} onChange={(e) => setRule(i, { target: e.target.value })} style={{ width: 140 }} /></td>
                      <td title={describeSource(r)}>
                        {res.ok ? <span className="result-ok">{String(res.value)}</span> : <span className="result-bad">{res.note}</span>}
                      </td>
                      <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove rule ${i + 1}`} onClick={() => edit((rules) => rules.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card card-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2>Test result</h2>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            Sample file
            <select value={sample?.id || ''} onChange={(e) => setSampleId(e.target.value)}>
              {samples.map((t) => <option key={t.id} value={t.id}>{t.control} · {t.ref}</option>)}
            </select>
          </label>
        </div>
        {run.failed > 0 ? (
          <div className="form-error">{run.failed} rule{run.failed > 1 ? 's' : ''} couldn’t fill a value from this file. Those fields would be empty in the TMS.</div>
        ) : (
          <div className="muted" style={{ color: 'var(--ok-text)' }}>Every rule filled a value from this file.</div>
        )}
        <pre className="json" style={{ background: 'var(--bg)', borderRadius: 8 }}>{JSON.stringify(run.output, null, 2)}</pre>
      </section>
    </>
  );
}
