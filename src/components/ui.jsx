// Shared building blocks used across pages.
import { Link } from 'react-router-dom';

const STATUS = {
  delivered: ['Delivered to TMS', 'ok'],
  acknowledged: ['Acknowledged', 'ok'],
  sent: ['Sent', 'info'],
  awaiting997: ['Waiting on 997', 'warn'],
  failed: ['Failed validation', 'bad'],
  rejected: ['Rejected by partner', 'bad'],
  resolved: ['Resolved', 'neutral'],
  Live: ['Live', 'ok'],
  Testing: ['Testing', 'warn'],
  Onboarding: ['Onboarding', 'warn'],
  'Not started': ['Not started', 'neutral'],
  Draft: ['Draft', 'warn'],
  Healthy: ['Healthy', 'ok'],
  'Needs attention': ['Needs attention', 'bad'],
};

export const STATUS_LABELS = Object.fromEntries(Object.entries(STATUS).map(([k, [label]]) => [k, label]));

export function Pill({ status, children }) {
  const [label, tone] = STATUS[status] || [status, 'neutral'];
  return <span className={`pill pill-${tone}`}>{children || label}</span>;
}

export function PageHeader({ crumbs, title, pill, subtitle, actions }) {
  return (
    <>
      {crumbs && (
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i}>
              {c.to ? <Link to={c.to}>{c.label}</Link> : c.label}
              {i < crumbs.length - 1 && ' / '}
            </span>
          ))}
        </div>
      )}
      <div className="page-head">
        <div className="page-title">
          <div className="title-row">
            <h1>{title}</h1>
            {pill}
          </div>
          {subtitle && <div className="muted">{subtitle}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={value === t.id ? 'tab active' : 'tab'} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Facts({ items }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dirLabel = (d) => (d === 'in' ? 'In ←' : d === 'out' ? 'Out →' : 'Both');
export const CONNECTION_TYPES = { 'sftp-hosted': 'SFTP · we host', 'sftp-remote': 'SFTP · they host', as2: 'AS2', api: 'API' };
