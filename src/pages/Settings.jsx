import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Facts, PageHeader } from '../components/ui.jsx';
import { OUR_IDS } from '../data/sample.js';

export default function Settings() {
  const { state, dispatch, notify } = useStore();
  const [form, setForm] = useState({ companyName: state.settings.companyName, notifyEmail: state.settings.notifyEmail, retentionDays: state.settings.retentionDays });
  const [confirmReset, setConfirmReset] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Settings" />

      <section className="card card-pad" style={{ maxWidth: 760 }}>
        <h2>Company</h2>
        <div className="form-grid">
          <label className="field">Company name<input value={form.companyName} onChange={set('companyName')} /></label>
          <label className="field">Send alerts to<input type="email" value={form.notifyEmail} onChange={set('notifyEmail')} /></label>
          <label className="field">Keep files for (days)<input type="number" min="7" value={form.retentionDays} onChange={set('retentionDays')} /></label>
        </div>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => { dispatch({ type: 'updateSettings', patch: { ...form, retentionDays: Number(form.retentionDays) } }); notify('Settings saved.'); }}>Save</button>
        </div>
      </section>

      <section className="card card-pad" style={{ maxWidth: 760 }}>
        <h2>Your EDI identifiers</h2>
        <div className="muted">Partners put these in the receiver fields of every file they send you.</div>
        <Facts items={[['ISA qualifier', OUR_IDS.qualifier], ['ISA ID (production)', OUR_IDS.id], ['ISA ID (test)', OUR_IDS.testId], ['AS2 ID', OUR_IDS.as2Id]]} />
      </section>

      <section className="card card-pad" style={{ maxWidth: 760 }}>
        <h2>Sample data</h2>
        <div className="muted">Everything you change is saved in this browser only. Resetting puts back the original sample partners, files and mappings.</div>
        <div className="actions">
          {confirmReset ? (
            <>
              <span style={{ alignSelf: 'center', fontSize: 13 }}>Reset everything to the sample data?</span>
              <button type="button" className="btn btn-danger" onClick={() => { dispatch({ type: 'reset' }); setConfirmReset(false); notify('Sample data restored.'); }}>Yes, reset</button>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmReset(true)}>Reset sample data</button>
          )}
        </div>
      </section>
    </>
  );
}
