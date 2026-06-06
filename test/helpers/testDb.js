import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDatabase } from '../../src/db/database.js';

export function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-auto-reply-'));
  const dbPath = path.join(dir, 'test.db');
  const db = openDatabase(dbPath);
  return { db, dbPath, dir };
}
