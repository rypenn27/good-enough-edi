import { useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { PageHeader, Pill } from '../components/ui.jsx';
import { SET_NAMES } from '../lib/x12.js';

export default function Mappings() {
  const { state } = useStore();
  const navigate = useNavigate();
  const partnerName = (id) => state.partners.find((p) => p.id === id)?.name;
  const outbound = state.partners.flatMap((p) => p.sets.filter((s) => s.dir === 'out').map((s) => ({ ...s, partner: p })));

  return (
    <>
      <PageHeader title="Mappings" subtitle="Rules that turn partners’ EDI files into loads and updates in your TMS." />
      <section className="card">
        <div className="card-head"><h2>Inbound: EDI → TMS</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Mapping</th><th>Partner</th><th>Set</th><th>Rules</th><th>Version</th><th>Status</th></tr></thead>
            <tbody>
              {state.mappings.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => navigate(`/mappings/${m.id}`)}>
                  <td style={{ fontWeight: 500 }}>{m.name}</td>
                  <td>{partnerName(m.partnerId)}</td>
                  <td><span className="mono">{m.set}</span> <span className="muted">{SET_NAMES[m.set]}</span></td>
                  <td>{m.rules.length}</td>
                  <td>v{m.version}</td>
                  <td><Pill status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Outbound: TMS → EDI</h2><span className="muted">Built-in templates, one per transaction set</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Partner</th><th>Set</th><th>Built from</th><th>Stage</th></tr></thead>
            <tbody>
              {outbound.map((s) => (
                <tr key={`${s.partner.id}-${s.set}`}>
                  <td>{s.partner.name}</td>
                  <td><span className="mono">{s.set}</span> <span className="muted">{SET_NAMES[s.set]}</span></td>
                  <td>{{ '204': 'Load tender to carrier', '990': 'Accept or decline on the load', '214': 'Stop check-calls and status updates', '210': 'Customer invoice' }[s.set]}</td>
                  <td><Pill status={s.stage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
