import {
  getDatabaseStats,
  addQuestionsToDatabase,
  exportDatabaseAsJson,
  clearDatabase
} from './db.js';


const $jsonInput = $('#jsonInput');
const $dbStatus = $('#dbStatus');

// Оновлення текстового статусу зі статистикою бази
async function refreshStatus() {
    const { total, withCorrect, withWrongsOnly } = await getDatabaseStats();
    if (total === 0) {
        $dbStatus.text('База порожня. Вставте JSON, щоб увімкнути фонову підсвітку.');
        return;
    }
    $dbStatus.html(
        `У базі питань: <b>${total}</b> (точних відповідей: <b>${withCorrect}</b>, лише виключень: <b>${withWrongsOnly}</b>).`
    );
}

// Ініціалізація статусу при відкритті вікна
refreshStatus();

// Кнопка "Зберегти в базу" (додає/оновлює питання з JSON)
$('#saveBtn').on('click', async () => {
    const raw = $jsonInput.val().trim();
    if (!raw) {
        return $dbStatus.text('Помилка: поле порожнє. Вставте JSON.');
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return $dbStatus.text(`Некоректний JSON: ${e.message}`);
    }

    const { total, addedCount, updatedCount } = await addQuestionsToDatabase(parsed);
    $jsonInput.val('');
    $dbStatus.html(
        `Готово! Додано нових: <b>${addedCount}</b>, оновлено: <b>${updatedCount}</b>. Усього в базі: <b>${total}</b>.`
    );
});

// Кнопка "Експорт бази"
$('#exportBtn').on('click', async () => {
    const { total } = await getDatabaseStats();
    if (total === 0) {
        return $dbStatus.text('База порожня, нічого експортувати.');
    }

    const jsonString = await exportDatabaseAsJson();
    await navigator.clipboard.writeText(jsonString);
    $dbStatus.text(`Усю базу (${total} питань) скопійовано у буфер обміну!`);
});

// Кнопка "Очистити"
$('#clearBtn').on('click', async () => {
    await clearDatabase();
    await refreshStatus();
});
