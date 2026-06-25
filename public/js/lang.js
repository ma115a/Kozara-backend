document.addEventListener('DOMContentLoaded', () => {
    const currentPath = window.location.pathname;
    const langMatch = currentPath.match(/^\/(de|it|sr)(\/|$)/);
    const currentLang = langMatch ? langMatch[1] : 'en';

    const langLabels = {
        'en': '🇬🇧 EN',
        'sr': '🇷🇸 SR',
        'de': '🇩🇪 DE',
        'it': '🇮🇹 IT'
    };

    document.querySelectorAll('.nav-lang-btn span').forEach(span => {
        if (langLabels[currentLang]) {
            span.textContent = langLabels[currentLang];
        }
    });

    document.addEventListener('sl-select', event => {
        const item = event.detail.item;
        if (!item || !['en', 'sr', 'de', 'it'].includes(item.value)) return;

        const selectedLang = item.value;
        if (selectedLang === currentLang) return;

        let newPath = currentPath;
        const langRegex = /^\/(de|it|sr)(\/|$)/;

        if (langRegex.test(currentPath)) {
            newPath = currentPath.replace(langRegex, '/');
        }

        if (selectedLang !== 'en') {
            newPath = '/' + selectedLang + (newPath === '/' ? '' : newPath);
        }

        window.location.href = newPath;
    });
});
