import { universalMoodleParser } from './parser.js';

const $parseBtn = $('#parseBtn');
const $copyBtn = $('#copyBtn');
const $parseStatus = $('#parseStatus');
const $parseOutput = $('#parseOutput');

$parseBtn.on('click', async () => {
    try {
        $parseStatus.text('Сканування сторінки...');
        $copyBtn.hide();

        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

        if (!tab?.id || !tab.url || tab.url.startsWith('chrome://')) {
            $parseStatus.text('Помилка: відкрийте сторінку тесту Moodle.');
            return;
        }

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['libs/jquery.min.js']
        });

        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: universalMoodleParser
        });

        if (!result || !result.length) {
            $parseStatus.text('Питань (.que) на цій сторінці не знайдено.');
            $parseOutput.text('');
            return;
        }

        // 3. Оновлюємо статистику та показуємо результат
        const withCorrect = result.filter(q => q.correct_answers.length > 0).length;
        $parseStatus.text(`Зпарсено: ${result.length} питань (точних відповідей: ${withCorrect}).`);
        $parseOutput.text(JSON.stringify(result, null, 2));
        $copyBtn.show();

    } catch (err) {
        $parseStatus.text(`Помилка виконання: ${err.message}`);
        $copyBtn.hide();
    }
});

$copyBtn.on('click', async function () {
    const jsonText = $parseOutput.text();
    if (!jsonText) return;

    await navigator.clipboard.writeText(jsonText);

    const $btn = $(this);
    $btn.text('Скопійовано!');
    setTimeout(() => $btn.text('Копіювати JSON'), 1500);
});