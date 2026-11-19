import { Link } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { Empty, PageHeader, fmtTime } from '../components/ui.jsx';
import { SET_NAMES } from '../lib/x12.js';

const WAIT_LIMIT_MIN = 30;

// Alerts are worked out from current data, so they clear on their own once fixed.
export function useAlerts() {
  const { state } = useStore();
  const name = (id) => state.partners.find((p) => p.id === id)?.name;
  const alerts = [];
  state.transactions.forEach((t) => {
    const env = t.env === 'test' ? ' (test)' : '';
    if (t.status === 'failed') alerts.push({ tone: 'bad', at: t.time, title: `${t.set} from ${name(t.partnerId)} failed validation${env}`, detail: t.errors[0]?.text, to: `/transactions/${t.id}` });
    if (t.status === 'rejected') alerts.push({ tone: 'bad', at: t.time, title: `${name(t.partnerId)} rejected your ${t.set}${env}`, detail: `${SET_NAMES[t.set]} · ${t.ref}`, to: `/transactions/${t.id}` });
    if (t.status === 'awaiting997' && Date.now() - new Date(t.time).getTime() > WAIT_LIMIT_MIN * 60000) {
      alerts.push({ tone: 'warn', at: t.time, title: `No 997 from ${name(t.partnerId)} after ${WAIT_LIMIT_MIN} minutes${env}`, detail: `${t.set} ${t.ref}`, to: `/transactions/${t.id}` });
    }
  });
  state.partners.filter((p) => !p.connection.healthy).forEach((p) => {
    alerts.push({ tone: 'warn', at: null, title: `${p.name}’s connection isn’t working yet`, detail: p.connection.auth, to: `/partners/${p.id}` });
  });
  return alerts.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export default function Alerts() {
  const alerts = useAlerts();
  return (
    <>
      <PageHeader title="Alerts" subtitle={`Things that need someone to look at them. Failed files, rejections, late 997s (over ${WAIT_LIMIT_MIN} minutes) and broken connections.`} />
      <section className="card">
        {alerts.map((a, i) => (
          <div key={i} className="alert-row">
            <span className={`alert-dot ${a.tone}`} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={a.to} style={{ fontWeight: 500 }}>{a.title}</Link>
              {a.detail && <div className="muted">{a.detail}</div>}
            </div>
            {a.at && <span className="mono muted small">{fmtTime(a.at)}</span>}
          </div>
        ))}
        {!alerts.length && <Empty>Nothing needs attention right now.</Empty>}
      </section>
    </>
  );
}
