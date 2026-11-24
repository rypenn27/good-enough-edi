// A stand-in TMS for testing the whole loop: it shows the webhooks Good Enough EDI sends
// (new loads, failures, 997s) and answers loads through the real outbound API, the same
// way a real TMS would: accept or decline (990), send a status (214), send an invoice (210).
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { Empty, PageHeader, Pill, fmtTime } from '../components/ui.jsx';

const POLL_MS = 2000;
const STATUSES = { AF: 'Picked up', X1: 'Arrived at delivery', D1: 'Delivered' };
const EVENT_LABELS = {
  'transaction.received': 'New file',
  'transaction.failed': 'File failed',
  'transaction.sent': 'File sent',
  'ack.received': '997 received',
};

async function call(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

function summary(r) {
  const d = r.data || {};
  if (r.event === 'transaction.received' && d.set === '204') return `Load ${d.data?.externalRef ?? '?'} from ${d.partner?.name}`;
  if (r.event === 'transaction.received') return `${d.set} ${d.control} from ${d.partner?.name}`;
  if (r.event === 'transaction.failed') return `${d.set} from ${d.partner?.name}: ${d.errors?.[0] ?? ''}`;
  if (r.event === 'transaction.sent') return `${d.set} ${d.control} to ${d.partner?.name}: ${d.ref}`;
  if (r.event === 'ack.received') return d.transactionId ? `${d.set} ${d.control} ${d.status === 'acknowledged' ? 'accepted' : 'rejected'} by ${d.partner?.name}` : `997 from ${d.partner?.name} didn’t match a file`;
  return '';
}

export default function TestTms() {
  const { state, notify } = useStore();
  const [tms, setTms] = useState(null);
  const [open, setOpen] = useState(null);
  const [status214, setStatus214] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => call('/api/mock-tms').then(setTms).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const partner = (id) => state.partners.find((p) => p.id === id);
  const sends = (p, set) => p?.sets.some((s) => s.set === set && s.dir === 'out');
  const webhookOn = state.settings.webhooks.some((h) => h.active && h.url.includes('/api/mock-tms/webhook'));

  // Loads are the 204s this TMS received, newest first, one row per partner + shipment.
  const seen = new Set();
  const loads = (tms?.received || [])
    .filter((r) => r.event === 'transaction.received' && r.data?.set === '204' && r.data?.data?.externalRef)
    .filter((r) => r.data.env === state.env)
    .filter((r) => {
      const key = `${r.data.partner.id}|${r.data.data.externalRef}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // What has already gone back to the partner for a load, from Good Enough EDI's transactions.
  const sent = (partnerId, shipmentId, set) =>
    state.transactions.find((t) => t.dir === 'out' && t.partnerId === partnerId && t.set === set && String(t.fields?.shipmentId) === String(shipmentId));

  const send = async (partnerId, set, fields) => {
    setBusy(true);
    try {
      const r = await call('/api/outbound', { method: 'POST', headers: { 'X-API-Key': state.settings.apiKey }, body: { partnerId, set, env: state.env, fields } });
      notify(`${set} ${r.control} placed in ${r.file}. Waiting on the partner’s 997.`);
    } catch (err) {
      notify(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const toggleDown = async () => setTms(await call('/api/mock-tms/down', { method: 'PUT', body: { down: !tms.down } }));
  const clear = async () => setTms(await call('/api/mock-tms/clear', { method: 'POST' }));

  return (
    <>
      <PageHeader
        title="Test TMS"
        subtitle="A pretend TMS for trying the whole loop. It receives Good Enough EDI’s webhooks and answers loads through the outbound API, like a real TMS would."
        actions={tms && (
          <>
            <button type="button" className={tms.down ? 'btn btn-danger' : 'btn'} aria-pressed={tms.down} onClick={toggleDown}>{tms.down ? 'TMS is down: bring it back' : 'Pretend the TMS is down'}</button>
            <button type="button" className="btn" onClick={clear}>Clear history</button>
          </>
        )}
      />

      {!webhookOn && (
        <div className="notice" style={{ marginBottom: 16 }}>
          No active webhook points here, so nothing will arrive. On <Link to="/api">API &amp; webhooks</Link>, add <span className="mono">http://localhost:3002/api/mock-tms/webhook</span>.
        </div>
      )}
      {tms?.down && <div className="notice" style={{ marginBottom: 16 }}>The Test TMS is answering every webhook with an error. New files will retry three times, then show as “TMS delivery failed” with an alert.</div>}

      <section className="card">
        <div className="card-head"><h2>Loads received</h2><span className="muted small">{state.env === 'test' ? 'Test' : 'Production'} only</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Received</th><th>Partner</th><th>Load</th><th>Lane</th><th>Rate</th><th>Tender (990)</th><th>Status (214)</th><th>Invoice (210)</th></tr>
            </thead>
            <tbody>
              {loads.map((r) => {
                const d = r.data.data;
                const p = partner(r.data.partner.id);
                const t990 = sent(p?.id, d.externalRef, '990');
                const t214 = sent(p?.id, d.externalRef, '214');
                const t210 = sent(p?.id, d.externalRef, '210');
                const accepted = t990?.fields?.action === 'A';
                const code = status214[r.id] || 'AF';
                const where = code === 'AF' ? d.pickup : d.delivery;
                return (
                  <tr key={r.id}>
                    <td className="mono muted">{fmtTime(r.at)}</td>
                    <td>{r.data.partner.name}</td>
                    <td>
                      <span className="mono">{d.externalRef}</span>
                      {d.action === 'cancel' && <> <Pill status="rejected">Cancel</Pill></>}
                      <div className="muted small">PO {d.poNumber ?? '—'}</div>
                    </td>
                    <td>{d.pickup?.city}, {d.pickup?.state} → {d.delivery?.city}, {d.delivery?.state}<div className="muted small">{d.pickup?.date ?? '?'} → {d.delivery?.date ?? '?'}</div></td>
                    <td className="mono">{d.rate != null ? `$${d.rate.toLocaleString()}` : '—'}</td>
                    <td>
                      {t990 ? (
                        <Link to={`/transactions/${t990.id}`}>{accepted ? 'Accepted' : 'Declined'}</Link>
                      ) : sends(p, '990') ? (
                        <div className="actions">
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => send(p.id, '990', { shipmentId: d.externalRef, action: 'A', po: d.poNumber })}>Accept</button>
                          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => send(p.id, '990', { shipmentId: d.externalRef, action: 'D', po: d.poNumber })}>Decline</button>
                        </div>
                      ) : <span className="muted small">Partner doesn’t take 990s</span>}
                      {t990 && <div className="small"><Pill status={t990.status} /></div>}
                    </td>
                    <td>
                      {sends(p, '214') ? (
                        accepted ? (
                          <div className="actions" style={{ alignItems: 'center' }}>
                            <label htmlFor={`st-${r.id}`} className="sr-only">Status</label>
                            <select id={`st-${r.id}`} value={code} onChange={(e) => setStatus214({ ...status214, [r.id]: e.target.value })}>
                              {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => send(p.id, '214', { shipmentId: d.externalRef, status: code, city: where?.city, state: where?.state, po: d.poNumber })}>Send</button>
                          </div>
                        ) : <span className="muted small">Accept first</span>
                      ) : <span className="muted small">Partner doesn’t take 214s</span>}
                      {t214 && <div className="small"><Link to={`/transactions/${t214.id}`}>Last: {STATUSES[t214.fields.status] || t214.fields.status}</Link> <Pill status={t214.status} /></div>}
                    </td>
                    <td>
                      {t210 ? (
                        <><Link to={`/transactions/${t210.id}`}>Invoice {t210.fields.invoice}</Link><div className="small"><Pill status={t210.status} /></div></>
                      ) : sends(p, '210') ? (
                        accepted ? <button type="button" className="btn btn-sm" disabled={busy} onClick={() => send(p.id, '210', { invoice: `INV-${d.externalRef}`, shipmentId: d.externalRef, amount: d.rate ?? 0, po: d.poNumber })}>Send invoice</button> : <span className="muted small">Accept first</span>
                      ) : <span className="muted small">Partner doesn’t take 210s</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loads.length && <Empty>No loads yet. Drop a 204 into a partner’s inbound folder (or upload one over SFTP) and it shows up here.</Empty>}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Webhooks received</h2><span className="muted small">{tms?.received.length ?? 0} kept</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Event</th><th>What</th><th /></tr></thead>
            <tbody>
              {(tms?.received || []).slice(0, 50).map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td className="mono muted">{fmtTime(r.at)}</td>
                    <td><span className="mono small">{r.event}</span><div className="muted small">{EVENT_LABELS[r.event]}</div></td>
                    <td>{summary(r)}</td>
                    <td><button type="button" className="btn btn-sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide JSON' : 'JSON'}</button></td>
                  </tr>
                  {open === r.id && (
                    <tr><td colSpan={4}><pre className="json" style={{ margin: 0 }}>{JSON.stringify(r, null, 2)}</pre></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!tms?.received.length && <Empty>Nothing received yet.</Empty>}
        </div>
      </section>
    </>
  );
}
