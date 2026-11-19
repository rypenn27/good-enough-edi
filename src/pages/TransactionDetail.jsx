import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { Facts, PageHeader, Pill, Tabs, fmtDateTime, fmtTime } from '../components/ui.jsx';
import { SEGMENT_NAMES, SET_NAMES, elementLabel, envelope, parseX12, runMapping } from '../lib/x12.js';

export default function TransactionDetail() {
  const { id } = useParams();
  const { state, dispatch, notify } = useStore();
  const [tab, setTab] = useState('raw');
  const tx = state.transactions.find((t) => t.id === id);
  const partner = state.partners.find((p) => p.id === tx?.partnerId);
  const segments = useMemo(() => (tx ? parseX12(tx.raw) : []), [tx]);

  if (!tx) return <p>That transaction doesn’t exist. <Link to="/">Back to transactions</Link></p>;

  const env = envelope(segments);
  const errorLines = new Set(tx.errors.map((e) => e.line));
  const mapping = tx.dir === 'in' ? state.mappings.find((m) => m.partnerId === tx.partnerId && m.set === tx.set) : null;
  const ctx = { partnerName: (isaId) => state.partners.find((p) => p.isaId === isaId || p.testIsaId === isaId)?.name };
  const json = mapping ? runMapping(segments, mapping.rules, ctx).output : tx.fields || { note: 'No mapping for this partner and transaction set yet.' };

  const download = () => {
    const url = URL.createObjectURL(new Blob([tx.raw], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${tx.set}_${tx.control}.edi` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const reprocess = () => {
    dispatch({ type: 'reprocess', id: tx.id });
    notify(tx.errors.length ? 'Reprocessed. Fix the file or the guideline if it fails again.' : 'Reprocessed and delivered to the TMS.');
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Transactions', to: '/' }, { label: tx.control }]}
        title={`${tx.set} ${SET_NAMES[tx.set]} · ${tx.ref}`}
        pill={<Pill status={tx.status} />}
        subtitle={
          <>
            {tx.dir === 'in' ? 'Inbound from ' : 'Outbound to '}
            <Link to={`/partners/${partner?.id}`}>{partner?.name}</Link> · via {tx.via} · {fmtDateTime(tx.time)} · {tx.env === 'test' ? 'Test' : 'Production'}
          </>
        }
        actions={
          <>
            <button type="button" className="btn" onClick={download}>Download file</button>
            {(tx.status === 'failed' || tx.status === 'rejected') && (
              <button type="button" className="btn" onClick={() => { dispatch({ type: 'resolve', id: tx.id }); notify('Marked resolved.'); }}>Mark resolved</button>
            )}
            {tx.dir === 'in' ? (
              <button type="button" className="btn btn-primary" onClick={reprocess}>Reprocess</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => { dispatch({ type: 'resend', id: tx.id }); notify('Sent again. Waiting on the partner’s 997.'); }}>Send again</button>
            )}
          </>
        }
      />

      {tx.errors.length > 0 && (
        <section className="card card-pad problems">
          <h2>{tx.errors.length} problem{tx.errors.length > 1 ? 's' : ''} found against the {partner?.name} {tx.set} guideline</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tx.errors.map((e, i) => (
              <li key={i}>{e.line ? <span className="mono">Line {e.line} · </span> : null}{e.text}</li>
            ))}
          </ul>
          <div className="muted small">A 997 rejecting this file was sent to the partner automatically.</div>
        </section>
      )}

      <div className="cols">
        <section className="card col-main">
          <Tabs label="View" value={tab} onChange={setTab} tabs={[{ id: 'raw', label: 'Raw X12' }, { id: 'readable', label: 'Readable' }, { id: 'json', label: tx.dir === 'in' ? 'JSON sent to TMS' : 'TMS data used' }]} />
          {tab === 'raw' && (
            <div className="x12">
              {segments.map((s) => (
                <div key={s.line} className={errorLines.has(s.line) ? 'x12-line err' : 'x12-line'}>
                  <span className="ln">{s.line}</span>{s.text}~
                </div>
              ))}
            </div>
          )}
          {tab === 'readable' && (
            <div className="readable">
              {segments.map((s) => (
                <div key={s.line} className={errorLines.has(s.line) ? 'readable-seg err' : 'readable-seg'}>
                  <header><b>{s.id}</b><span className="muted">{SEGMENT_NAMES[s.id] || 'Segment'}</span></header>
                  <div className="readable-els">
                    {s.elements.map((v, i) => (v ? <div key={i}><span>{elementLabel(s.id, i + 1)}:</span> {v}</div> : null))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'json' && (
            <>
              {mapping && <div className="notice" style={{ margin: 12 }}>Built by the mapping <Link to={`/mappings/${mapping.id}`}>{mapping.name}</Link> (v{mapping.version}, {mapping.status.toLowerCase()}).</div>}
              <pre className="json">{JSON.stringify(json, null, 2)}</pre>
            </>
          )}
        </section>

        <aside className="col-side">
          <section className="card card-pad">
            <h2>Envelope</h2>
            <Facts items={[['Sender ID', env.senderId], ['Receiver ID', env.receiverId], ['Interchange #', env.control], ['Group #', env.group], ['Version', env.version], ['Usage', env.usage === 'T' ? 'T · test' : 'P · production']]} />
          </section>
          <section className="card card-pad">
            <h2>Timeline</h2>
            <ol className="timeline">
              {tx.events.map((e, i) => (
                <li key={i}><time dateTime={e.at}>{fmtTime(e.at)}</time><span>{e.text}</span></li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
