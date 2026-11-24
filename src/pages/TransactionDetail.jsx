import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { Facts, PageHeader, Pill, Tabs, fmtDateTime, fmtTime } from '../components/ui.jsx';
import { SEGMENT_NAMES, SET_NAMES, buildX12, elementLabel, envelope, mappingDirection, readX12, runMapping, txSegments } from '../lib/x12.js';

// Saves text as a file in the browser's downloads.
function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

const showTerm = (c) => ({ '\n': 'a line break', '\r': 'a line break (CR)' }[c] || c);

// Marks lines left out of the view because they belong to other transaction sets in the file.
function Gap({ from, to }) {
  if (!from || to <= from + 1) return null;
  const n = to - from - 1;
  return <div className="x12-gap">{n} line{n > 1 ? 's' : ''} ({from + 1}–{to - 1}) from other transaction sets in this file</div>;
}

export default function TransactionDetail() {
  const { id } = useParams();
  const { state, actions, notify } = useStore();
  const [tab, setTab] = useState('raw');
  const tx = state.transactions.find((t) => t.id === id);
  const partner = state.partners.find((p) => p.id === tx?.partnerId);
  const segments = useMemo(() => (tx ? txSegments(tx) : []), [tx]);
  const delimiters = useMemo(() => readX12(tx?.raw || '').delimiters, [tx]);

  if (!tx) return <p>That transaction doesn’t exist. <Link to="/">Back to transactions</Link></p>;

  const env = envelope(segments);
  const src = tx.source?.count > 1 ? tx.source : null;
  // Shown after each segment in the raw view; a line-break terminator is already a new line.
  const term = /\s/.test(delimiters.segment) ? '' : delimiters.segment;
  const errorLines = new Set(tx.errors.map((e) => e.line));
  const mapping = tx.dir === 'in' ? state.mappings.find((m) => m.partnerId === tx.partnerId && m.set === tx.set && mappingDirection(m) === 'in') : null;
  const ctx = { partnerName: (isaId) => state.partners.find((p) => p.isaId === isaId || p.testIsaId === isaId)?.name };
  const json = mapping ? runMapping(segments, mapping.rules, ctx).output : tx.fields || { note: 'No mapping for this partner and transaction set yet.' };

  const download = () => saveFile(`${tx.set}_${tx.control}.edi`, tx.raw);

  // For testing: the 997 this partner would send back for this file. Upload it to the
  // partner's inbound folder (over SFTP or by copying) to see the file get acknowledged.
  const canFake997 = tx.dir === 'out' && tx.set !== '997' && tx.status === 'awaiting997';
  const partner997 = (accepted) => {
    const control = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const raw = buildX12({
      set: '997', control, date: new Date(), usage: env.usage || 'P',
      senderId: env.receiverId, receiverId: env.senderId,
      fields: { ackSet: tx.set, ackControl: env.group || tx.control, accepted },
    });
    saveFile(`${partner?.id}-997-for-${tx.set}_${tx.control}.edi`, raw);
    notify(`Saved. Upload it to ${partner?.id}/inbound to play the partner answering.`);
  };

  // Runs a server action and reports the outcome.
  const act = async (fn, message) => {
    try {
      const r = await fn(tx.id);
      notify(typeof message === 'function' ? message(r) : message);
    } catch (err) {
      notify(err.message, 'bad');
    }
  };
  const reprocess = () => act(actions.reprocess, (r) => (r.errors ? `Still failing: ${r.errors} problem${r.errors > 1 ? 's' : ''}. Fix the file or the guideline.` : 'Reprocessed. Sending it to the TMS now.'));

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
            {canFake997 && (
              <>
                <button type="button" className="btn" onClick={() => partner997(true)} title="For testing: the 997 the partner would send back">Partner’s 997: accept</button>
                <button type="button" className="btn" onClick={() => partner997(false)} title="For testing: a 997 rejecting this file">Partner’s 997: reject</button>
              </>
            )}
            {(tx.status === 'failed' || tx.status === 'rejected') && (
              <button type="button" className="btn" onClick={() => act(actions.resolve, 'Marked resolved.')}>Mark resolved</button>
            )}
            {tx.dir === 'in' ? (
              <button type="button" className="btn btn-primary" onClick={reprocess}>Reprocess</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => act(actions.resend, `Sent again to ${partner?.id}/outbound. Waiting on the partner’s 997.`)}>Send again</button>
            )}
          </>
        }
      />

      {tx.errors.length > 0 && (
        <section className="card card-pad problems">
          <h2>{tx.errors.length} problem{tx.errors.length > 1 ? 's' : ''} found {tx.envelopeErrors?.length ? 'in the envelope or' : ''} against the {partner?.name} {tx.set} guideline</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tx.errors.map((e, i) => (
              <li key={i}>{e.line ? <span className="mono">Line {e.line} · </span> : null}{e.text}</li>
            ))}
          </ul>
          {tx.set !== '997' && <div className="muted small">{src ? 'The 997 sent for this file rejects this transaction set.' : 'A 997 rejecting this file was sent to the partner automatically.'}</div>}
        </section>
      )}

      <div className="cols">
        <section className="card col-main">
          <Tabs label="View" value={tab} onChange={setTab} tabs={[{ id: 'raw', label: 'Raw X12' }, { id: 'readable', label: 'Readable' }, { id: 'json', label: tx.dir === 'in' ? 'JSON sent to TMS' : 'TMS data used' }]} />
          {tab === 'raw' && (
            <div className="x12">
              {segments.map((s, i) => (
                <Fragment key={s.line}>
                  <Gap from={segments[i - 1]?.line} to={s.line} />
                  <div className={errorLines.has(s.line) ? 'x12-line err' : 'x12-line'}>
                    <span className="ln">{s.line}</span>{s.text}{term}
                  </div>
                </Fragment>
              ))}
            </div>
          )}
          {tab === 'readable' && (
            <div className="readable">
              {segments.map((s, n) => (
                <Fragment key={s.line}>
                  <Gap from={segments[n - 1]?.line} to={s.line} />
                  <div className={errorLines.has(s.line) ? 'readable-seg err' : 'readable-seg'}>
                    <header><b>{s.id}</b><span className="muted">{SEGMENT_NAMES[s.id] || 'Segment'}</span><span className="muted small mono">line {s.line}</span></header>
                    <div className="readable-els">
                      {s.elements.map((v, i) => (v ? <div key={i}><span>{elementLabel(s.id, i + 1)}:</span> {v}</div> : null))}
                    </div>
                  </div>
                </Fragment>
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
            <Facts items={[['Sender ID', env.senderId], ['Receiver ID', env.receiverId], ['Interchange #', env.control], ['Group #', env.group], ['Set #', env.setControl], ['Version', env.version], ['Usage', env.usage === 'T' ? 'T · test' : 'P · production'], ['Separators', `${delimiters.element} elements, ${delimiters.component} components, ${showTerm(delimiters.segment)} after segments`]]} />
            {src && <p className="muted small" style={{ marginBottom: 0 }}>Set {src.index} of {src.count} in {src.file || 'the uploaded file'}. Only this set’s lines and its envelope are shown; line numbers are the file’s.</p>}
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
