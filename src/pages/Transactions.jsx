import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { Modal, PageHeader, Pill, STATUS_LABELS, dirLabel, fmtTime, Empty } from '../components/ui.jsx';
import { SET_NAMES } from '../lib/x12.js';

const RANGES = { all: 'All time', '1h': 'Last hour', '24h': 'Last 24 hours', '7d': 'Last 7 days' };
const RANGE_MS = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3 };

export default function Transactions() {
  const { state, uploadFile, notify } = useStore();
  const navigate = useNavigate();
  const [f, setF] = useState({ q: '', partner: '', set: '', dir: '', status: '', range: 'all' });
  const [uploading, setUploading] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const inEnv = useMemo(() => {
    const cutoff = RANGE_MS[f.range] ? Date.now() - RANGE_MS[f.range] : 0;
    return state.transactions.filter((t) => t.env === state.env && new Date(t.time).getTime() >= cutoff);
  }, [state.transactions, state.env, f.range]);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return inEnv
      .filter((t) => (!f.partner || t.partnerId === f.partner) && (!f.set || t.set === f.set) && (!f.dir || t.dir === f.dir) && (!f.status || t.status === f.status))
      .filter((t) => !q || `${t.control} ${t.ref} ${t.raw}`.toLowerCase().includes(q))
      .sort((a, b) => b.time.localeCompare(a.time));
  }, [inEnv, f]);

  const count = (fn) => inEnv.filter(fn).length;
  const partnerName = (id) => state.partners.find((p) => p.id === id)?.name || id;

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Every EDI file sent and received, newest first."
        actions={<button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>Upload a file</button>}
      />

      <div className="kpis">
        <div className="card kpi"><span>Received</span><strong>{count((t) => t.dir === 'in')}</strong></div>
        <div className="card kpi"><span>Sent</span><strong>{count((t) => t.dir === 'out')}</strong></div>
        <div className="card kpi warn"><span>Waiting on 997</span><strong>{count((t) => t.status === 'awaiting997')}</strong></div>
        <div className="card kpi bad"><span>Failed or rejected</span><strong>{count((t) => t.status === 'failed' || t.status === 'rejected')}</strong></div>
      </div>

      <section className="card">
        <div className="filters">
          <label htmlFor="tx-q" className="sr-only">Search</label>
          <input id="tx-q" placeholder="Search control #, load #, PO or file contents" value={f.q} onChange={set('q')} />
          <label htmlFor="tx-partner" className="sr-only">Partner</label>
          <select id="tx-partner" value={f.partner} onChange={set('partner')}>
            <option value="">All partners</option>
            {state.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label htmlFor="tx-set" className="sr-only">Transaction set</label>
          <select id="tx-set" value={f.set} onChange={set('set')}>
            <option value="">All types</option>
            {Object.entries(SET_NAMES).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}
          </select>
          <label htmlFor="tx-dir" className="sr-only">Direction</label>
          <select id="tx-dir" value={f.dir} onChange={set('dir')}>
            <option value="">In and out</option>
            <option value="in">Inbound</option>
            <option value="out">Outbound</option>
          </select>
          <label htmlFor="tx-status" className="sr-only">Status</label>
          <select id="tx-status" value={f.status} onChange={set('status')}>
            <option value="">All statuses</option>
            {['delivered', 'acknowledged', 'awaiting997', 'failed', 'rejected', 'resolved'].map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <label htmlFor="tx-range" className="sr-only">Time range</label>
          <select id="tx-range" value={f.range} onChange={set('range')}>
            {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Time</th><th>Direction</th><th>Partner</th><th>Type</th><th>Control #</th><th>Reference</th><th>Status</th><th>997</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => navigate(`/transactions/${t.id}`)}>
                  <td className="mono muted">{fmtTime(t.time)}</td>
                  <td>{dirLabel(t.dir)}</td>
                  <td>{partnerName(t.partnerId)}</td>
                  <td><span className="mono">{t.set}</span> <span className="muted">{SET_NAMES[t.set]}</span></td>
                  <td><Link to={`/transactions/${t.id}`} className="mono" onClick={(e) => e.stopPropagation()}>{t.control}</Link></td>
                  <td>{t.ref}</td>
                  <td><Pill status={t.status} /></td>
                  <td className="muted">{t.ack}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty>No transactions match these filters.</Empty>}
        </div>
        <div className="table-foot">{rows.length} of {inEnv.length} shown</div>
      </section>

      {uploading && (
        <UploadModal
          onClose={() => setUploading(false)}
          onSubmit={(raw) => {
            const res = uploadFile(raw);
            if (res.error) return res.error;
            setUploading(false);
            notify(res.tx.errors.length ? `File received, but it failed validation (${res.tx.errors.length} problems).` : 'File received and delivered to the TMS.', res.tx.errors.length ? 'bad' : 'ok');
            navigate(`/transactions/${res.tx.id}`);
            return null;
          }}
        />
      )}
    </>
  );
}

function UploadModal({ onClose, onSubmit }) {
  const { state } = useStore();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const readFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => setRaw(String(reader.result));
    reader.readAsText(file);
  };

  // Fills the box with a copy of a sample 204 so there's something to try.
  const useSample = () => {
    const sample = state.transactions.find((t) => t.dir === 'in' && t.set === '204');
    if (sample) setRaw(sample.raw);
  };

  return (
    <Modal
      title="Upload an EDI file"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!raw.trim()} onClick={() => setError(onSubmit(raw))}>Process file</button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>Choose an X12 file or paste its contents. It’s matched to a partner by the sender ID in the ISA segment, then checked against that partner’s guideline.</p>
      <div className="actions">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Choose file</button>
        <button type="button" className="btn btn-ghost" onClick={useSample}>Paste a sample 204</button>
        <input ref={fileRef} type="file" accept=".edi,.x12,.txt" hidden onChange={(e) => e.target.files[0] && readFile(e.target.files[0])} />
      </div>
      <label htmlFor="upload-raw" className="sr-only">File contents</label>
      <textarea id="upload-raw" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="ISA*00*          *00*          *ZZ*..." />
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
