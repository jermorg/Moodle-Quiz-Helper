(async function () {

    const {
        clean,
        makeHash,
        extractQuestionId,
        extractMediaSignatures
    } = await import(chrome.runtime.getURL('shared/utils.js'));

    const { findQuestionEntry, addQuestionsToDatabase } = await import(
        chrome.runtime.getURL('database/db.js')
    );

    const { pullFromServer, pushToServer } = await import(
        chrome.runtime.getURL('shared/sync.js')
    );

    const { universalMoodleParser } = await import(
        chrome.runtime.getURL('parser/parser.js')
    );

    const $ = window.jQuery;

    function showToast(text, isError = false) {
        const $toast = $('<div>')
            .text(text)
            .css({
                position: 'fixed',
                bottom: '18px',
                right: '18px',
                zIndex: 99999,
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '600',
                color: '#fff',
                background: isError ? '#dc2626' : '#16a34a',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                opacity: 0,
                transition: 'opacity 0.2s'
            })
            .appendTo('body');

        requestAnimationFrame(() => $toast.css('opacity', 1));
        setTimeout(() => $toast.fadeOut(300, () => $toast.remove()), 3500);
    }

    function clearHighlights() {
        $('.moodle-helper-mark')
            .css({ backgroundColor: '', border: '', borderRadius: '', padding: '', marginBottom: '' })
            .removeClass('moodle-helper-mark');

        $('.moodle-helper-badge, .moodle-helper-header-status, .moodle-helper-text-hint').remove();
        $('.que.gapselect select').css({ border: '', backgroundColor: '' });
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

    function renderHeaderStatus($block, hasCorrect, isDeduced, wrongCount, totalOptions) {
        const $infoBox = $block.find('.info');
        if (!$infoBox.length) return;

        const statusText = hasCorrect
            ? (isDeduced ? 'База: вирахувано' : 'База: є відповідь')
            : `База: виключено ${wrongCount} з ${totalOptions}`;

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

    async function highlightCourseTests() {
        const path = window.location.pathname;
        if (path.includes('/mod/quiz/attempt.php') || path.includes('/mod/quiz/review.php')) {
            return;
        }

        const { testsStats = {} } = await chrome.storage.local.get('testsStats');
        if (!Object.keys(testsStats).length) return;

        $('ul[data-for="cmlist"] li.activity.modtype_quiz, li.activity.quiz').each((_, liEl) => {
            const $li = $(liEl);
            if ($li.find('.moodle-helper-test-badge').length) return;

            const testId = String(
                $li.attr('data-id') ||
                ($li.attr('id') || '').replace('module-', '') ||
                ''
            );

            if (!testId || !testsStats[testId] || testsStats[testId].total === 0) return;

            const stats = testsStats[testId];
            const hasSolved = stats.solved > 0;
            const badgeText = hasSolved
                ? `У базі: ${stats.solved} правельних з ${stats.total}`
                : `У базі: ${stats.total} (без ✓)`;

            const $card = $li.find('.activity-item[data-region="activity-card"]').first();
            if ($card.length) {
                $card.css({
                    borderLeft: `4px solid ${hasSolved ? '#28a745' : '#ffc107'}`,
                    backgroundColor: hasSolved ? 'rgba(40, 167, 69, 0.07)' : 'rgba(255, 193, 7, 0.09)'
                });
            }

            const $badge = $('<span>')
                .addClass('moodle-helper-test-badge')
                .text(badgeText)
                .css({
                    display: 'inline-block',
                    marginLeft: '8px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: '600',
                    lineHeight: '1.3',
                    verticalAlign: 'middle',
                    backgroundColor: hasSolved ? '#d4edda' : '#fff3cd',
                    color: hasSolved ? '#155724' : '#856404',
                    border: `1px solid ${hasSolved ? '#28a745' : '#ffc107'}`
                });

            const $instanceName = $li.find('.activityname .instancename').first();
            if ($instanceName.length) {
                $instanceName.after($badge);
            } else {
                $li.find('.activityname').first().append($badge);
            }
        });
    }

    async function runBackgroundHighlight() {
        clearHighlights();

        const blocks = $('.que').get();
        for (const blockEl of blocks) {
            const $block = $(blockEl);
            const $qtext = $block.find('.qtext');
            const qMedia = extractMediaSignatures($qtext);
            const qid = extractQuestionId($block);
            const isGapSelect = $block.hasClass('gapselect');

            let questionText = '';
            if (isGapSelect) {
                const $qtextClone = $qtext.clone();
                $qtextClone.find('span.control').each((idx, el) => {
                    $(el).replaceWith(` [${idx + 1}] `);
                });
                questionText = clean($qtextClone.text());
            } else {
                questionText = clean($qtext.text());
            }

            if (!questionText && !qMedia.length) continue;

            const rowItems = [];
            const currentOptions = [];

            if (isGapSelect) {
                $qtext.find('select').each((idx, selEl) => {
                    const slotNum = idx + 1;
                    $(selEl).find('option').each((_, optEl) => {
                        const val = $(optEl).attr('value');
                        const txt = clean($(optEl).text());
                        if (val && val !== '0' && txt) {
                            currentOptions.push(`[${slotNum}] ${txt}`);
                        }
                    });
                });
            } else {
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
                        currentOptions.push(fullOption);
                    }
                });
            }

            const fingerprint = makeHash(`${questionText}::${qMedia.join(',')}::${[...currentOptions].sort().join('|')}`);

            const entry = await findQuestionEntry(qid, fingerprint);
            if (!entry) continue;

            const wrongList = entry.wrong_answers || [];
            let deducedCorrects = Array.isArray(entry.correct_answers) ? [...entry.correct_answers] : [];
            let isDeduced = false;

            if (!isGapSelect && !deducedCorrects.length && currentOptions.length > 1) {
                const remaining = currentOptions.filter(opt => !wrongList.includes(opt));
                if (remaining.length === 1) {
                    deducedCorrects = [remaining[0]];
                    isDeduced = true;
                }
            }

            if (!deducedCorrects.length && !wrongList.length) continue;

            renderHeaderStatus($block, deducedCorrects.length > 0, isDeduced, wrongList.length, currentOptions.length);

            if (isGapSelect) {
                if (deducedCorrects.length) {
                    $qtext.find('select').each((idx, selEl) => {
                        const prefix = `[${idx + 1}] `;
                        const match = deducedCorrects.find(c => c.startsWith(prefix));
                        if (match) {
                            $(selEl).css({ border: '2px solid #28a745', backgroundColor: '#d4edda' });
                        }
                    });
                }

                const $targetContainer = $block.find('.formulation').length ? $block.find('.formulation') : $qtext;
                const hintText = deducedCorrects.length
                    ? `Правильні пропуски: ${deducedCorrects.join(' | ')}`
                    : `Неправильні спроби: ${wrongList.join(' | ')}`;

                $('<div>')
                    .addClass('moodle-helper-text-hint')
                    .text(hintText)
                    .css({
                        marginTop: '10px',
                        padding: '8px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        background: deducedCorrects.length ? '#d4edda' : '#f8d7da',
                        border: `1px solid ${deducedCorrects.length ? '#28a745' : '#dc3545'}`,
                        color: deducedCorrects.length ? '#155724' : '#721c24'
                    })
                    .appendTo($targetContainer);

                continue;
            }

            $.each(rowItems, (_, { $row, optionText }) => {
                if (deducedCorrects.includes(optionText)) {
                    paintRow($row, '#d4edda', '#28a745', isDeduced ? 'Правильно (виключенням)' : 'Правильно');
                } else if (wrongList.includes(optionText)) {
                    paintRow($row, '#f8d7da', '#dc3545', 'Неправильно');
                }
            });

            if (!rowItems.length && (deducedCorrects.length || wrongList.length)) {
                const $answerBlock = $block.find('.answer').length ? $block.find('.answer') : $block.find('.formulation');
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
                            background: deducedCorrects.length ? '#d4edda' : '#f8d7da',
                            border: `1px solid ${deducedCorrects.length ? '#28a745' : '#dc3545'}`,
                            color: deducedCorrects.length ? '#155724' : '#721c24'
                        })
                        .appendTo($answerBlock);
                }
            }
        }
    }

    $(async function () {
        const path = window.location.pathname;

        await highlightCourseTests();

        // Підстраховка для секцій курсу, які Moodle підвантажує динамічно
        const regionMain = document.querySelector('#region-main');
        if (regionMain && !path.includes('/mod/quiz/')) {
            let timer = null;
            new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(highlightCourseTests, 200);
            }).observe(regionMain, { childList: true, subtree: true });
        }

        // Якщо ми на сторінці огляду результатів (review.php) — зберігаємо питання і прив'язуємо до тесту
        if (path.includes('/mod/quiz/review.php')) {
            try {
                const scraped = await universalMoodleParser();
                if (scraped.length > 0) {
                    await addQuestionsToDatabase(scraped);
                    const res = await pushToServer(scraped);
                    if (res) {
                        showToast(`Синхронізовано ${res.merged} питань (всього на сервері: ${res.total})`);
                    }
                }
            } catch (e) {
                console.warn('Auto-scrape/push error:', e);
                showToast(`Помилка автосинхронізації: ${e.message}`, true);
            }
        }

        await pullFromServer().catch(e => console.warn('Sync pull error:', e));
        await runBackgroundHighlight();
        await highlightCourseTests();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.quizDatabase) {
            runBackgroundHighlight();
        }
        if (area === 'local' && changes.testsStats) {
            $('.moodle-helper-test-badge').remove();
            highlightCourseTests();
        }
    });
})();