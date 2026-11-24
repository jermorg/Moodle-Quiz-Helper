import {
    getSyncConfig,
    saveSyncConfig,
    clearSyncConfig,
    testServerConnection,
    pullFromServer
} from './shared/sync.js';

let isConnected = false;

function formatTime(ts) {
    if (!ts) return 'ще не було';
    return new Date(ts).toLocaleTimeString('uk-UA', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function getHostLabel(url) {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

function switchView(viewName) {
    const showSettings = !isConnected || viewName === 'settings';
    $('#dashboardView').toggleClass('active', !showSettings);
    $('#settingsView').toggleClass('active', showSettings);
    $('#settingsToggleBtn').toggleClass('active', showSettings && isConnected);
}

async function refreshUI(preserveView = false) {
    const config = await getSyncConfig();
    isConnected = Boolean(config?.serverUrl && config?.token);

    const { hintsEnabled = true } = await chrome.storage.local.get({ hintsEnabled: true });
    $('#optHintsEnabled').prop('checked', Boolean(hintsEnabled));

    const $pill = $('#connPill');
    const $connText = $('#connText');

    if (isConnected) {
        const { quizDatabase = {}, testsStats = {} } = await chrome.storage.local.get([
            'quizDatabase',
            'testsStats'
        ]);

        $('#statQuestions').text(Object.keys(quizDatabase).length);
        $('#statTests').text(Object.keys(testsStats).length);

        const host = getHostLabel(config.serverUrl);
        $('#serverUrl').val(config.serverUrl);
        $('#apiToken').val(config.token);

        $pill.addClass('online').attr('title', `Підключено до ${config.serverUrl}`);
        $connText.text(`Онлайн · ${host}`);

        $('#settingsToggleBtn, #disconnectBtn, #hintsSettingCard').show();
        $('#connectBtn').text('Зберегти');
        $('#syncStatus').html(
            `Сервер: <b>${host}</b><br>Остання синхронізація: <b>${formatTime(config.lastSync)}</b>`
        );

        if (!preserveView) switchView('dashboard');
    } else {
        $pill.removeClass('online').removeAttr('title');
        $connText.text('Офлайн');

        $('#settingsToggleBtn, #disconnectBtn, #hintsSettingCard').hide();
        $('#connectBtn').text('Підключити');
        switchView('settings');
    }
}

$(async function () {
    await refreshUI();

    $('#settingsToggleBtn').on('click', function () {
        if (!isConnected) return;
        const isCurrentlySettings = $('#settingsView').hasClass('active');
        switchView(isCurrentlySettings ? 'dashboard' : 'settings');
    });

    $('#optHintsEnabled').on('change', async function () {
        await chrome.storage.local.set({ hintsEnabled: $(this).is(':checked') });
    });

    $('#toggleTokenVis').on('click', function () {
        const $input = $('#apiToken');
        const isPass = $input.attr('type') === 'password';
        $input.attr('type', isPass ? 'text' : 'password');
    });

    $('#connectBtn').on('click', async function () {
        const url = $('#serverUrl').val();
        const token = $('#apiToken').val();
        const $status = $('#settingsStatus').show();

        if (!url.trim() || !token.trim()) {
            $status.text('Заповніть адресу сервера та токен.');
            return;
        }

        const $btn = $(this).prop('disabled', true).text('Підключення...');
        try {
            const ping = await testServerConnection(url, token);
            await saveSyncConfig(url, token);
            await pullFromServer(true);
            await refreshUI(true);
            $status.html(
                `Підключено! На сервері: <b>${ping.totalQuestions}</b> питань у <b>${ping.totalTests || 0}</b> тестах.`
            );
            setTimeout(() => {
                $status.hide();
                switchView('dashboard');
            }, 600);
        } catch (err) {
            $status.html(`<span style="color:#dc2626">Помилка: ${err.message}</span>`);
        } finally {
            $btn.prop('disabled', false).text(isConnected ? 'Зберегти' : 'Підключити');
        }
    });

    $('#forceSyncBtn').on('click', async function () {
        const $btn = $(this).prop('disabled', true).text('Оновлення...');
        try {
            const added = await pullFromServer(true);
            await refreshUI(true);
            $('#syncStatus').html(
                `Базу оновлено з сервера (завантажено записів: <b>${added ?? 0}</b>).`
            );
        } catch (err) {
            $('#syncStatus').html(`<span style="color:#dc2626">Помилка: ${err.message}</span>`);
        } finally {
            $btn.prop('disabled', false).text('Оновити базу з сервера');
        }
    });

    $('#disconnectBtn').on('click', async function () {
        await clearSyncConfig();
        await chrome.storage.local.remove(['quizDatabase', 'testsStats']);
        $('#serverUrl').val('');
        $('#apiToken').val('');
        $('#settingsStatus').hide();
        await refreshUI();
    });
});