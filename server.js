// Play-money casino demo. NO real money. Credits have no cash value.
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const START_BALANCE = 10000;
const MIN_BET = 1;
const MAX_BET = 5000;
const DAILY_DEPOSIT_LIMIT = 5000; // free play credits per 24h
const WELCOME_BONUS = 2500;
const DAILY_BONUS = 500;
const TIERS = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 5000 },
  { name: 'Gold', min: 25000 },
  { name: 'Platinum', min: 100000 },
  { name: 'Diamond', min: 500000 },
];

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  store: new db.SqliteStore(),
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 },
}));
app.use(express.static(path.join(__dirname, 'public')));

const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32; // [0,1)
const round2 = (n) => Math.round(n * 100) / 100;

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const u = db.q.userById.get(req.session.userId);
  if (!u) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Not logged in' }); }
  req.user = u; next();
}

function vipInfo(totalWagered) {
  let i = 0;
  while (i + 1 < TIERS.length && totalWagered >= TIERS[i + 1].min) i++;
  const cur = TIERS[i], next = TIERS[i + 1];
  const progress = next ? (totalWagered - cur.min) / (next.min - cur.min) : 1;
  return { tier: cur.name, level: i + 1, next: next ? next.name : null, nextAt: next ? next.min : null, progress: Math.min(1, progress), totalWagered: round2(totalWagered) };
}

function depositedLast24h(userId) {
  return db.q.depositSum.get(userId, Date.now() - 24 * 3600 * 1000).s || 0;
}

function bonusList(u) {
  const now = Date.now();
  const lastDaily = db.q.lastBonus.get(u.id, 'daily')?.created_at || 0;
  const welcomeClaimed = !!db.q.lastBonus.get(u.id, 'welcome');
  const dailyReadyAt = lastDaily + 24 * 3600 * 1000;
  return [
    { id: 'welcome', title: 'Welcome Bonus', amount: WELCOME_BONUS, description: 'One-time play-credit gift for new players', available: !welcomeClaimed, claimed: welcomeClaimed },
    { id: 'daily', title: 'Daily Bonus', amount: DAILY_BONUS, description: 'Free play credits every 24 hours', available: now >= dailyReadyAt, availableAt: dailyReadyAt },
  ];
}

function publicUser(u) {
  const bonuses = bonusList(u);
  return {
    id: u.id, username: u.username, balance: round2(u.balance), createdAt: u.created_at,
    vip: vipInfo(u.total_wagered), availableBonuses: bonuses.filter(b => b.available).length,
    depositRemaining: round2(Math.max(0, DAILY_DEPOSIT_LIMIT - depositedLast24h(u.id))),
    stats: db.q.stats.get(u.id),
  };
}

// ---------- Auth ----------
app.post('/api/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or _' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.q.userByName.get(username)) return res.status(409).json({ error: 'Username taken' });
  const hash = bcrypt.hashSync(password, 10);
  const id = db.tx(() => {
    const r = db.q.insertUser.run(username, hash, START_BALANCE, Date.now());
    db.q.insertTxn.run(r.lastInsertRowid, 'signup', START_BALANCE, START_BALANCE, 'Starting play credits', Date.now());
    return r.lastInsertRowid;
  })();
  req.session.regenerate(() => { req.session.userId = id; res.json({ user: publicUser(db.q.userById.get(id)) }); });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = typeof username === 'string' && db.q.userByName.get(username);
  if (!u || typeof password !== 'string' || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
  req.session.regenerate(() => { req.session.userId = u.id; res.json({ user: publicUser(u) }); });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('connect.sid'); res.json({ ok: true }); }));

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- Wallet ----------
app.post('/api/deposit', auth, (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const remaining = DAILY_DEPOSIT_LIMIT - depositedLast24h(req.user.id);
  if (amount > remaining) return res.status(400).json({ error: `Daily free top-up limit reached. You can add ${round2(Math.max(0, remaining))} more credits in the next 24h.` });
  const amt = round2(amount);
  db.tx(() => {
    db.q.addBalance.run(amt, req.user.id);
    const bal = db.q.userById.get(req.user.id).balance;
    db.q.insertTxn.run(req.user.id, 'deposit', amt, bal, 'Free play-credit top-up', Date.now());
  })();
  res.json({ user: publicUser(db.q.userById.get(req.user.id)) });
});

app.get('/api/bonuses', auth, (req, res) => res.json({ bonuses: bonusList(req.user) }));

app.post('/api/bonuses/:id/claim', auth, (req, res) => {
  const b = bonusList(req.user).find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Unknown bonus' });
  if (!b.available) return res.status(400).json({ error: 'Bonus not available yet' });
  db.tx(() => {
    db.q.addBalance.run(b.amount, req.user.id);
    db.q.insertBonus.run(req.user.id, b.id, b.amount, Date.now());
    const bal = db.q.userById.get(req.user.id).balance;
    db.q.insertTxn.run(req.user.id, 'bonus', b.amount, bal, b.title, Date.now());
  })();
  const u = db.q.userById.get(req.user.id);
  res.json({ user: publicUser(u), bonuses: bonusList(u) });
});

