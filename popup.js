$(function () {
    const $jsonInput = $('#jsonInput');
    const $dbStatus = $('#dbStatus');
    const $parseStatus = $('#parseStatus');
    const $parseOutput = $('#parseOutput');
    const $copyBtn = $('#copyBtn');

    const clean = (str) => (str || '')
        .replace(/\u00A0/g, ' ')
        .replace(/[’`ʼ]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

    const makeHash = (str) => {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        }
        return (hash >>> 0).toString(16);
    };

    function resolveEntryKey(item) {
        if (item.key) return item.key;
        if (item.qid) return `qid:${item.qid}`;

        const qText = clean(item.question);
        const mediaPart = Array.isArray(item.media) ? item.media.join(',') : '';
        const optionsPart = Array.isArray(item.answers)
        ? item.answers.map(clean).sort().join('|')
        : '';

        return `fp:${makeHash(`${qText}::${mediaPart}::${optionsPart}`)}`;
    }

    // Перемикання вкладок
    $('.tab').on('click', function () {
        $('.tab, .panel').removeClass('active');
        $(this).addClass('active');
        $(`#${$(this).data('target')}`).addClass('active');
    });

    // Стан фонової бази при відкритті popup
    chrome.storage.local.get(['quizDatabase'], ({ quizDatabase }) => {
        const count = quizDatabase ? Object.keys(quizDatabase).length : 0;
        $dbStatus.text(
        count > 0
            ? `Активна фонова база: ${count} питань. Підсвічування працює автоматично на всіх сторінках тесту.`
            : 'База порожня. Вставте JSON, щоб увімкнути фонову допомогу.'
        );
    });

    // Збереження та об'єднання JSON у базу
    $('#saveBtn').on('click', async () => {
        const raw = $jsonInput.val().trim();
        if (!raw) {
        return $dbStatus.text('Помилка: поле порожнє. Вставте JSON.');
        }

        let incoming;
        try {
        incoming = JSON.parse(raw);
        if (!Array.isArray(incoming)) throw new Error('Очікується масив обʼєктів [...]');
        } catch (e) {
        return $dbStatus.text(`Помилка парсингу JSON: ${e.message}`);
        }

        const { quizDatabase = {} } = await chrome.storage.local.get(['quizDatabase']);

        $.each(incoming, (_, item) => {
        const key = resolveEntryKey(item);
        if (!key) return;

        if (!quizDatabase[key]) {
            quizDatabase[key] = {
            key,
            qid: item.qid || null,
            fingerprint: item.fingerprint || null,
            type: item.type || 'unknown',
            question: clean(item.question),
            answers: Array.isArray(item.answers) ? item.answers.map(clean) : [],
            correct_answers: [],
            wrong_answers: []
            };
        }

        const entry = quizDatabase[key];
        const incomingCorrects = Array.isArray(item.correct_answers)
            ? item.correct_answers
            : (item.correct_answer ? [item.correct_answer] : []);

        $.each(incomingCorrects, (_, c) => {
            const cleanC = clean(c);
            if (cleanC && !entry.correct_answers.includes(cleanC)) {
            entry.correct_answers.push(cleanC);
            }
        });

        const incomingWrongs = Array.isArray(item.wrong_answers) ? [...item.wrong_answers] : [];
        if (incomingCorrects.length === 0 && Array.isArray(item.user_selected)) {
            incomingWrongs.push(...item.user_selected);
        }

        $.each(incomingWrongs, (_, w) => {
            const cleanW = clean(w);
            if (cleanW && !entry.correct_answers.includes(cleanW) && !entry.wrong_answers.includes(cleanW)) {
            entry.wrong_answers.push(cleanW);
            }
        });
        });

        await chrome.storage.local.set({ quizDatabase });
        $jsonInput.val('');

        const total = Object.keys(quizDatabase).length;
        $dbStatus.text(`Збережено! У фоновій базі тепер ${total} питань. Сторінки тесту оновляться автоматично.`);
    });

    // Експорт бази
    $('#exportBtn').on('click', async () => {
        const { quizDatabase = {} } = await chrome.storage.local.get(['quizDatabase']);
        const list = Object.values(quizDatabase);

        if (!list.length) {
        return $dbStatus.text('База порожня, нічого копіювати.');
        }

        await navigator.clipboard.writeText(JSON.stringify(list, null, 2));
        $dbStatus.text(`Всю базу (${list.length} питань) скопійовано у буфер обміну!`);
    });

    // Очищення бази
    $('#clearBtn').on('click', async () => {
        await chrome.storage.local.remove('quizDatabase');
        $dbStatus.text('Фонову базу очищено.');
    });

    // Запуск парсера (спочатку впроваджуємо jquery.min.js на сторінку, потім запускаємо функцію)
    $('#parseBtn').on('click', async () => {
        try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['jquery.min.js']
        });

        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: universalMoodleParser
        });

        if (!result || !result.length) {
            $parseStatus.text('Питань на цій сторінці не знайдено.');
            $copyBtn.hide();
            return;
        }

        const withCorrect = result.filter(q => q.correct_answers.length > 0).length;
        $parseStatus.text(`Зпарсено: ${result.length} питань (точних відповідей: ${withCorrect}).`);
        $parseOutput.text(JSON.stringify(result, null, 2));
        $copyBtn.show();
        } catch (err) {
        $parseStatus.text(`Помилка: ${err.message}`);
        }
    });

    $copyBtn.on('click', function () {
        navigator.clipboard.writeText($parseOutput.text());
        const $btn = $(this).text('Скопійовано!');
        setTimeout(() => $btn.text('Копіювати JSON'), 1500);
    });
    });

    // Універсальний парсер сторінки Moodle на jQuery
    function universalMoodleParser() {
    const $ = window.jQuery;
    const clean = (str) => (str || '')
        .replace(/\u00A0/g, ' ')
        .replace(/[’`ʼ]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

    const makeHash = (str) => {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        }
        return (hash >>> 0).toString(16);
    };

    const extractQuestionId = ($block) => {
        const flagData = $block.find('.questionflagpostdata').val() || '';
        const flagMatch = flagData.match(/qid=(\d+)/);
        if (flagMatch) return flagMatch[1];

        let foundId = null;
        $block.find('.qtext img, .answer img').each((_, img) => {
        const urlMatch = ($(img).attr('src') || '').match(/\/questiontext\/\d+\/\d+\/(\d+)\//);
        if (urlMatch) {
            foundId = urlMatch[1];
            return false; // break
        }
        });
        return foundId;
    };

    const extractMediaSignatures = ($container) => {
        if (!$container.length) return [];
        return $container.find('img, audio, video, source').map((_, el) => {
        return ($(el).attr('src') || '').split('/').pop()?.split('?')[0] || '';
        }).get().filter(Boolean);
    };

    const results = [];

    $('.que').each((_, blockEl) => {
        const $block = $(blockEl);
        const $qtext = $block.find('.qtext');
        const questionText = clean($qtext.text());
        const qMedia = extractMediaSignatures($qtext);

        if (!questionText && !qMedia.length) return;

        const qid = extractQuestionId($block);
        const knownTypes = ['multichoice', 'truefalse', 'shortanswer', 'numerical', 'match', 'gapselect', 'ddwtos'];
        const qType = knownTypes.find(t => $block.hasClass(t)) || 'unknown';

        const answers = [];
        const selectedAnswers = [];

        // 1. Radio та Checkbox
        $block.find('.answer > div, .answer tr').each((_, rowEl) => {
        const $row = $(rowEl);
        const $input = $row.find('input[type="radio"], input[type="checkbox"]');
        if (!$input.length) return;

        const $textEl = $row.find('.flex-fill').length
            ? $row.find('.flex-fill')
            : ($row.find('label').length ? $row.find('label') : $row);

        const rawText = clean($textEl.text()).replace(/^([0-9]+|[a-zа-яіїєґ])[.)]\s*/i, '');
        const ansMedia = extractMediaSignatures($row);
        const fullOption = [rawText, ...ansMedia.map(m => `[img:${m}]`)].filter(Boolean).join(' ');

        if (fullOption) {
            answers.push(fullOption);
            if ($input.is(':checked')) selectedAnswers.push(fullOption);
        }
        });

        // 2. Текстові поля (shortanswer / numerical)
        if (!answers.length) {
        const textVal = clean($block.find('.answer input[type="text"]').val());
        if (textVal) selectedAnswers.push(textVal);
        }

        // 3. Випадаючі списки (match / gapselect)
        $block.find('.answer select').each((_, selEl) => {
        const $sel = $(selEl);
        const rowLabel = clean($sel.closest('tr').find('td.text').text());
        const chosenText = clean($sel.find('option:selected').text());
        if (chosenText && $sel.val() !== '0' && $sel.val() !== '') {
            selectedAnswers.push(rowLabel ? `${rowLabel} -> ${chosenText}` : chosenText);
        }
        });

        // 4. Визначення правильних та неправильних відповідей
        let correctAnswers = [];
        const wrongAnswers = [];

        const $rightEl = $block.find('.rightanswer');
        if ($rightEl.length) {
        const rightText = clean(
            $rightEl.text().replace(/^(Правильна відповідь|Правильні відповіді):\s*/i, '')
        );
        if (rightText) correctAnswers.push(rightText);
        }

        const feedbackText = clean($block.find('.specificfeedback').text()).toLowerCase();
        const gradeMatch = clean($block.find('.grade').text()).match(/([\d,.]+)\s*з\s*([\d,.]+)/);
        const isFullScore = gradeMatch && parseFloat(gradeMatch[1].replace(',', '.')) >= parseFloat(gradeMatch[2].replace(',', '.'));

        const isCorrect = $block.hasClass('correct') ||
        isFullScore ||
        (feedbackText.includes('правильна') && !feedbackText.includes('неправильна'));

        const isWrong = $block.hasClass('incorrect') ||
        feedbackText.includes('неправильна');

        if (isCorrect && selectedAnswers.length && !correctAnswers.length) {
        correctAnswers = [...selectedAnswers];
        } else if (isWrong && selectedAnswers.length) {
        wrongAnswers.push(...selectedAnswers);
        }

        const fingerprint = makeHash(`${questionText}::${qMedia.join(',')}::${[...answers].sort().join('|')}`);
        const primaryKey = qid ? `qid:${qid}` : `fp:${fingerprint}`;

        results.push({
        key: primaryKey,
        qid,
        fingerprint,
        type: qType,
        question: questionText,
        media: qMedia,
        answers,
        correct_answers: correctAnswers,
        wrong_answers: wrongAnswers,
        user_selected: selectedAnswers
        });
    });

    return results;
}