(async function () {

    const {
        clean,
        makeHash,
        extractTestId,
        extractQuestionId,
        extractMediaSignatures
    } = await import(chrome.runtime.getURL('shared/utils.js'));

    const { getDatabase, lookupQuestion, addQuestionsToDatabase } = await import(
        chrome.runtime.getURL('database/db.js')
    );

    const { pullFromServer, pushToServer } = await import(
        chrome.runtime.getURL('shared/sync.js')
    );

    const { universalMoodleParser } = await import(
        chrome.runtime.getURL('parser/parser.js')
    );

    const $ = window.jQuery;
    const PERSONAL_TESTS_KEY = 'personalCompletedTests';

    async function getFeatureFlags() {
        const { hintsEnabled = true, showPassedTests = true } = await chrome.storage.local.get({
            hintsEnabled: true,
            showPassedTests: true
        });
        return {
            hintsEnabled: Boolean(hintsEnabled),
            showPassedTests: Boolean(showPassedTests)
        };
    }

    function formatScore(num) {
        if (num === null || num === undefined || Number.isNaN(num)) return '';
        return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
    }

    function parseScorePair(text) {
        const cleaned = clean(text);
        const match = cleaned.match(/([\d,.]+)\s*(?:з|\/|out of)\s*([\d,.]+)/i);
        if (!match) return null;

        const earned = parseFloat(match[1].replace(',', '.'));
        const max = parseFloat(match[2].replace(',', '.'));
        if (Number.isNaN(earned) || Number.isNaN(max) || max <= 0) return null;

        return { earned, max };
    }

    async function savePersonalTestResult(testId, scoreObj) {
        if (!testId) return;

        const data = await chrome.storage.local.get(PERSONAL_TESTS_KEY);
        const map = data[PERSONAL_TESTS_KEY] || {};
        const prev = map[testId];

        const nextEarned = scoreObj ? scoreObj.earned : (prev?.earned ?? null);
        const nextMax = scoreObj ? scoreObj.max : (prev?.max ?? null);

        if (prev && prev.earned !== null && nextEarned !== null && prev.earned > nextEarned) {
            return;
        }

        map[testId] = {
            earned: nextEarned,
            max: nextMax,
            updatedAt: Date.now()
        };

        await chrome.storage.local.set({ [PERSONAL_TESTS_KEY]: map });
    }

    function collectPersonalScoreFromPage() {
        const path = window.location.pathname;
        const testId = extractTestId();
        if (!testId) return;

        if (path.includes('/mod/quiz/review.php')) {
            let foundScore = null;

            $('table.quizreviewsummary tr').each((_, tr) => {
                const label = clean($(tr).find('th').text()).toLowerCase();
                if (label.includes('оцінка') || label.includes('бали') || label.includes('grade') || label.includes('mark')) {
                    const parsed = parseScorePair($(tr).find('td').text());
                    if (parsed) {
                        foundScore = parsed;
                        return false;
                    }
                }
            });

            savePersonalTestResult(testId, foundScore);
            return;
        }

        if (path.includes('/mod/quiz/view.php')) {
            let bestScore = null;

            const feedbackText = clean($('#feedback').text());
            const feedbackScore = parseScorePair(feedbackText);
            if (feedbackScore) {
                bestScore = feedbackScore;
            }

            if (!bestScore) {
                $('table.quizattemptsummary tbody tr').each((_, tr) => {
                    const rowText = clean($(tr).text());
                    const parsed = parseScorePair(rowText);
                    if (parsed && (!bestScore || parsed.earned > bestScore.earned)) {
                        bestScore = parsed;
                    }
                });
            }

            if (bestScore || $('table.quizattemptsummary tbody tr').length > 0) {
                savePersonalTestResult(testId, bestScore);
            }
        }
    }

    function showToast(text, isError = false) {
        const $toast = $('<div>')
            .addClass(`moodle-helper-toast ${isError ? 'is-error' : ''}`)
            .text(text)
            .appendTo('body');

        requestAnimationFrame(() => $toast.addClass('is-visible'));
        setTimeout(() => {
            $toast.removeClass('is-visible');
            setTimeout(() => $toast.remove(), 250);
        }, 3500);
    }

    function clearHighlights() {
        $('.moodle-helper-mark').removeClass('moodle-helper-mark is-correct is-wrong');
        $('.moodle-helper-badge, .moodle-helper-header-status, .moodle-helper-text-hint').remove();
        $('.que.gapselect select').removeClass('moodle-helper-select-correct');
    }

    function clearCourseTestBadges() {
        $('.moodle-helper-test-badge, .moodle-helper-personal-badge').remove();
        $('.moodle-helper-test-card').removeClass('moodle-helper-test-card is-solved is-partial');
    }

    function paintRow($row, rowStateClass, badgeStateClass, labelText) {
        $row.addClass(`moodle-helper-mark ${rowStateClass}`);

        const $badge = $('<span>')
            .addClass(`moodle-helper-badge ${badgeStateClass}`)
            .text(labelText);

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
            .addClass(`moodle-helper-header-status ${hasCorrect ? 'has-correct' : 'is-partial'}`)
            .text(statusText)
            .appendTo($infoBox);
    }

    async function highlightCourseTests() {
        const path = window.location.pathname;
        if (path.includes('/mod/quiz/attempt.php') || path.includes('/mod/quiz/review.php')) {
            return;
        }

        const { hintsEnabled, showPassedTests } = await getFeatureFlags();
        if (!hintsEnabled && !showPassedTests) {
            clearCourseTestBadges();
            return;
        }

        const storage = await chrome.storage.local.get(['testsStats', PERSONAL_TESTS_KEY]);
        const testsStats = hintsEnabled ? (storage.testsStats || {}) : {};
        const personalTests = showPassedTests ? (storage[PERSONAL_TESTS_KEY] || {}) : {};

        $('ul[data-for="cmlist"] li.activity.modtype_quiz, li.activity.quiz').each((_, liEl) => {
            const $li = $(liEl);
            const testId = String(
                $li.attr('data-id') ||
                ($li.attr('id') || '').replace('module-', '') ||
                ''
            );
            if (!testId) return;

            const $instanceName = $li.find('.activityname .instancename').first();
            const $anchor = $instanceName.length ? $instanceName : $li.find('.activityname').first();

            if (showPassedTests && personalTests[testId] && !$li.find('.moodle-helper-personal-badge').length) {
                const pInfo = personalTests[testId];
                const hasScore = pInfo.earned !== null && pInfo.max !== null;
                const label = hasScore
                    ? `✓ ${formatScore(pInfo.earned)}/${formatScore(pInfo.max)}`
                    : '✓ Пройдено';

                const $personalBadge = $('<span>')
                    .addClass('moodle-helper-personal-badge')
                    .attr('title', hasScore ? `Ваш найкращий результат: ${formatScore(pInfo.earned)} з ${formatScore(pInfo.max)}` : 'Ви вже проходили цей тест')
                    .text(label);

                if ($instanceName.length) {
                    $instanceName.after($personalBadge);
                } else {
                    $anchor.append($personalBadge);
                }
            }

            if (hintsEnabled && testsStats[testId] && testsStats[testId].total > 0 && !$li.find('.moodle-helper-test-badge').length) {
                const stats = testsStats[testId];
                const hasSolved = stats.solved > 0;
                const stateClass = hasSolved ? 'is-solved' : 'is-partial';
                const badgeText = hasSolved
                    ? `${stats.solved} / ${stats.total} правильних`
                    : `${stats.total} у базі • без ✓`;

                const $card = $li.find('.activity-item[data-region="activity-card"]').first();
                if ($card.length) {
                    $card.addClass(`moodle-helper-test-card ${stateClass}`);
                }

                const $badge = $('<span>')
                    .addClass(`moodle-helper-test-badge ${stateClass}`)
                    .text(badgeText);

                if ($instanceName.length) {
                    $instanceName.after($badge);
                } else {
                    $anchor.append($badge);
                }
            }
        });
    }

    async function runBackgroundHighlight() {
        clearHighlights();

        const { hintsEnabled } = await getFeatureFlags();
        if (!hintsEnabled) return;

        const blocks = $('.que').get();
        if (!blocks.length) return;

        const db = await getDatabase();
        if (!Object.keys(db).length) return;

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

            const entry = lookupQuestion(db, qid, fingerprint);
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
                            $(selEl).addClass('moodle-helper-select-correct');
                        }
                    });
                }

                const $targetContainer = $block.find('.formulation').length ? $block.find('.formulation') : $qtext;
                const hintText = deducedCorrects.length
                    ? `Правильні пропуски: ${deducedCorrects.join(' | ')}`
                    : `Неправильні спроби: ${wrongList.join(' | ')}`;

                $('<div>')
                    .addClass(`moodle-helper-text-hint ${deducedCorrects.length ? 'is-correct' : 'is-wrong'}`)
                    .text(hintText)
                    .appendTo($targetContainer);

                continue;
            }

            $.each(rowItems, (_, { $row, optionText }) => {
                if (deducedCorrects.includes(optionText)) {
                    paintRow(
                        $row,
                        'is-correct',
                        isDeduced ? 'is-deduced' : 'is-correct',
                        isDeduced ? '✓ Виключенням' : '✓ Правильно'
                    );
                } else if (wrongList.includes(optionText)) {
                    paintRow($row, 'is-wrong', 'is-wrong', '✕ Неправильно');
                }
            });

            if (!rowItems.length && (deducedCorrects.length || wrongList.length)) {
                const $answerBlock = $block.find('.answer').length ? $block.find('.answer') : $block.find('.formulation');
                if ($answerBlock.length) {
                    const hintText = deducedCorrects.length
                        ? `Правильна відповідь: ${deducedCorrects.join(' | ')}`
                        : `Неправильні спроби: ${wrongList.join(' | ')}`;

                    $('<div>')
                        .addClass(`moodle-helper-text-hint ${deducedCorrects.length ? 'is-correct' : 'is-wrong'}`)
                        .text(hintText)
                        .appendTo($answerBlock);
                }
            }
        }
    }

    $(async function () {
        const path = window.location.pathname;

        collectPersonalScoreFromPage();
        await highlightCourseTests();

        const regionMain = document.querySelector('#region-main');
        if (regionMain && !path.includes('/mod/quiz/')) {
            let timer = null;
            new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(highlightCourseTests, 200);
            }).observe(regionMain, { childList: true, subtree: true });
        }

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
        if (area !== 'local') return;

        if (changes.hintsEnabled || changes.showPassedTests) {
            runBackgroundHighlight();
            clearCourseTestBadges();
            highlightCourseTests();
            return;
        }

        if (changes.quizDatabase) {
            runBackgroundHighlight();
        }
        if (changes.testsStats || changes[PERSONAL_TESTS_KEY]) {
            clearCourseTestBadges();
            highlightCourseTests();
        }
    });
})();