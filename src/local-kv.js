import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../data.db');

const db = new Database(dbPath);

// 初始化数据库表
db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT,
    expiration INTEGER
  )
`);

export class LocalKV {
  async get(key, type = 'text') {
    const row = db.prepare('SELECT value, expiration FROM kv WHERE key = ?').get(key);
    if (!row) return null;
    
    if (row.expiration && row.expiration < Date.now() / 1000) {
      this.delete(key);
      return null;
    }

    if (type === 'json') {
      try { return JSON.parse(row.value); } catch (e) { return null; }
    }
    return row.value;
  }

  async put(key, value, options = {}) {
    let valStr = typeof value === 'string' ? value : JSON.stringify(value);
    let expiration = null;
    if (options.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, expiration) VALUES (?, ?, ?)').run(key, valStr, expiration);
  }

  async delete(key) {
    db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  }

  async list(options = {}) {
    let query = 'SELECT key FROM kv';
    const params = [];
    if (options.prefix) {
      query += ' WHERE key LIKE ?';
      params.push(`${options.prefix}%`);
    }
    query += ' ORDER BY key ' + (options.reverse ? 'DESC' : 'ASC');
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const rows = db.prepare(query).all(...params);
    return {
      keys: rows.map(r => ({ name: r.key })),
      list_complete: true
    };
  }
}
