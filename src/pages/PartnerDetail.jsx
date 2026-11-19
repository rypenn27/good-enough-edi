import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { CONNECTION_TYPES, Empty, Facts, PageHeader, Pill, Tabs, dirLabel, fmtTime } from '../components/ui.jsx';
import { SET_NAMES } from '../lib/x12.js';

const STAGES = ['Not started', 'Testing', 'Live'];

export default function PartnerDetail() {
  const { id } = useParams();
  const { state, dispatch, notify } = useStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [newSet, setNewSet] = useState({ set: '214', dir: 'out' });
  const partner = state.partners.find((p) => p.id === id);
  if (!partner) return <p>That partner doesn’t exist. <Link to="/partners">Back to partners</Link></p>;

  const update = (fn) => dispatch({ type: 'updatePartner', id: partner.id, fn });
  const c = partner.connection;
  const txs = state.transactions.filter((t) => t.partnerId === partner.id).sort((a, b) => b.time.localeCompare(a.time));
  const done = partner.checklist.filter((i) => i.done).length;
  const guidelineName = (gid) => state.guidelines.find((g) => g.id === gid)?.name || '—';
  const week = txs.filter((t) => Date.now() - new Date(t.time).getTime() < 7 * 86400e3);

  const connectionFacts = c.type === 'as2'
    ? [['Their AS2 URL', c.host], ['Their AS2 ID', c.username], ['Certificate', c.auth], ['Allowed IPs', c.allowedIps.join(', ')], ['Receipts (MDN)', 'Synchronous, signed']]
    : [['Host', c.host], ['Username', c.username], ['Sign-in', c.auth], ['Allowed IPs', c.allowedIps.join(', ') || 'Any (not restricted)'], ['Folders', `${c.inbound}  ${c.outbound}`]];

  const sendTest = () => {
    dispatch({ type: 'sendTest', partnerId: partner.id });
    notify('Test file sent. Switch to Test to see it in Transactions.');
  };

  const addSet = () => {
    if (partner.sets.some((s) => s.set === newSet.set && s.dir === newSet.dir)) return notify('That transaction set is already set up.', 'bad');
    const std = state.guidelines.find((g) => g.set === newSet.set && !g.partnerId);
    update((p) => ({ ...p, sets: [...p.sets, { ...newSet, guideline: std?.id || null, mapping: null, stage: 'Not started', ack: true }] }));
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Trading partners', to: '/partners' }, { label: partner.name }]}
        title={partner.name}
        pill={<Pill status={partner.status} />}
        subtitle={`${partner.role} · ${CONNECTION_TYPES[c.type]}`}
        actions={
          <>
            <button type="button" className="btn" onClick={sendTest}>Send a test file</button>
            {partner.status !== 'Live' && (
              <button type="button" className="btn btn-primary" onClick={() => { update((p) => ({ ...p, status: 'Live' })); notify(`${partner.name} is live.`); }}>Mark live</button>
            )}
          </>
        }
      />

      <Tabs label="Partner sections" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'transactions', label: `Transactions (${txs.length})` },
        { id: 'checklist', label: `Onboarding (${done}/${partner.checklist.length})` },
        { id: 'contacts', label: 'Contacts' },
      ]} />

      {tab === 'overview' && (
        <>
          <div className="cols">
            <section className="card card-pad col-half">
              <h2>EDI identifiers</h2>
              <Facts items={[['ISA qualifier / ID', `ZZ · ${partner.isaId}`], ['GS ID', partner.isaId], ['Test ISA ID', `ZZ · ${partner.testIsaId}`], ['X12 version', partner.version], ['Separators', '*  ~  >']]} />
            </section>
            <section className="card card-pad col-half">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <h2>Connection</h2>
                <Pill status={c.healthy ? 'Healthy' : 'Needs attention'} />
              </div>
              <Facts items={connectionFacts} />
              <div className="muted small">{c.healthy ? `Last activity ${txs[0] ? fmtTime(txs[0].time) : '—'}` : 'No successful connection yet.'} · <Link to="/connections">All connections</Link></div>
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Transaction sets</h2>
              <div className="actions">
                <label htmlFor="ns-set" className="sr-only">Set</label>
                <select id="ns-set" value={newSet.set} onChange={(e) => setNewSet({ ...newSet, set: e.target.value })}>
                  {Object.entries(SET_NAMES).filter(([k]) => k !== '997').map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}
                </select>
                <label htmlFor="ns-dir" className="sr-only">Direction</label>
                <select id="ns-dir" value={newSet.dir} onChange={(e) => setNewSet({ ...newSet, dir: e.target.value })}>
                  <option value="in">Inbound</option>
                  <option value="out">Outbound</option>
                </select>
                <button type="button" className="btn" onClick={addSet}>Add</button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Set</th><th>Direction</th><th>Guideline</th><th>Mapping</th><th>997 expected</th><th>Stage</th><th>Last 7 days</th></tr></thead>
                <tbody>
                  {partner.sets.map((s, i) => {
                    const mapping = state.mappings.find((m) => m.id === s.mapping);
                    return (
                      <tr key={`${s.set}-${s.dir}`}>
                        <td><span className="mono">{s.set}</span> <span className="muted">{SET_NAMES[s.set]}</span></td>
                        <td>{dirLabel(s.dir)}</td>
                        <td><Link to="/guidelines">{guidelineName(s.guideline)}</Link></td>
                        <td>{mapping ? <Link to={`/mappings/${mapping.id}`}>{mapping.name}</Link> : <span className="muted">{s.dir === 'out' ? 'Built-in template' : 'None yet'}</span>}</td>
                        <td>{s.ack ? 'Yes' : 'No'}</td>
                        <td>
                          <label htmlFor={`stage-${i}`} className="sr-only">Stage for {s.set}</label>
                          <select id={`stage-${i}`} className="cell" value={s.stage} onChange={(e) => update((p) => ({ ...p, sets: p.sets.map((x, j) => (j === i ? { ...x, stage: e.target.value } : x)) }))}>
                            {STAGES.map((st) => <option key={st}>{st}</option>)}
                          </select>
                        </td>
                        <td className="muted">{week.filter((t) => t.set === s.set && t.dir === s.dir).length} files</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!partner.sets.length && <Empty>No transaction sets yet. Add the first one above.</Empty>}
            </div>
          </section>
        </>
      )}

      {tab === 'transactions' && (
        <section className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Env</th><th>Direction</th><th>Type</th><th>Control #</th><th>Reference</th><th>Status</th></tr></thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => navigate(`/transactions/${t.id}`)}>
                    <td className="mono muted">{fmtTime(t.time)}</td>
                    <td>{t.env === 'test' ? 'Test' : 'Prod'}</td>
                    <td>{dirLabel(t.dir)}</td>
                    <td className="mono">{t.set}</td>
                    <td className="mono">{t.control}</td>
                    <td>{t.ref}</td>
                    <td><Pill status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!txs.length && <Empty>No files exchanged with {partner.name} yet.</Empty>}
          </div>
        </section>
      )}

      {tab === 'checklist' && (
        <section className="card card-pad" style={{ maxWidth: 720 }}>
          <h2>Onboarding checklist</h2>
          <div className="progress" aria-label={`${done} of ${partner.checklist.length} done`}><div style={{ width: `${(done / partner.checklist.length) * 100}%` }} /></div>
          <ul className="checklist">
            {partner.checklist.map((item, i) => (
              <li key={item.label}>
                <label>
                  <input type="checkbox" checked={item.done} onChange={() => update((p) => ({ ...p, checklist: p.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }))} />
                  {item.label}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'contacts' && (
        <section className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th></tr></thead>
              <tbody>
                {partner.contacts.map((ct) => (
                  <tr key={ct.email}><td style={{ fontWeight: 500 }}>{ct.name}</td><td>{ct.title}</td><td className="mono">{ct.email}</td><td>{ct.phone}</td></tr>
                ))}
              </tbody>
            </table>
            {!partner.contacts.length && <Empty>No contacts yet.</Empty>}
          </div>
        </section>
      )}
    </>
  );
}
