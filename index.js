require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
    console.error('CRITICAL: Змінна середовища API_TOKEN не задана!');
    process.exit(1);
}

// Створюємо папку data для збереження файлу SQLite бази
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'quiz.db'));

// Ініціалізуємо таблицю питань
db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
        key TEXT PRIMARY KEY,
        qid TEXT,
        fingerprint TEXT,
        type TEXT,
        question TEXT,
        media TEXT,
        answers TEXT,
        correct_answers TEXT,
        wrong_answers TEXT,
        updated_at INTEGER
    )
`);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Middleware перевірки Bearer-токена
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (token !== API_TOKEN) {
        return res.status(403).json({ error: 'Invalid or missing token' });
    }
    next();
}

// Перевірка з'єднання (для тестування підключення з розширення)
app.get('/api/ping', authMiddleware, (req, res) => {
    const row = db.prepare('SELECT COUNT(*) as total FROM questions').get();
    res.json({ status: 'ok', totalQuestions: row.total });
});

// 1. Віддати актуальну базу клієнту (підтримує ?since=timestamp)
app.get('/api/db', authMiddleware, (req, res) => {
    const since = Number(req.query.since) || 0;
    const rows = db.prepare('SELECT * FROM questions WHERE updated_at > ?').all(since);

    const formatted = rows.map((r) => ({
        key: r.key,
        qid: r.qid,
        fingerprint: r.fingerprint,
        type: r.type,
        question: r.question,
        media: JSON.parse(r.media || '[]'),
        answers: JSON.parse(r.answers || '[]'),
        correct_answers: JSON.parse(r.correct_answers || '[]'),
        wrong_answers: JSON.parse(r.wrong_answers || '[]'),
        updated_at: r.updated_at
    }));

    res.json({
        serverTime: Date.now(),
        items: formatted
    });
});

// 2. Прийняти нові питання від користувача і змерджити в SQLite
app.post('/api/sync', authMiddleware, (req, res) => {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!incoming.length) {
        return res.json({ status: 'ok', merged: 0 });
    }

    const selectStmt = db.prepare('SELECT * FROM questions WHERE key = ?');
    const upsertStmt = db.prepare(`
        INSERT INTO questions (key, qid, fingerprint, type, question, media, answers, correct_answers, wrong_answers, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
        correct_answers = excluded.correct_answers,
        wrong_answers = excluded.wrong_answers,
        updated_at = excluded.updated_at
    `);

    const now = Date.now();
    let mergedCount = 0;

    db.exec('BEGIN TRANSACTION');
    try {
        for (const item of incoming) {
            if (!item.key) continue;

            const existing = selectStmt.get(item.key);
            const correctSet = new Set(existing ? JSON.parse(existing.correct_answers) : []);
            const wrongSet = new Set(existing ? JSON.parse(existing.wrong_answers) : []);

            // Додаємо точні відповіді та прибираємо їх зі списку помилкових
            (item.correct_answers || []).forEach((c) => {
                if (c) {
                    correctSet.add(c);
                    wrongSet.delete(c);
                }
            });

            // Додаємо неправильні варіанти (якщо їх немає серед правильних)
            (item.wrong_answers || []).forEach((w) => {
                if (w && !correctSet.has(w)) {
                    wrongSet.add(w);
                }
            });

            upsertStmt.run(
                item.key,
                item.qid || existing?.qid || null,
                item.fingerprint || existing?.fingerprint || null,
                item.type || existing?.type || 'unknown',
                item.question || existing?.question || '',
                JSON.stringify(item.media || (existing ? JSON.parse(existing.media) : [])),
                JSON.stringify(item.answers || (existing ? JSON.parse(existing.answers) : [])),
                JSON.stringify(Array.from(correctSet)),
                JSON.stringify(Array.from(wrongSet)),
                now
            );
            mergedCount++;
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        return res.status(500).json({ error: err.message });
    }

    const totalRow = db.prepare('SELECT COUNT(*) as total FROM questions').get();
    res.json({ status: 'ok', merged: mergedCount, total: totalRow.total });
});

app.listen(PORT, () => {
    console.log(`Moodle Sync API (CommonJS) listening on port ${PORT}`);
});