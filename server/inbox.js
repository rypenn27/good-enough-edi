// The local inbox: one folder per partner, standing in for their SFTP folders.
//   edi-inbox/<partner id>/inbound   drop files here
//   edi-inbox/<partner id>/outbound  997s and other files "sent" to the partner
//   edi-inbox/<partner id>/archive   processed files
//   edi-inbox/<partner id>/error     files that couldn't be read, with a .txt saying why
// Later, SFTPGo's partner home folders can point at these same folders.
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

// Looks in every partner's inbound folder once. Returns true if anything changed.
export function scan(db, log = console.log) {
  let changed = false;
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
      changed = true;
      if (result.error) {
        const errPath = path.join(INBOX, partner.id, 'error', path.basename(archived));
        fs.renameSync(archived, errPath);
        fs.writeFileSync(`${errPath}.txt`, `${result.error}\n`);
        db.inboxErrors.unshift({ at: new Date().toISOString(), partnerId: partner.id, file: name, error: result.error });
        log(`✗ ${partner.id}/${name}: ${result.error}`);
        continue;
      }
      if (result.ack) deliver(result.partner, result.ack);
      const { tx } = result;
      log(`${tx.errors.length ? '✗' : '✓'} ${partner.id}/${name}: ${tx.set} ${tx.control}${tx.errors.length ? `, ${tx.errors.length} problems` : ''}${result.ack ? `, 997 ${result.ack.control} written` : ''}`);
    }
  }
  return changed;
}
