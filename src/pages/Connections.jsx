import { Link } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { CONNECTION_TYPES, Facts, PageHeader, Pill } from '../components/ui.jsx';
import { OUR_IDS } from '../data/sample.js';

export default function Connections() {
  const { state } = useStore();
  const lastActivity = (pid) => state.transactions.filter((t) => t.partnerId === pid).sort((a, b) => b.time.localeCompare(a.time))[0];

  return (
    <>
      <PageHeader title="Connections" subtitle="How files move between you and each partner." />

      <div className="notice">The servers below aren’t connected yet. This is the front end only; SFTP will run on SFTPGo and AS2 on OpenAS2 once the backend is built.</div>

      <div className="cols">
        <section className="card card-pad col-half">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><h2>Your SFTP server</h2><Pill status="Not started">Not connected</Pill></div>
          <Facts items={[['Host', 'sftp.goodenoughedi.example'], ['Port', '22'], ['Sign-in', 'SSH keys only'], ['Partner folders', '/inbound  /outbound  /archive'], ['Accounts', String(state.partners.filter((p) => p.connection.type === 'sftp-hosted').length)]]} />
        </section>
        <section className="card card-pad col-half">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><h2>Your AS2 station</h2><Pill status="Not started">Not connected</Pill></div>
          <Facts items={[['Receive URL', 'https://as2.goodenoughedi.example/as2'], ['AS2 ID', OUR_IDS.as2Id], ['Signing', 'SHA-256'], ['Encryption', 'AES-256'], ['Receipts (MDN)', 'Synchronous, signed']]} />
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Partner connections</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Partner</th><th>Type</th><th>Endpoint</th><th>Sign-in</th><th>Last activity</th><th>Health</th></tr></thead>
            <tbody>
              {state.partners.map((p) => {
                const last = lastActivity(p.id);
                return (
                  <tr key={p.id}>
                    <td><Link to={`/partners/${p.id}`}>{p.name}</Link></td>
                    <td>{CONNECTION_TYPES[p.connection.type]}</td>
                    <td className="mono">{p.connection.type === 'sftp-hosted' ? `${p.connection.username}@${p.connection.host}` : p.connection.host || '—'}</td>
                    <td>{p.connection.auth}</td>
                    <td className="muted">{last ? new Date(last.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td><Pill status={p.connection.healthy ? 'Healthy' : 'Needs attention'} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
