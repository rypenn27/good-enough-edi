import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { CONNECTION_TYPES, Empty, Modal, PageHeader, Pill } from '../components/ui.jsx';

export default function Partners() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = state.partners.filter((p) => `${p.name} ${p.isaId}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        title="Trading partners"
        subtitle="The shippers, customers and carriers you exchange EDI with."
        actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add partner</button>}
      />
      <section className="card">
        <div className="filters">
          <label htmlFor="p-q" className="sr-only">Search partners</label>
          <input id="p-q" placeholder="Search by name or ISA ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Partner</th><th>Role</th><th>ISA ID</th><th>Connection</th><th>Transaction sets</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/partners/${p.id}`)}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td>{p.role}</td>
                  <td className="mono">{p.isaId}</td>
                  <td>{CONNECTION_TYPES[p.connection.type]}</td>
                  <td className="mono">{p.sets.map((s) => s.set).join(', ') || '—'}</td>
                  <td><Pill status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty>No partners match “{q}”.</Empty>}
        </div>
      </section>
      {adding && <AddPartner onClose={() => setAdding(false)} />}
    </>
  );
}

function AddPartner({ onClose }) {
  const { state, dispatch, notify } = useStore();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', role: 'Shipper', isaId: '', type: 'sftp-hosted' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: k === 'isaId' ? e.target.value.toUpperCase() : e.target.value });

  const save = () => {
    if (!form.name.trim() || !form.isaId.trim()) return setError('Enter a name and an ISA ID.');
    if (state.partners.some((p) => p.isaId === form.isaId)) return setError(`Another partner already uses the ISA ID ${form.isaId}.`);
    const id = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
    const partner = {
      id, name: form.name.trim(), role: form.role, status: 'Onboarding', isaId: form.isaId, testIsaId: `${form.isaId}T`.slice(0, 15), version: '004010',
      connection: { type: form.type, host: form.type === 'sftp-hosted' ? 'sftp.goodenoughedi.example' : '', username: form.isaId.toLowerCase(), auth: 'Not set up', allowedIps: [], inbound: '/inbound', outbound: '/outbound', healthy: false },
      sets: [], contacts: [],
      checklist: ['Partner guideline received', 'IDs and connection details exchanged', 'Test login confirmed', 'Test files passed', 'Go-live date agreed'].map((label) => ({ label, done: false })),
    };
    dispatch({ type: 'addPartner', partner });
    notify(`${partner.name} added.`);
    navigate(`/partners/${id}`);
  };

  return (
    <Modal
      title="Add a trading partner"
      onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={save}>Add partner</button></>}
    >
      <div className="form-grid">
        <label className="field">Company name<input value={form.name} onChange={set('name')} placeholder="Acme Logistics" /></label>
        <label className="field">Role
          <select value={form.role} onChange={set('role')}>{['Shipper', 'Customer', 'Carrier'].map((r) => <option key={r}>{r}</option>)}</select>
        </label>
        <label className="field">ISA ID<input className="mono" value={form.isaId} onChange={set('isaId')} maxLength={15} placeholder="ACMELOG" /></label>
        <label className="field">Connection
          <select value={form.type} onChange={set('type')}>{Object.entries(CONNECTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
