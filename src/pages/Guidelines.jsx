import { Link } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { PageHeader } from '../components/ui.jsx';
import { SET_NAMES } from '../lib/x12.js';

function ruleKind(r) {
  if (r.minCount) return `At least ${r.minCount}`;
  if (r.pattern) return 'Format';
  return 'Required';
}

export default function Guidelines() {
  const { state } = useStore();
  const usedBy = (gid) => state.partners.filter((p) => p.sets.some((s) => s.guideline === gid));

  return (
    <>
      <PageHeader title="Guidelines" subtitle="What each partner expects in a file. Inbound files are checked against these before they reach the TMS." />
      <div className="notice">These are sample rules written for this app. Real partner guidelines are based on the licensed X12 standard, so use each partner’s own document when you set them up.</div>
      <div className="cols">
        {state.guidelines.map((g) => (
          <section key={g.id} className="card card-pad col-half">
            <div>
              <h2>{g.name}</h2>
              <div className="muted">{g.set} {SET_NAMES[g.set]} · {g.partnerId ? 'Partner-specific' : 'Standard'}</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Segment</th><th>Check</th><th>Message shown</th></tr></thead>
                <tbody>
                  {g.rules.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.el ? `${r.seg}-${String(r.el).padStart(2, '0')}` : r.seg}</td>
                      <td><span className="chip">{ruleKind(r)}</span></td>
                      <td style={{ whiteSpace: 'normal', minWidth: 220 }}>{r.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted small">
              Used by {usedBy(g.id).map((p, i) => <span key={p.id}>{i > 0 && ', '}<Link to={`/partners/${p.id}`}>{p.name}</Link></span>)}
              {!usedBy(g.id).length && 'no partners yet'}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
