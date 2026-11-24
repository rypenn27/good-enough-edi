// The local inbox: one folder per partner, standing in for their SFTP folders.
//   edi-inbox/<partner id>/inbound   drop files here
//   edi-inbox/<partner id>/outbound  997s and other files "sent" to the partner
//   edi-inbox/<partner id>/archive   processed files
//   edi-inbox/<partner id>/error     files that couldn't be read, with a .txt saying why
// SFTPGo's partner home folders point at these same folders, so SFTP uploads land here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processInbound } from './process.js';

export const INBOX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'edi-inbox');
const SUBFOLDERS = ['inbound', 'outbound', 'archive', 'error'];
const SETTLE_MS = 1000; // skip files changed in the last second; they may still be copying

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');

export function ensureFolders(db) {
  for (const p of db.partners) {
    for (const sub of SUBFOLDERS) fs.mkdirSync(path.join(INBOX, p.id, sub), { recursive: true });
  }
}

// Writes an outbound file into the partner's outbound folder, as if sending it.
export function deliver(partner, tx) {
  fs.mkdirSync(path.join(INBOX, partner.id, 'outbound'), { recursive: true });
  fs.writeFileSync(path.join(INBOX, partner.id, 'outbound', `${tx.set}_${tx.control}.edi`), tx.raw);
}

// Keeps our control-number counter ahead of every number already used, in the database or
// in any outbound folder. Without this, a reset could reuse numbers and overwrite files.
export function syncControl(db) {
  let max = Number(db.lastControl) || 0;
  for (const t of db.transactions) if (t.dir === 'out') max = Math.max(max, Number(t.control) || 0);
  for (const p of db.partners) {
    const out = path.join(INBOX, p.id, 'outbound');
    if (!fs.existsSync(out)) continue;
    for (const name of fs.readdirSync(out)) {
      const m = /^\d{3}_(\d{9})\.edi$/.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  const changed = max !== db.lastControl;
  db.lastControl = max;
  return changed;
}

// Looks in every partner's inbound folder once. Returns the results of every file it
// handled (empty if nothing changed).
export function scan(db, log = console.log) {
  const handled = [];
  for (const partner of db.partners) {
    const inbound = path.join(INBOX, partner.id, 'inbound');
    if (!fs.existsSync(inbound)) continue;
    for (const name of fs.readdirSync(inbound)) {
      const src = path.join(inbound, name);
      let stat;
      try {
        stat = fs.statSync(src);
      } catch {
        continue;
      }
      if (!stat.isFile() || name.startsWith('.') || Date.now() - stat.mtimeMs < SETTLE_MS) continue;

      // Move it out of inbound first, so a file that's locked or fails can't be processed twice.
      const archived = path.join(INBOX, partner.id, 'archive', `${stamp()}_${name}`);
      try {
        fs.renameSync(src, archived);
      } catch {
        continue; // still locked by whatever is writing it; try next scan
      }

      const result = processInbound(db, fs.readFileSync(archived, 'utf8'), { via: 'Folder', partner, fileName: name });
      handled.push(result);
      if (result.error) {
        const errPath = path.join(INBOX, partner.id, 'error', path.basename(archived));
        fs.renameSync(archived, errPath);
        fs.writeFileSync(`${errPath}.txt`, `${result.error}\n`);
        db.inboxErrors.unshift({ at: new Date().toISOString(), partnerId: partner.id, file: name, error: result.error });
        log(`✗ ${partner.id}/${name}: ${result.error}`);
        continue;
      }
      if (result.ack) deliver(result.partner, result.ack);
      const failed = result.txs.filter((t) => t.errors.length).length;
      const sets = result.txs.map((t) => t.set).join(', ');
      log(`${failed ? '✗' : '✓'} ${partner.id}/${name}: ${result.txs.length} set${result.txs.length > 1 ? 's' : ''} (${sets}) in ${result.tx.control}${failed ? `, ${failed} failed` : ''}${result.ack ? `, 997 ${result.ack.control} written` : ''}${result.acked.length ? `, acknowledges ${result.acked.map((a) => `${a.out.set} ${a.out.control}`).join(', ')}` : ''}`);
    }
  }
  return handled;
}
