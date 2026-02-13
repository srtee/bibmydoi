const doiInput = document.getElementById('doiInput');
const fetchBtn = document.getElementById('fetchBtn');
const output = document.getElementById('output');
const error = document.getElementById('error');
const articleInfo = document.getElementById('articleInfo');
const infoTitle = document.getElementById('infoTitle');
const infoAuthors = document.getElementById('infoAuthors');
const infoJournal = document.getElementById('infoJournal');
const infoDate = document.getElementById('infoDate');
const infoAbstract = document.getElementById('infoAbstract');

function extractDOI(input) {
    // DOI regex pattern: 10.xxxx/yyyyyyy where xxxx is 4-9 digits and yyyyyyy can include various characters
    const doiRegex = /(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;
    const match = input.match(doiRegex);
    return match ? match[1] : null;
}

async function fetchAbstractFromCrossref(doi) {
    try {
        const response = await fetch(
            `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        // Crossref stores abstract in message.items[0].abstract
        if (data.message && data.message.items && data.message.items[0]) {
            return data.message.items[0].abstract || null;
        }
        return null;
    } catch (err) {
        return null;
    }
}

async function fetchAbstract(doi) {
    try {
        const response = await fetch(
            `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=abstract`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        return data.abstract || null;
    } catch (err) {
        return null;
    }
}

function parseBibTeX(bibtex) {
    const result = {
        title: '',
        author: '',
        journal: '',
        year: '',
        month: '',
        volume: '',
        number: '',
        pages: ''
    };

    // Match field = "value" or field = {value}
    const fieldRegex = /(\w+)\s*=\s*(?:\{([^}]*)\}|"([^"]*)")/g;
    let match;

    while ((match = fieldRegex.exec(bibtex)) !== null) {
        const field = match[1].toLowerCase();
        const value = match[2] || match[3];

        if (result.hasOwnProperty(field)) {
            result[field] = value;
        }
    }

    return result;
}

function updateArticleInfo(bibtex) {
    const parsed = parseBibTeX(bibtex);

    if (parsed.title) {
        infoTitle.textContent = parsed.title.replace(/\{\}/g, '');
    }

    if (parsed.author) {
        // Format authors: "Last, First and Last, First" -> "First Last, First Last"
        const authors = parsed.author
            .replace(/\{\}/g, '')
            .split(' and ')
            .map(author => {
                const [last, ...firstParts] = author.trim().split(',');
                if (firstParts.length > 0) {
                    return firstParts.join(',').trim() + ' ' + last.trim();
                }
                return author.trim();
            })
            .join(', ');
        infoAuthors.textContent = authors;
    }

    if (parsed.journal) {
        let journalDetails = parsed.journal.replace(/\{\}/g, '');
        if (parsed.volume) journalDetails += `, vol. ${parsed.volume}`;
        if (parsed.number) journalDetails += `, no. ${parsed.number}`;
        if (parsed.pages) journalDetails += `, pp. ${parsed.pages}`;
        infoJournal.textContent = journalDetails;
    }

    if (parsed.year || parsed.month) {
        const dateParts = [];
        if (parsed.month) dateParts.push(parsed.month);
        if (parsed.year) dateParts.push(parsed.year);
        infoDate.textContent = dateParts.join(' ');
    }

    infoAbstract.textContent = '';
    articleInfo.classList.add('visible');
}

let fetchCooldownTimeout;
let countdownInterval;

function startCooldown() {
    let remainingSeconds = 10;
    fetchBtn.disabled = true;
    fetchBtn.classList.add('cooldown');
    fetchBtn.textContent = `Wait ${remainingSeconds}s`;

    countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
            clearInterval(countdownInterval);
            fetchBtn.disabled = false;
            fetchBtn.classList.remove('cooldown');
            fetchBtn.textContent = 'Get BibTeX';
        } else {
            fetchBtn.textContent = `Wait ${remainingSeconds}s`;
        }
    }, 1000);
}

async function fetchBibTeX() {
    const input = doiInput.value.trim();
    error.textContent = '';
    output.value = '';
    articleInfo.classList.remove('visible');
    infoTitle.textContent = '';
    infoAuthors.textContent = '';
    infoJournal.textContent = '';
    infoDate.textContent = '';

    if (!input) {
        error.textContent = 'Please enter a DOI';
        return;
    }

    const doi = extractDOI(input);
    if (!doi) {
        error.textContent = 'No valid DOI found in input';
        return;
    }
    infoAbstract.textContent = '';

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching...';

    try {
        const response = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
            headers: {
                'Accept': 'application/x-bibtex'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch BibTeX: ${response.status}`);
        }

        const bibtex = await response.text();
        output.value = bibtex;
        updateArticleInfo(bibtex);

        // Fetch abstract from Semantic Scholar API, fall back to Crossref API
        let abstract = await fetchAbstract(doi);
        if (!abstract) {
            // Try Crossref API as fallback
            abstract = await fetchAbstractFromCrossref(doi);
        }
        if (abstract) {
            infoAbstract.textContent = abstract;
        } else {
            infoAbstract.textContent = "Abstract couldn't be found on Semantic Scholar or Crossref";
        }

        // Start 10-second cooldown after successful fetch
        startCooldown();
    } catch (err) {
        error.textContent = err.message;
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Get BibTeX';
    }
}

fetchBtn.addEventListener('click', fetchBibTeX);

doiInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        fetchBibTeX();
    }
});

const copyBtn = document.getElementById('copyBtn');
const copyStatus = document.getElementById('copyStatus');
const copyText = document.querySelector('.copy-text');
let copyTimeout;

copyBtn.addEventListener('click', async () => {
    const bibtexText = output.value;

    if (!bibtexText) {
        copyStatus.textContent = 'Nothing to copy';
        return;
    }

    try {
        await navigator.clipboard.writeText(bibtexText);
        copyText.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        copyBtn.setAttribute('aria-label', 'Copied to clipboard');
        copyStatus.textContent = 'BibTeX copied to clipboard';

        clearTimeout(copyTimeout);
        copyTimeout = setTimeout(() => {
            copyText.textContent = 'Copy';
            copyBtn.classList.remove('copied');
            copyBtn.setAttribute('aria-label', 'Copy BibTeX to clipboard');
        }, 2000);
    } catch (err) {
        copyStatus.textContent = 'Failed to copy to clipboard';
        copyText.textContent = 'Failed';
    }
});

// Dark mode toggle functionality
const themeToggle = document.getElementById('themeToggle');
const sunIcon = document.querySelector('.sun-icon');
const moonIcon = document.querySelector('.moon-icon');
const THEME_KEY = 'theme';

function updateThemeIcons(isDark) {
    if (isDark) {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
    } else {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
    }
}

function getSystemPreference() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getStoredTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark') return 'dark';
    if (stored === 'light') return 'light';
    return null; // No stored preference
}

function setTheme(theme) {
    const isDark = theme === 'dark';
    if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem(THEME_KEY, theme);
    updateThemeIcons(isDark);
}

function initTheme() {
    const storedTheme = getStoredTheme();
    if (storedTheme) {
        setTheme(storedTheme);
    } else {
        // Use system preference as default
        const isDark = getSystemPreference();
        setTheme(isDark ? 'dark' : 'light');
        // Don't save the initial system preference to localStorage
        // so changes to system preference are respected
        localStorage.removeItem(THEME_KEY);
    }
}

themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
});

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only update if user hasn't manually set a preference
    if (!localStorage.getItem(THEME_KEY)) {
        setTheme(e.matches ? 'dark' : 'light');
    }
});

// Initialize theme on page load
initTheme();