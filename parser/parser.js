export async function universalMoodleParser() {
    const {
        clean,
        makeHash,
        extractQuestionId,
        extractMediaSignatures
    } = await import(chrome.runtime.getURL('shared/utils.js'));

    const $ = window.jQuery;

    const results = [];

    // Шукаємо всі елементи з класом .que (обєкт, в якому лежить питання + відповіді)
    $('.que').each((_, blockEl) => {
        const $block = $(blockEl);
        const $qtext = $block.find('.qtext');           // Текст питання
        const questionText = clean($qtext.text());      // Очищаємо його від лишнього 
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