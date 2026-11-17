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
                return false;
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
        $('.moodle-helper-mark').removeClass('moodle-helper-mark is-correct is-wrong');
        $('.moodle-helper-badge, .moodle-helper-header-status, .moodle-helper-text-hint').remove();
    }

    function paintRow($row, stateClass, labelText) {
        $row.addClass(`moodle-helper-mark ${stateClass}`);

        const $badge = $('<span>')
            .addClass(`moodle-helper-badge ${stateClass}`)
            .text(labelText);

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

            let entry = qid ? quizDatabase[`qid:${qid}`] : null;
            if (!entry) {
                entry = quizDatabase[`fp:${fingerprint}`];
            }
            if (!entry) return;

            const wrongList = entry.wrong_answers || [];
            let deducedCorrects = Array.isArray(entry.correct_answers) ? [...entry.correct_answers] : [];
            let isDeduced = false;

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
                    .addClass(`moodle-helper-header-status ${hasCorrect ? 'has-correct' : 'is-partial'}`)
                    .text(statusText)
                    .appendTo($infoBox);
            }

            // Підсвічування варіантів вибору (radio / checkbox)
            $.each(rowItems, (_, { $row, optionText }) => {
                if (deducedCorrects.includes(optionText)) {
                    paintRow($row, 'is-correct', isDeduced ? 'Виключенням' : 'Правильно');
                } else if (wrongList.includes(optionText)) {
                    paintRow($row, 'is-wrong', 'Неправильно');
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
                        .appendTo($answerBlock);
                }
            }
        });
    }

    runBackgroundHighlight();

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.quizDatabase) {
            runBackgroundHighlight();
        }
    });
});