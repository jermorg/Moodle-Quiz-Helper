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

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'quiz.db'));

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
    );

    CREATE TABLE IF NOT EXISTS test_questions (
        test_id TEXT NOT NULL,
        question_key TEXT NOT NULL,
        PRIMARY KEY (test_id, question_key)
    );
`);

const getTestsStatsStmt = db.prepare(`
    SELECT 
        tq.test_id,
        COUNT(tq.question_key) AS total,
        SUM(
            CASE 
                WHEN q.correct_answers IS NOT NULL AND q.correct_answers != '[]' 
                THEN 1 
                ELSE 0 
            END
        ) AS solved
    FROM test_questions tq
    LEFT JOIN questions q ON q.key = tq.question_key
    GROUP BY tq.test_id
`);

function buildTestsMap() {
    const rows = getTestsStatsStmt.all();
    const testsMap = {};
    for (const row of rows) {
        testsMap[row.test_id] = {
            total: Number(row.total) || 0,
            solved: Number(row.solved) || 0
        };
    }
    return testsMap;
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (token !== API_TOKEN) {
        return res.status(403).json({ error: 'Invalid or missing token' });
    }
    next();
}

app.get('/api/ping', authMiddleware, (req, res) => {
    const row = db.prepare('SELECT COUNT(*) as total FROM questions').get();
    const testsRow = db.prepare('SELECT COUNT(DISTINCT test_id) as total FROM test_questions').get();
    res.json({
        status: 'ok',
        totalQuestions: row.total,
        totalTests: testsRow.total
    });
});

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
        items: formatted,
        tests: buildTestsMap()
    });
});

app.post('/api/sync', authMiddleware, (req, res) => {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
    const payloadTestId = req.body?.testId ? String(req.body.testId) : null;

    if (!incoming.length) {
        return res.json({ status: 'ok', merged: 0, tests: buildTestsMap() });
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
    const insertTestLinkStmt = db.prepare(`
        INSERT OR IGNORE INTO test_questions (test_id, question_key) VALUES (?, ?)
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

            (item.correct_answers || []).forEach((c) => {
                if (c) {
                    correctSet.add(c);
                    wrongSet.delete(c);
                }
            });

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

            const linkTestId = item.testId ? String(item.testId) : payloadTestId;
            if (linkTestId) {
                insertTestLinkStmt.run(linkTestId, item.key);
            }

            mergedCount++;
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        return res.status(500).json({ error: err.message });
    }

    const totalRow = db.prepare('SELECT COUNT(*) as total FROM questions').get();
    res.json({
        status: 'ok',
        merged: mergedCount,
        total: totalRow.total,
        tests: buildTestsMap()
    });
});

app.listen(PORT, () => {
    console.log(`Moodle Sync API (CommonJS) listening on port ${PORT}`);
});