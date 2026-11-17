export const clean = (str) => (str || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[’`ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

export const makeHash = (str) => {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
};

export const extractQuestionId = ($block) => {
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

export const extractMediaSignatures = ($container) => {
    if (!$container.length) return [];
    return $container.find('img, audio, video, source').map((_, el) => {
        const src = ($(el).attr('src') || '').split('?')[0];
        if (!src) return '';

        // Витягуємо стабільний ID запису (/question/answer/<qubaid>/<slot>/<answer_id>/file.png
        // або /question/questiontext/<qubaid>/<slot>/<qid>/file.png)
        const moodleMatch = src.match(/\/question\/(?:answer|questiontext)\/\d+\/\d+\/(\d+)\/([^/]+)$/);
        if (moodleMatch) {
            return `${moodleMatch[1]}/${moodleMatch[2]}`;
        }
        
        return src.split('/').pop() || '';
    }).get().filter(Boolean);
};