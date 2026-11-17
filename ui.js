import {
  getSyncConfig,
  saveSyncConfig,
  clearSyncConfig,
  testServerConnection,
  pullFromServer,
  pushToServer
} from './shared/sync.js';

import {
  getDatabaseStats,
  addQuestionsToDatabase,
  exportDatabaseAsJson,
  clearDatabase
} from './database/db.js';

import { universalMoodleParser } from './parser/parser.js';

$(async function () {
    const $connPill = $('#connPill');
    const $serverUrl = $('#serverUrl');
    const $apiToken = $('#apiToken');
    const $syncStatus = $('#syncStatus');
    const $dbStatus = $('#dbStatus');
    const $parseStatus = $('#parseStatus');
    const $parseOutput = $('#parseOutput');
    const $copyBtn = $('#copyBtn');

    // Перемикання вкладок
    $('.tab').on('click', function () {
        $('.tab, .panel').removeClass('active');
        $(this).addClass('active');
        $(`#${$(this).data('target')}`).addClass('active');
    });

    // Оновлення статусу локальної бази
    async function refreshDbStatus() {
        const { total, withCorrect, withWrongsOnly } = await getDatabaseStats();
        if (total === 0) {
        $dbStatus.text('Локальна база порожня.');
        return;
        }
        $dbStatus.html(
        `У локальній базі: <b>${total}</b> питань (точних: <b>${withCorrect}</b>, виключень: <b>${withWrongsOnly}</b>).`
        );
    }

    // Ініціалізація при відкритті popup
    const existingConfig = await getSyncConfig();
    if (existingConfig?.serverUrl) {
        $serverUrl.val(existingConfig.serverUrl);
        $apiToken.val(existingConfig.token);
        $connPill.addClass('online').text('Підключено');
        $syncStatus.html(`Підключено до <b>${existingConfig.serverUrl}</b>. Автосинхронізація активна.`);
    }
    await refreshDbStatus();

    // 1. Кнопка "Підключити і синхронізувати"
    $('#connectBtn').on('click', async function () {
        const url = $serverUrl.val().trim();
        const token = $apiToken.val().trim();

        if (!url || !token) {
            return $syncStatus.text('Помилка: заповніть обидва поля (URL і Token).');
        }

        const $btn = $(this).prop('disabled', true).text('Перевірка...');
        try {
            const ping = await testServerConnection(url, token);
            await saveSyncConfig(url, token);
            const pulled = await pullFromServer(true);

            $connPill.addClass('online').text('Підключено');
            $syncStatus.html(
                `Успішно підключено! На сервері <b>${ping.totalQuestions}</b> питань. Завантажено в локальну базу: <b>${pulled}</b>.`
            );
            await refreshDbStatus();
        } catch (err) {
            $connPill.removeClass('online').text('Помилка');
            $syncStatus.text(`Не вдалося підключитися: ${err.message}`);
        } finally {
            $btn.prop('disabled', false).text('Підключити і синхронізувати');
        }
    });

    // 2. Примусове оновлення бази з сервера
    $('#forceSyncBtn').on('click', async function () {
        const $btn = $(this).prop('disabled', true).text('Оновлення...');
        try {
            const pulled = await pullFromServer(true);
            if (pulled === null) {
                $syncStatus.text('Спочатку підключіть сервер.');
            } else {
                $syncStatus.html(`Синхронізацію завершено. Отримано записів: <b>${pulled}</b>.`);
                await refreshDbStatus();
            }
        } catch (err) {
            $syncStatus.text(`Помилка синхронізації: ${err.message}`);
        } finally {
            $btn.prop('disabled', false).text('Оновити базу зараз');
        }
    });

    // 3. Відключення від сервера
    $('#disconnectBtn').on('click', async () => {
        await clearSyncConfig();
        $serverUrl.val('');
        $apiToken.val('');
        $connPill.removeClass('online').text('Офлайн');
        $syncStatus.text('Налаштування сервера видалено. Розширення працює лише локально.');
    });

    // 4. Ручний імпорт JSON
    $('#saveJsonBtn').on('click', async () => {
        const raw = $('#jsonInput').val().trim();
        if (!raw) return $dbStatus.text('Поле порожнє. Вставте JSON.');

        try {
            const parsed = JSON.parse(raw);
            const { total, addedCount, updatedCount } = await addQuestionsToDatabase(parsed);
            $('#jsonInput').val('');
            $dbStatus.html(`Додано: <b>${addedCount}</b>, оновлено: <b>${updatedCount}</b>. Всього: <b>${total}</b>.`);

            // Якщо підключено сервер — одразу відправляємо туди додані питання
            await pushToServer(Array.isArray(parsed) ? parsed : [parsed]).catch(() => {});
        } catch (e) {
            $dbStatus.text(`Помилка JSON: ${e.message}`);
        }
    });

    // 5. Експорт бази
    $('#exportBtn').on('click', async () => {
        const json = await exportDatabaseAsJson();
        await navigator.clipboard.writeText(json);
        $dbStatus.text('Всю локальну базу скопійовано у буфер обміну!');
    });

    // 6. Очищення локальної бази
    $('#clearBtn').on('click', async () => {
        await clearDatabase();
        await refreshDbStatus();
    });

    // 7. Ручний парсинг сторінки
    $('#parseBtn').on('click', async () => {
        try {
            $parseStatus.text('Сканування сторінки...');
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['libs/jquery.min.js']
            });

            const [{ result }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: universalMoodleParser
            });

            if (!result || !result.length) {
                $parseStatus.text('Питань на сторінці не знайдено.');
                $parseOutput.hide();
                $copyBtn.hide();
                return;
            }

            // Автоматично зберігаємо локально і пушимо на сервер
            await addQuestionsToDatabase(result);
            const syncRes = await pushToServer(result).catch(() => null);
            await refreshDbStatus();

            const serverNote = syncRes ? ` Відправлено на сервер (всього там: ${syncRes.total}).` : '';
            $parseStatus.text(`Зпарсено ${result.length} питань.${serverNote}`);
            $parseOutput.text(JSON.stringify(result, null, 2)).show();
            $copyBtn.show();
        } catch (err) {
            $parseStatus.text(`Помилка: ${err.message}`);
        }
    });

    $copyBtn.on('click', async function () {
        await navigator.clipboard.writeText($parseOutput.text());
        const $btn = $(this).text('Скопійовано!');
        setTimeout(() => $btn.text('Копіювати'), 1500);
    });
});