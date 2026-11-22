import { NavLink, Route, Routes } from 'react-router-dom';
import { useStore } from './store.jsx';
import Transactions from './pages/Transactions.jsx';
import TransactionDetail from './pages/TransactionDetail.jsx';
import Partners from './pages/Partners.jsx';
import PartnerDetail from './pages/PartnerDetail.jsx';
import Connections from './pages/Connections.jsx';
import Mappings from './pages/Mappings.jsx';
import MappingEditor from './pages/MappingEditor.jsx';
import Guidelines from './pages/Guidelines.jsx';
import Alerts, { useAlerts } from './pages/Alerts.jsx';
import ApiWebhooks from './pages/ApiWebhooks.jsx';
import Settings from './pages/Settings.jsx';
import TestTms from './pages/TestTms.jsx';

const NAV = [
  ['/', 'Transactions'],
  ['/partners', 'Trading partners'],
  ['/connections', 'Connections'],
  ['/mappings', 'Mappings'],
  ['/guidelines', 'Guidelines'],
  ['/alerts', 'Alerts'],
  ['/api', 'API & webhooks'],
  ['/settings', 'Settings'],
  ['/test-tms', 'Test TMS'],
];

export default function App() {
  const { state, dispatch, toast, offline } = useStore();
  const alertCount = useAlerts().length;

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">GE</span>
          <span>Good Enough EDI</span>
        </div>
        <div className="env-toggle" role="group" aria-label="Environment">
          {['production', 'test'].map((env) => (
            <button key={env} type="button" className={state.env === env ? 'active' : ''} aria-pressed={state.env === env} onClick={() => dispatch({ type: 'setEnv', env })}>
              {env === 'production' ? 'Production' : 'Test'}
            </button>
          ))}
        </div>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            {label}
            {to === '/alerts' && alertCount > 0 && <span className="badge">{alertCount}</span>}
          </NavLink>
        ))}
      </nav>

      <main className="main">
        {offline && <div className="offline-banner" role="alert">Lost contact with the server. Changes won’t save until it’s back; this page reconnects on its own.</div>}
        {state.env === 'test' && <div className="test-banner">You’re viewing the Test environment. Nothing here reaches partners’ production systems.</div>}
        <Routes>
          <Route path="/" element={<Transactions />} />
          <Route path="/transactions/:id" element={<TransactionDetail />} />
          <Route path="/partners" element={<Partners />} />
          <Route path="/partners/:id" element={<PartnerDetail />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/mappings" element={<Mappings />} />
          <Route path="/mappings/:id" element={<MappingEditor />} />
          <Route path="/guidelines" element={<Guidelines />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/api" element={<ApiWebhooks />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/test-tms" element={<TestTms />} />
          <Route path="*" element={<p>That page doesn’t exist.</p>} />
        </Routes>
      </main>

      {toast && (
        <div key={toast.key} className={`toast toast-${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
