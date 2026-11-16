// Inventory logic: merge Poke Genie imports into the app's own inventory.
import * as db from './db.js';
import { mapRow, identityKey } from './pokegenie.js';

export async function loadState() {
  const [pokemon, imports] = await Promise.all([db.getAll('pokemon'), db.getAll('imports')]);
  imports.sort((a, b) => a.importedAt.localeCompare(b.importedAt));
  return { pokemon, imports };
}

// Merge rows from one CSV into the inventory.
// - Same identity key -> update (CP/HP/level/moves/ranks may change after power-up)
// - New key -> add
// Rows within one file that share a key are kept as separate records and flagged.
export async function importRows(rows, fileName, existing) {
  const now = new Date().toISOString();
  const importId = `imp-${now}`;
  const byId = new Map(existing.map(p => [p.id, p]));
  const seenInFile = new Map();
  const changed = [];
  let added = 0, updated = 0, unchanged = 0, dupInFile = 0;

  for (const raw of rows) {
    const p = mapRow(raw);
    const base = identityKey(p);
    const n = (seenInFile.get(base) || 0) + 1;
    seenInFile.set(base, n);
    const id = n === 1 ? base : `${base}#${n}`;
    if (n > 1) dupInFile++;

    const prev = byId.get(id);
    if (prev) {
      const same = prev.cp === p.cp && prev.hp === p.hp && prev.scanDate === p.scanDate &&
        prev.fastMove === p.fastMove && prev.chargeMove1 === p.chargeMove1 && prev.chargeMove2 === p.chargeMove2;
      const rec = {
        ...prev, ...p, id,
        possibleDuplicate: prev.possibleDuplicate || n > 1,
        lastSeenAt: now, lastImportId: importId,
      };
      same ? unchanged++ : updated++;
      changed.push(rec);
    } else {
      added++;
      changed.push({
        ...p, id,
        possibleDuplicate: n > 1,
        status: 'owned',
        firstImportedAt: now, firstImportId: importId,
        lastSeenAt: now, lastImportId: importId,
      });
    }
  }
  // Flag the first record of any key that appeared more than once in this file.
  for (const rec of changed) {
    if (!rec.possibleDuplicate && (seenInFile.get(rec.id) || 0) > 1) rec.possibleDuplicate = true;
  }

  const imp = { id: importId, importedAt: now, fileName, rowCount: rows.length, added, updated, unchanged, dupInFile };
  await db.putMany('pokemon', changed);
  await db.putMany('imports', [imp]);
  return imp;
}

export async function exportBackup() {
  const { pokemon, imports } = await loadState();
  return { app: 'pogo-genie-app', version: 1, exportedAt: new Date().toISOString(), pokemon, imports };
}

export async function restoreBackup(data) {
  if (data?.app !== 'pogo-genie-app' || !Array.isArray(data.pokemon)) throw new Error('このアプリのバックアップファイルではありません');
  await db.clear('pokemon', 'imports');
  await db.putMany('pokemon', data.pokemon);
  await db.putMany('imports', data.imports || []);
}

export async function clearAll() {
  await db.clear('pokemon', 'imports');
}
