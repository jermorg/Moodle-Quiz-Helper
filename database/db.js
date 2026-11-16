import {
    clean,
    makeHash
} from '../shared/utils.js';

const STORAGE_KEY = 'quizDatabase';

// Генерує універсальний ключ запису (qid або fingerprint)
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

// 1. Отримати всю базу у вигляді об'єкта { [key]: entry }
export async function getDatabase() {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    return data[STORAGE_KEY] || {};
}

// 2. Отримати статистику по базі (всього питань, з точною відповіддю, тільки з виключеннями)
export async function getDatabaseStats() {
    const db = await getDatabase();
    const entries = Object.values(db);

    const total = entries.length;
    const withCorrect = entries.filter(e => e.correct_answers?.length > 0).length;
    const withWrongsOnly = entries.filter(e => !e.correct_answers?.length && e.wrong_answers?.length > 0).length;

    return { total, withCorrect, withWrongsOnly };
}

// 3. Додати або об'єднати масив питань (або одне питання) у базу
export async function addQuestionsToDatabase(items) {
    const list = Array.isArray(items) ? items : [items];
    const db = await getDatabase();
    let addedCount = 0;
    let updatedCount = 0;

    list.forEach((item) => {
        const key = resolveEntryKey(item);
        if (!key) return;

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

        // Підтримка як масиву correct_answers, так і одиночного поля correct_answer
        const incomingCorrects = Array.isArray(item.correct_answers)
            ? item.correct_answers
            : (item.correct_answer ? [item.correct_answer] : []);

        incomingCorrects.forEach((c) => {
            const cleanC = clean(c);
            if (cleanC && !entry.correct_answers.includes(cleanC)) {
                entry.correct_answers.push(cleanC);
                // Якщо варіант став точним правильним — прибираємо його зі списку помилкових
                entry.wrong_answers = entry.wrong_answers.filter(w => w !== cleanC);
            }
        });

        // Накопичуємо неправильні відповіді
        const incomingWrongs = Array.isArray(item.wrong_answers) ? [...item.wrong_answers] : [];
        if (incomingCorrects.length === 0 && Array.isArray(item.user_selected)) {
            incomingWrongs.push(...item.user_selected);
        }

        incomingWrongs.forEach((w) => {
            const cleanW = clean(w);
            if (cleanW && !entry.correct_answers.includes(cleanW) && !entry.wrong_answers.includes(cleanW)) {
                entry.wrong_answers.push(cleanW);
            }
        });
    });

    await chrome.storage.local.set({ [STORAGE_KEY]: db });
    return { total: Object.keys(db).length, addedCount, updatedCount };
}

// 4. Видалити одне конкретне питання за його ключем (наприклад, 'qid:3145287')
export async function removeQuestionByKey(key) {
    const db = await getDatabase();
    if (!db[key]) return false;

    delete db[key];
    await chrome.storage.local.set({ [STORAGE_KEY]: db });
    return true;
}

// 5. Експортувати базу у форматі JSON-рядка (масив питань)
export async function exportDatabaseAsJson() {
    const db = await getDatabase();
    return JSON.stringify(Object.values(db), null, 2);
}

// 6. Повністю очистити базу
export async function clearDatabase() {
    await chrome.storage.local.remove(STORAGE_KEY);
}

// 7. Знайти запис питання за qid або резервним fingerprint
export async function findQuestionEntry(qid, fingerprint) {
  const db = await getDatabase();
  if (qid && db[`qid:${qid}`]) {
    return db[`qid:${qid}`];
  }
  return db[`fp:${fingerprint}`] || null;
}