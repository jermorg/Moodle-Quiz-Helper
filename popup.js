$(function () {
    const $jsonInput = $('#jsonInput');
    const $dbStatus = $('#dbStatus');
    const $parseStatus = $('#parseStatus');
    const $parseOutput = $('#parseOutput');
    const $copyBtn = $('#copyBtn');

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

    

    });
