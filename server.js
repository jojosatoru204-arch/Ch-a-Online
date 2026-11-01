require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, maxHttpBufferSize: 1e5, pingInterval: 25000, pingTimeout: 20000 });
const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = Math.min(500, Math.max(1, Number(process.env.MAX_PLAYERS || 500)));
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const ADMIN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'local-development-secret-change-me';

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'chua-online', players: players.size, seats: MAX_PLAYERS }));

const players = new Map();
const seats = new Map();
const waiting = [];
const prayerNotes = [];
const reports = [];
let audioState = { musicUrl: '', ambienceUrl: '', enabled: false, volume: 0.35, updatedAt: Date.now() };
let ritual = { title: 'Không gian an lành', message: 'Chào mừng bạn đến với Chùa Online.', startsAt: null, active: false };
const banned = /(đm|địt|lồn|cặc|fuck|shit|bitch)/i;
const reserved = /admin|quản\s*trị|moderator|mod\b/i;
const clean = (s, max = 120) => String(s ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const validName = s => /^[\p{L}\p{N} ]{2,20}$/u.test(s) && !banned.test(s) && !reserved.test(s);
const publicPlayer = p => ({ id: p.id, name: p.name, character: p.character, seat: p.seat, x: p.x, z: p.z, status: p.status, action: p.action, lastSeen: p.lastSeen });
function snapshot() { return { players: [...players.values()].map(publicPlayer), waiting: waiting.length, occupied: seats.size, maxSeats: MAX_PLAYERS, ritual, audioState }; }
function broadcastState() { io.emit('world:state', snapshot()); }
function sign(payload) { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(body).digest('base64url'); return `${body}.${sig}`; }
function verify(token) {
  if (!token || typeof token !== 'string') return false;
  const [body, sig] = token.split('.'); if (!body || !sig) return false;
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(body).digest();
  let actual; try { actual = Buffer.from(sig, 'base64url'); } catch { return false; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try { const data = JSON.parse(Buffer.from(body, 'base64url').toString()); return data.exp > Date.now(); } catch { return false; }
}
function requireAdmin(req, res, next) { if (!verify(req.headers.authorization?.replace(/^Bearer\s+/i, ''))) return res.status(401).json({ error: 'Phiên quản trị không hợp lệ hoặc đã hết hạn.' }); next(); }
app.post('/api/admin/login', rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false }), async (req, res) => {
  const username = clean(req.body?.username, 40); const password = String(req.body?.password || '');
  if (!ADMIN_HASH || ADMIN_HASH === 'PASTE_BCRYPT_HASH_HERE') return res.status(503).json({ error: 'Chưa cấu hình ADMIN_PASSWORD_HASH trong biến môi trường.' });
  const okUser = username === ADMIN_USER; let okPass = false; try { okPass = await bcrypt.compare(password, ADMIN_HASH); } catch {}
  if (!okUser || !okPass) return res.status(401).json({ error: 'Thông tin đăng nhập không đúng.' });
  res.json({ token: sign({ user: ADMIN_USER, exp: Date.now() + 8 * 60 * 60_000 }) });
});
app.get('/api/admin/stats', requireAdmin, (_req, res) => res.json({ players: players.size, occupied: seats.size, waiting: waiting.length, notes: prayerNotes.length, reports: reports.length, maxSeats: MAX_PLAYERS }));
app.get('/api/admin/notes', requireAdmin, (_req, res) => res.json(prayerNotes.slice(-100).reverse()));
app.post('/api/admin/audio', requireAdmin, (req, res) => {
  const musicUrl = clean(req.body?.musicUrl, 500); const ambienceUrl = clean(req.body?.ambienceUrl, 500);
  for (const u of [musicUrl, ambienceUrl]) if (u && (!/^https:\/\//i.test(u))) return res.status(400).json({ error: 'Đường dẫn âm thanh phải dùng HTTPS.' });
  audioState = { musicUrl, ambienceUrl, enabled: !!req.body?.enabled, volume: Math.max(0, Math.min(1, Number(req.body?.volume ?? 0.35))), updatedAt: Date.now() };
  io.emit('audio:update', audioState); res.json({ ok: true, audioState });
});
app.post('/api/admin/ritual', requireAdmin, (req, res) => {
  ritual = { title: clean(req.body?.title, 80) || 'Nghi lễ chung', message: clean(req.body?.message, 240), startsAt: Date.now(), active: !!req.body?.active };
  io.emit('ritual:update', ritual); res.json({ ok: true, ritual });
});
app.post('/api/admin/announce', requireAdmin, (req, res) => { io.emit('notice', clean(req.body?.message, 240)); res.json({ ok: true }); });
app.post('/api/admin/remove-player', requireAdmin, (req, res) => { const id = clean(req.body?.id, 80); const p = players.get(id); if (!p) return res.status(404).json({ error: 'Không tìm thấy người chơi.' }); io.to(id).emit('session:removed'); releasePlayer(id); res.json({ ok: true }); });

function allocate(p) {
  for (let i = 1; i <= MAX_PLAYERS; i++) if (!seats.has(i)) { seats.set(i, p.id); p.seat = i; p.status = 'seated'; p.x = ((i - 1) % 20 - 9.5) * 1.25; p.z = -8 + Math.floor((i - 1) / 20) * 1.05; io.to(p.id).emit('seat:assigned', { seat: i, x: p.x, z: p.z }); return true; }
  p.status = 'waiting'; p.seat = null; if (!waiting.includes(p.id)) waiting.push(p.id); io.to(p.id).emit('queue:update', { position: waiting.length, total: waiting.length }); return false;
}
function offerNext() {
  while (waiting.length && seats.size < MAX_PLAYERS) {
    const id = waiting.shift(); const p = players.get(id); if (!p || p.status !== 'waiting') continue;
    allocate(p); break;
  }
  waiting.forEach((id, i) => io.to(id).emit('queue:update', { position: i + 1, total: waiting.length }));
}
function releasePlayer(id) {
  const p = players.get(id); if (!p) return;
  if (p.seat) seats.delete(p.seat);
  const wi = waiting.indexOf(id); if (wi >= 0) waiting.splice(wi, 1);
  players.delete(id); io.emit('player:left', { id }); offerNext(); broadcastState();
}
function join(socket, payload) {
  let name = clean(payload?.name, 20); if (!validName(name)) return socket.emit('join:error', 'Tên gồm 2–20 chữ cái, số hoặc khoảng trắng; không dùng từ bị cấm hay tên quản trị.');
  const used = new Set([...players.values()].map(p => p.name.toLocaleLowerCase('vi')));
  const base = name; let n = 2; while (used.has(name.toLocaleLowerCase('vi'))) { const suffix = ` ${n++}`; name = base.slice(0, 20 - suffix.length) + suffix; }
  const p = { id: socket.id, name, character: ['nam','nu','neutral'].includes(payload?.character) ? payload.character : 'neutral', seat: null, x: 0, z: 8, status: 'arriving', action: 'idle', lastSeen: Date.now(), joinedAt: Date.now() };
  players.set(socket.id, p); socket.emit('join:accepted', { player: publicPlayer(p), ritual, audioState }); allocate(p); io.emit('player:joined', publicPlayer(p)); broadcastState();
}
const cooldown = new Map();
function allowed(socket, key, ms) { const now = Date.now(); const k = `${socket.id}:${key}`; if (now - (cooldown.get(k) || 0) < ms) return false; cooldown.set(k, now); return true; }
io.on('connection', socket => {
  socket.emit('world:state', snapshot());
  socket.on('player:join', payload => { if (players.has(socket.id)) return; join(socket, payload); });
  socket.on('player:ready', () => { const p = players.get(socket.id); if (p) { p.lastSeen = Date.now(); socket.emit('player:ready:ok'); } });
  socket.on('player:heartbeat', () => { const p = players.get(socket.id); if (p) p.lastSeen = Date.now(); });
  socket.on('player:action', data => { const p = players.get(socket.id); if (!p || !allowed(socket,'action',1200)) return; const action = ['incense','flower','pray','bow','bell'].includes(data?.action) ? data.action : null; if (!action) return; p.action = action; p.lastSeen = Date.now(); io.emit('player:action', { id: p.id, action }); setTimeout(() => { const q = players.get(p.id); if (q && q.action === action) { q.action = 'idle'; io.emit('player:action', { id: q.id, action: 'idle' }); } }, 4500); });
  socket.on('prayer:submit', data => { const p = players.get(socket.id); if (!p || !allowed(socket,'prayer',30_000)) return; const message = clean(data?.message, 180); if (message.length < 3 || banned.test(message)) return socket.emit('notice','Lời nguyện cần từ 3–180 ký tự và dùng ngôn từ phù hợp.'); const note = { id: crypto.randomUUID(), name: p.name, message, createdAt: Date.now() }; prayerNotes.push(note); if (prayerNotes.length > 500) prayerNotes.shift(); socket.emit('prayer:accepted', note); io.emit('prayer:count', prayerNotes.length); });
  socket.on('chat:send', data => { const p = players.get(socket.id); if (!p || !allowed(socket,'chat',1800)) return; const message = clean(data?.message, 180); if (message.length < 1 || banned.test(message)) return socket.emit('notice','Tin nhắn không hợp lệ.'); io.emit('chat:message', { id: socket.id, name: p.name, message, at: Date.now() }); });
  socket.on('player:report', data => { const p = players.get(socket.id); if (!p || !allowed(socket,'report',60_000)) return; reports.push({ from: p.name, target: clean(data?.target,80), reason: clean(data?.reason,160), at: Date.now() }); if (reports.length > 300) reports.shift(); socket.emit('notice','Đã gửi báo cáo. Cảm ơn bạn.'); });
  socket.on('player:leave', () => releasePlayer(socket.id));
  socket.on('disconnect', () => { const p = players.get(socket.id); if (!p) return; p.status = 'disconnected'; const seat = p.seat; setTimeout(() => { const current = players.get(socket.id); if (current && current.status === 'disconnected') { if (seat) seats.delete(seat); releasePlayer(socket.id); } }, 30_000); });
});
setInterval(() => { const now = Date.now(); for (const p of players.values()) if (p.status !== 'disconnected' && now - p.lastSeen > 10 * 60_000) { io.to(p.id).emit('afk:warning'); p.lastSeen = now - 9 * 60_000; } }, 30_000);
setInterval(() => { io.emit('ceremony:tick', { at: Date.now(), message: 'Phút tĩnh tâm — xin cùng dành một khoảnh khắc an lành.' }); }, 60 * 60_000);
server.listen(PORT, '0.0.0.0', () => console.log(`CHÙA ONLINE đang chạy tại http://localhost:${PORT}`));