app.get('/api/transactions', auth, (req, res) => res.json({ transactions: db.q.txns.all(req.user.id) }));
app.get('/api/bets', auth, (req, res) => {
  const rows = db.q.bets.all(req.user.id).map(r => ({ ...r, details: JSON.parse(r.details) }));
  res.json({ bets: rows });
});
app.get('/api/notifications', auth, (req, res) => {
  const items = [];
  const bs = bonusList(req.user).filter(b => b.available);
  bs.forEach(b => items.push({ text: `${b.title}: ${b.amount} play credits ready to claim` }));
  const v = vipInfo(req.user.total_wagered);
  if (v.next) items.push({ text: `Wager ${round2(v.nextAt - v.totalWagered)} more credits to reach ${v.next}` });
  res.json({ notifications: items });
});

// ---------- Games (all outcomes resolved server-side) ----------
const SLOT_SYMBOLS = [
  { s: '🍒', w: 30, pay3: 4 }, { s: '🍋', w: 25, pay3: 8 }, { s: '🔔', w: 18, pay3: 15 },
  { s: '⭐', w: 12, pay3: 30 }, { s: '💎', w: 7, pay3: 75 }, { s: '7️⃣', w: 3, pay3: 200 },
];
const SLOT_TOTAL = SLOT_SYMBOLS.reduce((a, b) => a + b.w, 0);
function slotSpin() { let r = rnd() * SLOT_TOTAL; for (const x of SLOT_SYMBOLS) { if ((r -= x.w) < 0) return x; } return SLOT_SYMBOLS[0]; }

const PLINKO_ROWS = 12; // RTPs: plinko ~99%, slots ~97.5%, dice/crash 99%
const PLINKO_MULTS = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};

const GAMES = {
  dice: (body) => {
    const target = Number(body.target); const dir = body.direction === 'under' ? 'under' : 'over';
    if (!Number.isFinite(target) || target < 2 || target > 98) throw new Error('Target must be between 2 and 98');
    const roll = round2(rnd() * 100);
    const chance = dir === 'over' ? 100 - target : target;
    const mult = round2(99 / chance); // 1% house edge
    const win = dir === 'over' ? roll > target : roll < target;
    return { multiplier: win ? mult : 0, details: { roll, target, direction: dir, chance: round2(chance), payoutMultiplier: mult, win } };
  },
  slots: () => {
    const reels = [slotSpin(), slotSpin(), slotSpin()];
    let mult = 0;
    if (reels[0].s === reels[1].s && reels[1].s === reels[2].s) mult = reels[0].pay3;
    else if (reels[0].s === reels[1].s || reels[1].s === reels[2].s || reels[0].s === reels[2].s) mult = 1; // any pair returns the bet
    return { multiplier: mult, details: { reels: reels.map(r => r.s), win: mult > 0 } };
  },
  plinko: (body) => {
    const risk = PLINKO_MULTS[body.risk] ? body.risk : 'medium';
    const path = []; let slot = 0;
    for (let i = 0; i < PLINKO_ROWS; i++) { const right = rnd() < 0.5 ? 1 : 0; path.push(right); slot += right; }
    const mult = PLINKO_MULTS[risk][slot];
    return { multiplier: mult, details: { risk, path, slot, multipliers: PLINKO_MULTS[risk], win: mult >= 1 } };
  },
  crash: (body) => {
    const cashout = Number(body.cashout);
    if (!Number.isFinite(cashout) || cashout < 1.01 || cashout > 1000) throw new Error('Auto cash-out must be between 1.01x and 1000x');
    const r = rnd();
    const crashAt = Math.max(1, Math.floor((0.99 / (1 - r)) * 100) / 100);
    const win = crashAt >= cashout;
    return { multiplier: win ? round2(cashout) : 0, details: { crashAt: Math.min(crashAt, 10000), cashout: round2(cashout), win } };
  },
};

app.get('/api/games/config', (req, res) => res.json({ minBet: MIN_BET, maxBet: MAX_BET, plinko: { rows: PLINKO_ROWS, multipliers: PLINKO_MULTS }, slots: SLOT_SYMBOLS.map(({ s, pay3 }) => ({ s, pay3 })) }));

app.post('/api/games/:game/bet', auth, (req, res) => {
  const game = req.params.game;
  if (!GAMES[game]) return res.status(404).json({ error: 'Unknown game' });
  const amount = round2(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < MIN_BET) return res.status(400).json({ error: `Minimum bet is ${MIN_BET}` });
  if (amount > MAX_BET) return res.status(400).json({ error: `Maximum bet is ${MAX_BET}` });
  let outcome;
  try { outcome = GAMES[game](req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const result = db.tx(() => {
      const u = db.q.userById.get(req.user.id);
      if (u.balance < amount) throw Object.assign(new Error('Insufficient balance'), { status: 400 });
      const payout = round2(amount * outcome.multiplier);
      db.q.applyBet.run(amount, payout, amount, u.id);
      const bal = db.q.userById.get(u.id).balance;
      const now = Date.now();
      const r = db.q.insertBet.run(u.id, game, amount, outcome.multiplier, payout, JSON.stringify(outcome.details), now);
      db.q.insertTxn.run(u.id, 'bet', -amount, round2(bal - payout), `${game} bet #${r.lastInsertRowid}`, now);
      if (payout > 0) db.q.insertTxn.run(u.id, 'win', payout, bal, `${game} payout ${outcome.multiplier}x`, now);
      return { betId: r.lastInsertRowid, payout, profit: round2(payout - amount) };
    })();
    res.json({ ...result, game, amount, multiplier: outcome.multiplier, details: outcome.details, user: publicUser(db.q.userById.get(req.user.id)) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`Play-money casino demo listening on 0.0.0.0:${PORT}`));
