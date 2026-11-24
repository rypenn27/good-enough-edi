import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { Modal, PageHeader, Pill } from '../components/ui.jsx';
import { SET_NAMES, mappingDirection } from '../lib/x12.js';
import { SAMPLE_TMS_FIELDS, STARTER_LAYOUTS, withSegmentIds } from '../data/sample.js';

const BUILT_FROM = { '204': 'Load tender to carrier', '990': 'Accept or decline on the load', '214': 'Stop check-calls and status updates', '210': 'Customer invoice' };

// Asks which partner and set a new outbound mapping is for, then opens it in the editor.
function NewOutboundMapping({ onClose }) {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const choices = state.partners.flatMap((p) => p.sets.filter((s) => s.dir === 'out' && STARTER_LAYOUTS[s.set]).map((s) => ({ key: `${p.id}|${s.set}`, partner: p, set: s })));
  const [key, setKey] = useState(choices[0]?.key || '');
  const [start, setStart] = useState('starter');
  const [link, setLink] = useState(true);
  const choice = choices.find((c) => c.key === key);

  const create = () => {
    const { partner, set } = choice;
    const id = `${partner.id}-${set.set}-out-${Date.now().toString(36)}`;
    const segments = start === 'starter' ? withSegmentIds(STARTER_LAYOUTS[set.set], id) : [];
    dispatch({
      type: 'addMapping',
      mapping: { id, name: `${SET_NAMES[set.set]} → ${partner.name} ${set.set}`, direction: 'out', partnerId: partner.id, set: set.set, version: 1, status: 'Draft', sample: SAMPLE_TMS_FIELDS[set.set], segments },
    });
    if (link) dispatch({ type: 'updatePartner', id: partner.id, fn: (p) => ({ ...p, sets: p.sets.map((s) => (s.set === set.set && s.dir === 'out' ? { ...s, mapping: id } : s)) }) });
    navigate(`/mappings/${id}`);
  };

  return (
    <Modal
      title="New outbound mapping"
      onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={!choice} onClick={create}>Create and edit</button></>}
    >
      {choices.length ? (
        <>
          <label className="field">
            Partner and transaction set
            <select value={key} onChange={(e) => setKey(e.target.value)}>
              {choices.map((c) => <option key={c.key} value={c.key}>{c.partner.name} · {c.set.set} {SET_NAMES[c.set.set]}</option>)}
            </select>
          </label>
          <label className="field">
            Start from
            <select value={start} onChange={(e) => setStart(e.target.value)}>
              <option value="starter">The built-in layout (change what’s different)</option>
              <option value="blank">Nothing (add every segment yourself)</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} style={{ minHeight: 0 }} />
            Use it for {choice?.partner.name}’s {choice?.set.set}s straight away
          </label>
        </>
      ) : (
        <p className="muted">No partner has an outbound 990, 214, 210 or 204 yet. Add one on the partner’s page first.</p>
      )}
    </Modal>
  );
}

export default function Mappings() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const partnerName = (id) => state.partners.find((p) => p.id === id)?.name;
  const outbound = state.partners.flatMap((p) => p.sets.filter((s) => s.dir === 'out').map((s) => ({ ...s, partner: p })));
  const mappingName = (id) => state.mappings.find((m) => m.id === id)?.name;

  return (
    <>
      <PageHeader
        title="Mappings"
        subtitle="Rules that turn partners’ EDI files into loads and updates in your TMS, and turn TMS data into the files each partner expects."
        actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>New outbound mapping</button>}
      />
      <section className="card">
        <div className="card-head"><h2>All mappings</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Mapping</th><th>Direction</th><th>Partner</th><th>Set</th><th>Rules</th><th>Version</th><th>Status</th></tr></thead>
            <tbody>
              {state.mappings.map((m) => {
                const out = mappingDirection(m) === 'out';
                return (
                  <tr key={m.id} className="clickable" onClick={() => navigate(`/mappings/${m.id}`)}>
                    <td style={{ fontWeight: 500 }}>{m.name}</td>
                    <td>{out ? 'Outbound: TMS → EDI' : 'Inbound: EDI → TMS'}</td>
                    <td>{partnerName(m.partnerId)}</td>
                    <td><span className="mono">{m.set}</span> <span className="muted">{SET_NAMES[m.set]}</span></td>
                    <td>{out ? `${m.segments.length} segment${m.segments.length === 1 ? '' : 's'}` : m.rules.length}</td>
                    <td>v{m.version}</td>
                    <td><Pill status={m.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Outbound files by partner</h2><span className="muted">Without a mapping, a file uses the built-in layout for its set</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Partner</th><th>Set</th><th>Built from</th><th>Layout</th><th>Stage</th></tr></thead>
            <tbody>
              {outbound.map((s) => (
                <tr key={`${s.partner.id}-${s.set}`} className={s.mapping ? 'clickable' : undefined} onClick={s.mapping ? () => navigate(`/mappings/${s.mapping}`) : undefined}>
                  <td>{s.partner.name}</td>
                  <td><span className="mono">{s.set}</span> <span className="muted">{SET_NAMES[s.set]}</span></td>
                  <td>{BUILT_FROM[s.set]}</td>
                  <td>{s.mapping && mappingName(s.mapping) ? mappingName(s.mapping) : <span className="muted">Built-in layout</span>}</td>
                  <td><Pill status={s.stage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {adding && <NewOutboundMapping onClose={() => setAdding(false)} />}
    </>
  );
}
