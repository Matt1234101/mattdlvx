const Database = require('better-sqlite3');
const path = require('path');
const session = require('express-session');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'casino.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password_hash TEXT NOT NULL,
  balance REAL NOT NULL, total_wagered REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, game TEXT NOT NULL, amount REAL NOT NULL,
  multiplier REAL NOT NULL, payout REAL NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL,
  balance_after REAL NOT NULL, note TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bonus_claims (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, bonus TEXT NOT NULL, amount REAL NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, id);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);
`);

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash, balance, created_at) VALUES (?, ?, ?, ?)'),
  addBalance: db.prepare('UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?'),
  applyBet: db.prepare('UPDATE users SET balance = ROUND(balance - ? + ?, 2), total_wagered = total_wagered + ? WHERE id = ?'),
  insertBet: db.prepare('INSERT INTO bets (user_id, game, amount, multiplier, payout, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  insertTxn: db.prepare('INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  insertBonus: db.prepare('INSERT INTO bonus_claims (user_id, bonus, amount, created_at) VALUES (?, ?, ?, ?)'),
  lastBonus: db.prepare('SELECT * FROM bonus_claims WHERE user_id = ? AND bonus = ? ORDER BY id DESC LIMIT 1'),
  depositSum: db.prepare("SELECT SUM(amount) s FROM transactions WHERE user_id = ? AND type = 'deposit' AND created_at > ?"),
  txns: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 200'),
  bets: db.prepare('SELECT * FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT 200'),
  stats: db.prepare('SELECT COUNT(*) bets, ROUND(COALESCE(SUM(amount),0),2) wagered, ROUND(COALESCE(SUM(payout),0),2) won, ROUND(COALESCE(MAX(payout),0),2) biggestWin FROM bets WHERE user_id = ?'),
};

class SqliteStore extends session.Store {
  constructor() {
    super();
    this.g = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
    this.s = db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?, ?, ?)');
    this.d = db.prepare('DELETE FROM sessions WHERE sid = ?');
    setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600e3).unref();
  }
  get(sid, cb) { try { const r = this.g.get(sid, Date.now()); cb(null, r ? JSON.parse(r.sess) : null); } catch (e) { cb(e); } }
  set(sid, sess, cb) { try { const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 864e5; this.s.run(sid, JSON.stringify(sess), exp); cb && cb(null); } catch (e) { cb && cb(e); } }
  destroy(sid, cb) { try { this.d.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

module.exports = { db, q, tx: (fn) => db.transaction(fn), SqliteStore };
