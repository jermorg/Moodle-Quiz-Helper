$(function () {
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

    function extractQuestionId($block) {
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
    }

    function extractMediaSignatures($container) {
        if (!$container.length) return [];
        return $container.find('img, audio, video, source').map((_, el) => {
            return ($(el).attr('src') || '').split('/').pop()?.split('?')[0] || '';
        }).get().filter(Boolean);
    }

    function clearHighlights() {
        $('.moodle-helper-mark')
            .css({ backgroundColor: '', border: '', borderRadius: '', padding: '', marginBottom: '' })
            .removeClass('moodle-helper-mark');

        $('.moodle-helper-badge, .moodle-helper-header-status, .moodle-helper-text-hint').remove();
    }

    function paintRow($row, bgColor, borderColor, labelText) {
        $row
        .addClass('moodle-helper-mark')
        .css({
            backgroundColor: bgColor,
            border: `2px solid ${borderColor}`,
            borderRadius: '6px',
            padding: '6px 10px',
            marginBottom: '6px'
        });

        const $badge = $('<span>')
        .addClass('moodle-helper-badge')
        .text(labelText)
        .css({
            display: 'inline-block',
            marginLeft: '8px',
            padding: '2px 6px',
            fontSize: '11px',
            fontWeight: 'bold',
            color: '#fff',
            background: borderColor,
            borderRadius: '4px',
            verticalAlign: 'middle'
        });

        const $target = $row.find('.d-flex').length ? $row.find('.d-flex').first() : $row;
        $target.append($badge);
    }

    async function runBackgroundHighlight() {
        const { quizDatabase } = await chrome.storage.local.get(['quizDatabase']);
        clearHighlights();

        if (!quizDatabase || !Object.keys(quizDatabase).length) return;

        $('.que').each((_, blockEl) => {
        const $block = $(blockEl);
        const $qtext = $block.find('.qtext');
        const questionText = clean($qtext.text());
        const qMedia = extractMediaSignatures($qtext);
        const qid = extractQuestionId($block);

        const rowItems = [];

        $block.find('.answer > div, .answer tr').each((_, rowEl) => {
            const $row = $(rowEl);
            if (!$row.find('input[type="radio"], input[type="checkbox"]').length) return;

            const $textEl = $row.find('.flex-fill').length
            ? $row.find('.flex-fill')
            : ($row.find('label').length ? $row.find('label') : $row);

            const rawText = clean($textEl.text()).replace(/^([0-9]+|[a-zа-яіїєґ])[.)]\s*/i, '');
            const ansMedia = extractMediaSignatures($row);
            const fullOption = [rawText, ...ansMedia.map(m => `[img:${m}]`)].filter(Boolean).join(' ');

            if (fullOption) {
            rowItems.push({ $row, optionText: fullOption });
            }
        });

        const currentOptions = rowItems.map(i => i.optionText);
        const fingerprint = makeHash(`${questionText}::${qMedia.join(',')}::${[...currentOptions].sort().join('|')}`);

        // Пошук у базі: спочатку за qid, потім за точним fingerprint
        let entry = qid ? quizDatabase[`qid:${qid}`] : null;
        if (!entry) {
            entry = quizDatabase[`fp:${fingerprint}`];
        }
        if (!entry) return;

        const wrongList = entry.wrong_answers || [];
        let deducedCorrects = Array.isArray(entry.correct_answers) ? [...entry.correct_answers] : [];
        let isDeduced = false;

        // Метод виключення
        if (!deducedCorrects.length && currentOptions.length > 1) {
            const remaining = currentOptions.filter(opt => !wrongList.includes(opt));
            if (remaining.length === 1) {
            deducedCorrects = [remaining[0]];
            isDeduced = true;
            }
        }

        if (!deducedCorrects.length && !wrongList.length) return;

        // Статусний бейдж у лівій колонці (.info)
        const $infoBox = $block.find('.info');
        if ($infoBox.length) {
            const hasCorrect = deducedCorrects.length > 0;
            const statusText = hasCorrect
            ? (isDeduced ? 'База: вирахувано' : 'База: є відповідь')
            : `База: виключено ${wrongList.length} з ${currentOptions.length}`;

            $('<div>')
            .addClass('moodle-helper-header-status')
            .text(statusText)
            .css({
                marginTop: '8px',
                padding: '4px 6px',
                fontSize: '11px',
                fontWeight: '600',
                borderRadius: '4px',
                background: hasCorrect ? '#d4edda' : '#fff3cd',
                color: hasCorrect ? '#155724' : '#856404',
                border: `1px solid ${hasCorrect ? '#c3e6cb' : '#ffeeba'}`
            })
            .appendTo($infoBox);
        }

        // Підсвічування варіантів вибору (radio / checkbox)
        $.each(rowItems, (_, { $row, optionText }) => {
            if (deducedCorrects.includes(optionText)) {
            paintRow($row, '#d4edda', '#28a745', isDeduced ? 'Правильно (виключенням)' : 'Правильно');
            } else if (wrongList.includes(optionText)) {
            paintRow($row, '#f8d7da', '#dc3545', 'Неправильно');
            }
        });

        // Підказка для текстових полів або випадаючих списків
        if (!rowItems.length && (deducedCorrects.length || wrongList.length)) {
            const $answerBlock = $block.find('.answer');
            if ($answerBlock.length) {
            const hintText = deducedCorrects.length
                ? `Правильна відповідь: ${deducedCorrects.join(' | ')}`
                : `Неправильні спроби: ${wrongList.join(' | ')}`;

            $('<div>')
                .addClass('moodle-helper-text-hint')
                .text(hintText)
                .css({
                marginTop: '8px',
                padding: '8px',
                borderRadius: '6px',
                fontSize: '12px',
                background: '#d4edda',
                border: '1px solid #28a745',
                color: '#155724'
                })
                .appendTo($answerBlock);
            }
        }
        });
    }

    // 1. Автоматичний запуск при відкритті сторінки тесту
    runBackgroundHighlight();

    // 2. Миттєве оновлення при зміні бази в іншому вікні/popup
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.quizDatabase) {
        runBackgroundHighlight();
        }
    });
});