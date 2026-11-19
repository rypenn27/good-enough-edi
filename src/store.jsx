// App state: one reducer, saved to this browser's localStorage so changes survive a reload.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { partners, guidelines, mappings, sampleTransactions, sampleSettings, makeTransaction, OUR_IDS } from './data/sample.js';
import { envelope, parseX12, validate } from './lib/x12.js';

const STORAGE_KEY = 'good-enough-edi:v1';

export function guidelineFor(state, partner, set, dir) {
  const link = partner?.sets.find((s) => s.set === set && s.dir === dir);
  return state.guidelines.find((g) => g.id === link?.guideline);
}

// Inbound files are checked against the partner's guideline; a failure also means a rejecting 997.
function check(state, tx) {
  if (tx.dir !== 'in' || tx.status === 'resolved') return tx;
  const partner = state.partners.find((p) => p.id === tx.partnerId);
  const errors = validate(parseX12(tx.raw), guidelineFor(state, partner, tx.set, 'in'));
  if (!errors.length) return { ...tx, errors };
  const hasEvent = tx.events.some((e) => e.text.startsWith('997 rejection'));
  const events = hasEvent
    ? tx.events
    : [...tx.events, { at: tx.time, text: `${errors.length} problem${errors.length > 1 ? 's' : ''} found` }, { at: tx.time, text: '997 rejection sent to partner' }, { at: tx.time, text: 'Alert emailed to the EDI team' }];
  return { ...tx, errors, status: 'failed', ack: 'Rejected', events };
}

function initialState() {
  const base = { env: 'production', partners, guidelines, mappings, settings: sampleSettings, transactions: [] };
  base.transactions = sampleTransactions().map((tx) => check(base, tx));
  return base;
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Storage blocked or corrupt: fall back to sample data.
  }
  return initialState();
}

const now = () => new Date().toISOString();
const nextControl = (txs) => String(Math.max(...txs.map((t) => Number(t.control)), 0) + 1).padStart(9, '0');

function updateTx(state, id, fn) {
  return { ...state, transactions: state.transactions.map((t) => (t.id === id ? fn(t) : t)) };
}

function reducer(state, action) {
  switch (action.type) {
    case 'setEnv':
      return { ...state, env: action.env };

    case 'upload': {
      return { ...state, transactions: [action.tx, ...state.transactions] };
    }

    case 'reprocess':
      return updateTx(state, action.id, (t) => {
        const fresh = check(state, { ...t, status: 'delivered', ack: 'Sent', events: [...t.events, { at: now(), text: 'Reprocessed' }] });
        return fresh.errors.length ? fresh : { ...fresh, events: [...fresh.events, { at: now(), text: 'Delivered to TMS' }] };
      });

    case 'resolve':
      return updateTx(state, action.id, (t) => ({ ...t, status: 'resolved', events: [...t.events, { at: now(), text: 'Marked resolved' }] }));

    case 'resend':
      return updateTx(state, action.id, (t) => ({ ...t, status: 'awaiting997', ack: 'Pending', events: [...t.events, { at: now(), text: 'Sent again' }] }));

    case 'sendTest': {
      const partner = state.partners.find((p) => p.id === action.partnerId);
      const out = partner.sets.find((s) => s.dir === 'out') || { set: '997' };
      const fields = { '204': null, '990': { shipmentId: 'TEST', action: 'A' }, '214': { shipmentId: 'TEST', status: 'X3', city: 'Akron', state: 'OH' }, '210': { invoice: 'TEST', shipmentId: 'TEST', amount: 100 } }[out.set];
      if (!fields) return state;
      const tx = makeTransaction({ env: 'test', dir: 'out', partner, set: out.set, control: nextControl(state.transactions), ref: `Test ${out.set}`, status: 'awaiting997', fields });
      return { ...state, transactions: [tx, ...state.transactions] };
    }

    case 'addPartner':
      return { ...state, partners: [...state.partners, action.partner] };

    case 'updatePartner':
      return { ...state, partners: state.partners.map((p) => (p.id === action.id ? action.fn(p) : p)) };

    case 'updateMapping':
      return {
        ...state,
        mappings: state.mappings.map((m) => {
          if (m.id !== action.id) return m;
          const next = action.fn(m);
          // Editing a live mapping starts a new draft version.
          if (action.edit && m.status === 'Live') return { ...next, status: 'Draft', version: m.version + 1 };
          return next;
        }),
      };

    case 'updateSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case 'reset':
      return initialState();

    default:
      return state;
  }
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Not saved; the app still works for this visit.
    }
  }, [state]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((text, tone = 'ok') => setToast({ text, tone, key: Date.now() }), []);

  // Reads an uploaded or pasted file, finds the partner by sender ID and checks it.
  const uploadFile = useCallback(
    (raw) => {
      const segments = parseX12(raw);
      const env = envelope(segments);
      if (!segments.length || segments[0].id !== 'ISA') return { error: 'This doesn’t look like an X12 file. It should start with an ISA segment.' };
      const partner = state.partners.find((p) => p.isaId === env.senderId || p.testIsaId === env.senderId);
      if (!partner) return { error: `No trading partner has the sender ID "${env.senderId}". Add the partner first, or check the ISA-06 value.` };
      if (![OUR_IDS.id, OUR_IDS.testId].includes(env.receiverId)) return { error: `This file is addressed to "${env.receiverId}", not to your ID ${OUR_IDS.id}.` };
      const isTest = env.usage === 'T' || env.senderId === partner.testIsaId;
      let tx = {
        id: `tx-up-${Date.now()}`, time: now(), env: isTest ? 'test' : 'production', dir: 'in', partnerId: partner.id,
        set: env.set, control: env.control, ref: 'Uploaded file', status: 'delivered', ack: 'Sent', via: 'Upload', raw, fields: null,
        events: [{ at: now(), text: 'File uploaded by hand' }, { at: now(), text: `Matched to partner ${partner.name}` }, { at: now(), text: 'Checked against guideline' }],
        errors: [],
      };
      tx = check(state, tx);
      if (!tx.errors.length) tx.events.push({ at: now(), text: 'Delivered to TMS' }, { at: now(), text: '997 acceptance sent to partner' });
      dispatch({ type: 'upload', tx });
      return { tx };
    },
    [state],
  );

  const value = useMemo(() => ({ state, dispatch, toast, notify, uploadFile }), [state, toast, notify, uploadFile]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}

export function usePartner(id) {
  const { state } = useStore();
  return state.partners.find((p) => p.id === id);
}
