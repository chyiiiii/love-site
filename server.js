const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 数据库 ====================
const dbPath = path.join(__dirname, 'data', 'love.db');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

const db = new Database(dbPath, { /* verbose: console.log */ });

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    time TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS anniversaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    emoji TEXT DEFAULT '🎉'
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    desc_text TEXT DEFAULT '',
    date TEXT NOT NULL
  );
`);

// ==================== 中间件 ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== 文件上传 ====================
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只允许图片文件'));
  }
});

// ==================== 静态文件 ====================
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==================== API 路由 ====================

// 获取所有数据
app.get('/api/data', (req, res) => {
  try {
    // settings → { key: value } 对象
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    if (!settings.name1) settings.name1 = '宝贝';
    if (!settings.name2) settings.name2 = '亲爱的';
    if (!settings.startDate) settings.startDate = '2024-01-01';

    const messages = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
    const anniversaries = db.prepare('SELECT * FROM anniversaries ORDER BY id ASC').all();
    const photos = db.prepare('SELECT * FROM photos ORDER BY id DESC').all();

    res.json({ success: true, data: { settings, messages, anniversaries, photos } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 保存设置
app.post('/api/settings', (req, res) => {
  try {
    const { name1, name2, startDate } = req.body;
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    if (name1) upsert.run('name1', name1);
    if (name2) upsert.run('name2', name2);
    if (startDate) upsert.run('startDate', startDate);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 发悄悄话
app.post('/api/messages', (req, res) => {
  try {
    const { sender, text, time } = req.body;
    if (!sender || !text || !time) return res.status(400).json({ success: false, error: '缺少参数' });
    const stmt = db.prepare('INSERT INTO messages (sender, text, time) VALUES (?, ?, ?)');
    const result = stmt.run(sender, text, time);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 添加纪念日
app.post('/api/anniversaries', (req, res) => {
  try {
    const { name, date, emoji } = req.body;
    if (!name || !date) return res.status(400).json({ success: false, error: '缺少参数' });
    const stmt = db.prepare('INSERT INTO anniversaries (name, date, emoji) VALUES (?, ?, ?)');
    const result = stmt.run(name, date, emoji || '🎉');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 删除纪念日
app.delete('/api/anniversaries/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM anniversaries WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 上传照片
app.post('/api/photos/upload', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请选择照片' });
    const desc = req.body.desc || '我们的照片';
    const date = new Date();
    const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const stmt = db.prepare('INSERT INTO photos (filename, desc_text, date) VALUES (?, ?, ?)');
    const result = stmt.run(req.file.filename, desc, dateStr);
    res.json({ success: true, id: result.lastInsertRowid, filename: req.file.filename, date: dateStr });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Base64 上传照片（兼容旧前端）
app.post('/api/photos/base64', (req, res) => {
  try {
    const { data, desc, date } = req.body;
    if (!data) return res.status(400).json({ success: false, error: '缺少图片数据' });

    // 从 base64 里提取图片数据
    const matches = data.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ success: false, error: '图片格式不对' });

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const filename = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

    fs.writeFileSync(path.join(__dirname, 'uploads', filename), buffer);

    const dateStr = date || new Date().toISOString().slice(0, 10);
    const stmt = db.prepare('INSERT INTO photos (filename, desc_text, date) VALUES (?, ?, ?)');
    const result = stmt.run(filename, desc || '我们的照片', dateStr);

    res.json({ success: true, id: result.lastInsertRowid, filename, date: dateStr });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 删除照片
app.delete('/api/photos/:id', (req, res) => {
  try {
    const photo = db.prepare('SELECT filename FROM photos WHERE id = ?').get(req.params.id);
    if (photo) {
      // 删除文件
      const filePath = path.join(__dirname, 'uploads', photo.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 清空所有数据
app.post('/api/clear', (req, res) => {
  try {
    db.prepare('DELETE FROM settings').run();
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM anniversaries').run();
    // 删除所有照片文件和记录
    const photos = db.prepare('SELECT filename FROM photos').all();
    photos.forEach(p => {
      const fp = path.join(__dirname, 'uploads', p.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    db.prepare('DELETE FROM photos').run();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 启动 ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🌿 情侣网站已启动！`);
  console.log(`  ─────────────────────────────`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  console.log(`  局域网:    http://你的IP:${PORT}`);
  console.log(`  上线部署后分享给别人即可同步数据\n`);
});
