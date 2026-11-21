import {
    getSyncConfig,
    saveSyncConfig,
    clearSyncConfig,
    testServerConnection,
    pullFromServer,
    pushToServer
} from './shared/sync.js';

let lastParsedItems = [];

function formatTime(ts) {
    if (!ts) return 'ще не було';
    return new Date(ts).toLocaleTimeString('uk-UA', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

async function refreshDashboard() {
    const config = await getSyncConfig();
    const { quizDatabase = {}, testsStats = {} } = await chrome.storage.local.get([
        'quizDatabase',
        'testsStats'
    ]);

    const qCount = Object.keys(quizDatabase).length;
    const tCount = Object.keys(testsStats).length;

    $('#statQuestions').text(qCount);
    $('#statTests').text(tCount);

    const $pill = $('#connPill');
    if (config?.serverUrl && config?.token) {
        $('#serverUrl').val(config.serverUrl);
        $('#apiToken').val(config.token);
        $pill.text('Онлайн').addClass('online');
        $('#forceSyncBtn, #disconnectBtn').prop('disabled', false);
        $('#syncStatus').html(
            `Підключено до <b>${config.serverUrl}</b><br>Остання синхронізація: <b>${formatTime(config.lastSync)}</b>`
        );
    } else {
        $pill.text('Офлайн').removeClass('online');
        $('#forceSyncBtn, #disconnectBtn').prop('disabled', true);
        $('#syncStatus').text('Введіть адресу сервера та токен для автоматичної синхронізації відповідей.');
    }
}

$(async function () {
    // Перемикання вкладок
    $('.tab').on('click', function () {
        const target = $(this).data('target');
        $('.tab').removeClass('active');
        $(this).addClass('active');
        $('.panel').removeClass('active');
        $(`#${target}`).addClass('active');
    });

    await refreshDashboard();

    // Підключення і повне завантаження з сервера
    $('#connectBtn').on('click', async function () {
        const url = $('#serverUrl').val();
        const token = $('#apiToken').val();

        if (!url.trim() || !token.trim()) {
            $('#syncStatus').text('Заповніть адресу сервера та токен.');
            return;
        }

        const $btn = $(this).prop('disabled', true).text('Підключення...');
        try {
            const ping = await testServerConnection(url, token);
            await saveSyncConfig(url, token);
            await pullFromServer(true);
            await refreshDashboard();
            $('#syncStatus').html(
                `Успішно підключено! На сервері: <b>${ping.totalQuestions}</b> питань у <b>${ping.totalTests || 0}</b> тестах.`
            );
        } catch (err) {
            $('#syncStatus').html(`<span style="color:#dc2626">Помилка: ${err.message}</span>`);
        } finally {
            $btn.prop('disabled', false).text('Підключити і синхронізувати');
        }
    });

    // Примусове оновлення кешу з сервера
    $('#forceSyncBtn').on('click', async function () {
        const $btn = $(this).prop('disabled', true).text('Оновлення...');
        try {
            const added = await pullFromServer(true);
            await refreshDashboard();
            $('#syncStatus').html(
                `Базу оновлено з сервера (завантажено записів: <b>${added ?? 0}</b>).`
            );
        } catch (err) {
            $('#syncStatus').html(`<span style="color:#dc2626">Помилка: ${err.message}</span>`);
        } finally {
            $btn.prop('disabled', false).text('Оновити з сервера');
        }
    });

    // Вихід (очищення конфігурації та локального кешу)
    $('#disconnectBtn').on('click', async function () {
        await clearSyncConfig();
        await chrome.storage.local.remove(['quizDatabase', 'testsStats']);
        $('#serverUrl').val('');
        $('#apiToken').val('');
        await refreshDashboard();
    });

    // Ручний парсинг активної вкладки
    $('#parseBtn').on('click', async function () {
        const $btn = $(this).prop('disabled', true).text('Парсинг...');
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error('Активну вкладку не знайдено');

            const [{ result }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: async () => {
                    const { universalMoodleParser } = await import(chrome.runtime.getURL('parser/parser.js'));
                    return await universalMoodleParser();
                }
            });

            lastParsedItems = Array.isArray(result) ? result : [];
            $('#parseStatus').html(`Знайдено питань на сторінці: <b>${lastParsedItems.length}</b>`);

            if (lastParsedItems.length > 0) {
                $('#parseOutput').text(JSON.stringify(lastParsedItems, null, 2)).show();
                $('#pushParsedBtn, #copyBtn').show();
            } else {
                $('#parseOutput').hide();
                $('#pushParsedBtn, #copyBtn').hide();
            }
        } catch (err) {
            $('#parseStatus').html(`<span style="color:#dc2626">Помилка: ${err.message}</span>`);
        } finally {
            $btn.prop('disabled', false).text('Зпарсити сторінку');
        }
    });

    // Відправка вручну зпарсеного на сервер
    $('#pushParsedBtn').on('click', async function () {
        if (!lastParsedItems.length) return;
        const $btn = $(this).prop('disabled', true).text('Відправка...');
        try {
            const res = await pushToServer(lastParsedItems);
            if (!res) throw new Error('Спершу підключіть сервер на першій вкладці');
            await refreshDashboard();
            $('#parseStatus').html(`Відправлено на сервер: <b>${res.merged}</b> питань.`);
        } catch (err) {
            $('#parseStatus').html(`<span style="color:#dc2626">Помилка: ${err.message}</span>`);
        } finally {
            $btn.prop('disabled', false).text('На сервер');
        }
    });

    // Копіювання JSON у буфер
    $('#copyBtn').on('click', async function () {
        if (!lastParsedItems.length) return;
        await navigator.clipboard.writeText(JSON.stringify(lastParsedItems, null, 2));
        const $btn = $(this).text('Скопійовано!');
        setTimeout(() => $btn.text('Копіювати'), 1500);
    });
});