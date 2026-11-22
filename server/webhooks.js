// Sends events to the TMS webhooks set up on the API & webhooks page, with retries.
// A new file only counts as delivered to the TMS once a webhook answers with a 2xx.
const RETRY_DELAYS_MS = [0, 5000, 30000]; // three tries: now, after 5s, after 30s more
const TIMEOUT_MS = 10000;

const now = () => new Date().toISOString();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body) {
  let lastError = '';
  for (const [i, delay] of RETRY_DELAYS_MS.entries()) {
    await wait(delay);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Good-Enough-Event': body.event },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, tries: i + 1 };
      lastError = `answered ${res.status}`;
    } catch (err) {
      lastError = err.cause?.code === 'ECONNREFUSED' ? 'nothing is listening at that address' : err.name === 'TimeoutError' ? 'no answer within 10 seconds' : err.message;
    }
  }
  return { ok: false, tries: RETRY_DELAYS_MS.length, error: lastError };
}

// getDb returns the current database (it's replaced on reset); save writes it.
export function createWebhooks({ getDb, save, log = console.log }) {
  // Applies a change to a transaction if it still exists, then saves.
  const update = (txId, fn) => {
    const db = getDb();
    const i = db.transactions.findIndex((t) => t.id === txId);
    if (i < 0) return;
    db.transactions[i] = fn(db.transactions[i]);
    save(db);
  };

  return function fire(event, data, txId) {
    const hooks = getDb().settings.webhooks.filter((h) => h.active && h.events.includes(event));
    const isDelivery = event === 'transaction.received';

    if (!hooks.length) {
      if (isDelivery) {
        update(txId, (t) => ({ ...t, status: 'tmsFailed', tmsError: 'No webhook is turned on for new files.', events: [...t.events, { at: now(), text: 'Not sent to TMS: no webhook is turned on for new files' }] }));
      }
      return;
    }

    let pending = hooks.length;
    let delivered = false;
    const errors = [];
    const body = { event, sentAt: now(), data };
    for (const hook of hooks) {
      post(hook.url, body).then((r) => {
        pending -= 1;
        log(`${r.ok ? '→' : '✗'} webhook ${event} to ${hook.url}${r.ok ? '' : `: ${r.error}`}`);
        if (r.ok) delivered = true;
        else errors.push(`${hook.url} ${r.error}`);
        if (!txId) return;
        update(txId, (t) => {
          const text = r.ok
            ? `${isDelivery ? 'Delivered to TMS' : `TMS told: ${event}`} (${hook.url}${r.tries > 1 ? `, try ${r.tries}` : ''})`
            : `${isDelivery ? 'TMS delivery failed' : `Couldn’t tell TMS: ${event}`} after ${r.tries} tries: ${hook.url} ${r.error}`;
          const next = { ...t, events: [...t.events, { at: now(), text }] };
          if (isDelivery && delivered) Object.assign(next, { status: 'delivered', tmsError: undefined });
          else if (isDelivery && !pending) Object.assign(next, { status: 'tmsFailed', tmsError: errors.join('; ') });
          return next;
        });
      });
    }
  };
}
