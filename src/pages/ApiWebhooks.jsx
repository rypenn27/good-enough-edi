import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Empty, PageHeader } from '../components/ui.jsx';

const EVENTS = {
  'transaction.received': 'A file arrives from a partner',
  'transaction.failed': 'A file fails validation',
  'transaction.sent': 'A file is sent to a partner',
  'ack.received': 'A partner’s 997 arrives',
};

// A random webhook signing secret, e.g. whsec_3f9a… (32 random bytes as hex).
const makeSecret = () => 'whsec_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

export default function ApiWebhooks() {
  const { state, dispatch, notify } = useStore();
  const { apiKey, webhooks } = state.settings;
  const [show, setShow] = useState(false);
  const [shownSecret, setShownSecret] = useState(null); // id of the webhook whose secret is visible
  const [url, setUrl] = useState('');
  const save = (patch) => dispatch({ type: 'updateSettings', patch });
  const setHooks = (fn) => save({ webhooks: fn(webhooks) });

  // Copies a key or secret; if the browser won't, shows it so it can be selected instead.
  const copy = async (text, what, reveal) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied.`);
    } catch {
      reveal();
      notify(`Couldn’t copy. The ${what.toLowerCase()} is shown so you can select it.`, 'bad');
    }
  };

  const setSecret = (id, secret) => {
    setHooks((hs) => hs.map((x) => (x.id === id ? { ...x, secret } : x)));
    setShownSecret(secret ? id : null);
    notify(secret ? 'New signing secret made. Put it in your TMS; the old one stops working.' : 'This webhook is no longer signed.');
  };

  const newKey = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const key = 'ge_live_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => chars[b % chars.length]).join('');
    save({ apiKey: key });
    setShow(true);
    notify('New API key made. The old one stops working.');
  };

  const addHook = () => {
    if (!/^https?:\/\/\S+$/.test(url)) return notify('Enter a full URL starting with http:// or https://', 'bad');
    const id = `wh-${Date.now()}`;
    setHooks((hs) => [...hs, { id, url, events: ['transaction.received'], active: true, secret: makeSecret() }]);
    setShownSecret(id);
    setUrl('');
  };

  return (
    <>
      <PageHeader title="API & webhooks" subtitle="How your TMS talks to Good Enough EDI." />

      <section className="card card-pad" style={{ maxWidth: 760 }}>
        <h2>API key</h2>
        <div className="muted">Your TMS sends this key when it asks Good Enough EDI to send a 990, 214 or 210.</div>
        <div className="actions" style={{ alignItems: 'center' }}>
          <code className="mono" style={{ padding: '9px 12px', background: 'var(--bg)', borderRadius: 6, overflowWrap: 'anywhere' }}>
            {show ? apiKey : `${apiKey.slice(0, 8)}${'•'.repeat(16)}`}
          </code>
          <button type="button" className="btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          <button type="button" className="btn" onClick={() => copy(apiKey, 'API key', () => setShow(true))}>Copy</button>
          <button type="button" className="btn btn-danger" onClick={newKey}>Make a new key</button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Webhooks</h2>
          <div className="actions">
            <label htmlFor="wh-url" className="sr-only">Webhook URL</label>
            <input id="wh-url" placeholder="https://your-tms.example/api/edi" value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: 300 }} />
            <button type="button" className="btn" onClick={addHook}>Add webhook</button>
          </div>
        </div>
        <div className="muted" style={{ padding: '0 16px 12px' }}>
          Good Enough EDI calls these addresses when something happens, so your TMS doesn’t have to keep checking.
          A webhook with a signing secret sends <code className="mono">X-Good-Enough-Signature: sha256=…</code>, an HMAC-SHA256 of the request body made with the secret, so your TMS can tell the call really came from here.
        </div>
        {webhooks.map((h) => (
          <div key={h.id} className="alert-row" style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="mono" style={{ overflowWrap: 'anywhere' }}>{h.url}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                {Object.entries(EVENTS).map(([ev, label]) => (
                  <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" style={{ minHeight: 0 }} checked={h.events.includes(ev)} onChange={() => setHooks((hs) => hs.map((x) => (x.id === h.id ? { ...x, events: x.events.includes(ev) ? x.events.filter((e) => e !== ev) : [...x.events, ev] } : x)))} />
                    {label}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span className="muted">Signing secret:</span>
                {h.secret ? (
                  <>
                    <code className="mono" style={{ overflowWrap: 'anywhere' }}>{shownSecret === h.id ? h.secret : `${h.secret.slice(0, 6)}${'•'.repeat(16)}`}</code>
                    <button type="button" className="btn btn-sm" onClick={() => setShownSecret(shownSecret === h.id ? null : h.id)}>{shownSecret === h.id ? 'Hide' : 'Show'}</button>
                    <button type="button" className="btn btn-sm" onClick={() => copy(h.secret, 'Secret', () => setShownSecret(h.id))}>Copy</button>
                    <button type="button" className="btn btn-sm" onClick={() => setSecret(h.id, makeSecret())}>Make a new secret</button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setSecret(h.id, undefined)}>Stop signing</button>
                  </>
                ) : (
                  <>
                    <span>none, so calls aren’t signed</span>
                    <button type="button" className="btn btn-sm" onClick={() => setSecret(h.id, makeSecret())}>Make a secret</button>
                  </>
                )}
              </div>
            </div>
            <div className="actions">
              <button type="button" className="btn btn-sm" onClick={() => setHooks((hs) => hs.map((x) => (x.id === h.id ? { ...x, active: !x.active } : x)))}>{h.active ? 'Pause' : 'Turn on'}</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setHooks((hs) => hs.filter((x) => x.id !== h.id))}>Remove</button>
            </div>
          </div>
        ))}
        {!webhooks.length && <Empty>No webhooks yet.</Empty>}
      </section>
    </>
  );
}
