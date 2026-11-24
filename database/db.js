import { clean, makeHash } from '../shared/utils.js';

const STORAGE_KEY = 'quizDatabase';

export function resolveEntryKey(item) {
    if (item.key) return item.key;
    if (item.qid) return `qid:${item.qid}`;

    const qText = clean(item.question);
    const mediaPart = Array.isArray(item.media) ? item.media.join(',') : '';
    const optionsPart = Array.isArray(item.answers)
        ? item.answers.map(clean).sort().join('|')
        : '';

    return `fp:${makeHash(`${qText}::${mediaPart}::${optionsPart}`)}`;
}

export async function getDatabase() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || {};
}

export function lookupQuestion(db, qid, fingerprint) {
    if (!db) return null;
    if (qid && db[`qid:${qid}`]) return db[`qid:${qid}`];
    return db[`fp:${fingerprint}`] || null;
}

export async function findQuestionEntry(qid, fingerprint) {
    const db = await getDatabase();
    return lookupQuestion(db, qid, fingerprint);
}

export async function addQuestionsToDatabase(items) {
    const list = Array.isArray(items) ? items : [items];
    if (!list.length) return { total: 0, addedCount: 0, updatedCount: 0 };

    const db = await getDatabase();
    let addedCount = 0;
    let updatedCount = 0;

    for (const item of list) {
        const key = resolveEntryKey(item);
        if (!key) continue;

        if (!db[key]) {
            db[key] = {
                key,
                qid: item.qid || null,
                fingerprint: item.fingerprint || null,
                type: item.type || 'unknown',
                question: clean(item.question),
                media: Array.isArray(item.media) ? item.media : [],
                answers: Array.isArray(item.answers) ? item.answers.map(clean) : [],
                correct_answers: [],
                wrong_answers: []
            };
            addedCount++;
        } else {
            updatedCount++;
        }

        const entry = db[key];

        const incomingCorrects = Array.isArray(item.correct_answers)
            ? item.correct_answers
            : (item.correct_answer ? [item.correct_answer] : []);

        for (const c of incomingCorrects) {
            const cleanC = clean(c);
            if (cleanC && !entry.correct_answers.includes(cleanC)) {
                entry.correct_answers.push(cleanC);
                entry.wrong_answers = entry.wrong_answers.filter(w => w !== cleanC);
            }
        }

        const incomingWrongs = Array.isArray(item.wrong_answers) ? [...item.wrong_answers] : [];
        if (incomingCorrects.length === 0 && Array.isArray(item.user_selected)) {
            incomingWrongs.push(...item.user_selected);
        }

        for (const w of incomingWrongs) {
            const cleanW = clean(w);
            if (cleanW && !entry.correct_answers.includes(cleanW) && !entry.wrong_answers.includes(cleanW)) {
                entry.wrong_answers.push(cleanW);
            }
        }
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: db });
    return { total: Object.keys(db).length, addedCount, updatedCount };
}