const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Path to the unified dataset CSV
const CSV_PATH = path.join(__dirname, '../../../csv/unified_exam_dataset.csv');

// Known sections in the CSV (normalised for matching)
const KNOWN_SECTIONS = [
    'AI & ML',
    'DevOps Engineer',
    'React Engineer',
    'SAP Engineer',
    'Numerical Ability',
    'Logical Reasoning',
    'Verbal Ability',
    'Computer Science',
    'Quantitative Aptitude',
];

// Keywords to map common freeform inputs -> CSV section names
const SECTION_KEYWORDS = {
    'AI & ML': ['ai', 'ml', 'machine learning', 'deep learning', 'artificial intelligence', 'nlp', 'neural', 'data science', 'python'],
    'DevOps Engineer': ['devops', 'docker', 'kubernetes', 'k8s', 'ci/cd', 'jenkins', 'git', 'linux', 'cloud', 'aws', 'azure', 'gcp', 'terraform', 'ansible'],
    'React Engineer': ['react', 'jsx', 'redux', 'hooks', 'frontend', 'front-end', 'javascript', 'typescript', 'nextjs', 'next.js', 'vue', 'angular'],
    'SAP Engineer': ['sap', 'abap', 'hana', 'fiori', 'erp', 'basis', 'fi', 'co', 'mm', 'sd'],
    'Numerical Ability': ['numerical', 'number', 'arithmetic', 'percentage', 'profit', 'loss', 'interest', 'ratio', 'algebra', 'speed', 'time', 'work'],
    'Logical Reasoning': ['logical', 'reasoning', 'coding-decoding', 'blood relation', 'seating', 'direction', 'puzzle', 'venn', 'syllogism'],
    'Verbal Ability': ['verbal', 'vocabulary', 'grammar', 'comprehension', 'idiom', 'sentence', 'word', 'fill in'],
    'Computer Science': ['computer science', 'cse', 'data structure', 'algorithm', 'os', 'networking', 'dbms', 'database', 'oops', 'oop'],
    'Quantitative Aptitude': ['quantitative', 'aptitude', 'quant', 'probability', 'permutation', 'combination', 'mensuration', 'logarithm'],
};

/**
 * Matches a freeform category string to the closest known CSV section.
 * Returns null if no match found (unknown topic).
 */
function matchSection(input) {
    if (!input) return null;

    const lower = input.toLowerCase().trim();

    // 1. Exact match first (case-insensitive)
    const exact = KNOWN_SECTIONS.find(s => s.toLowerCase() === lower);
    if (exact) return exact;

    // 2. Keyword-based match
    for (const [section, keywords] of Object.entries(SECTION_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) {
            return section;
        }
    }

    // 3. Partial match against section names
    const partial = KNOWN_SECTIONS.find(s => lower.includes(s.toLowerCase()) || s.toLowerCase().includes(lower));
    if (partial) return partial;

    return null; // No match — fallback to AI-only generation
}

/**
 * Reads the CSV and returns `count` random samples from the given section.
 * Returns empty array if no samples found for the section.
 */
function getSamplesBySection(section, count = 5) {
    try {
        if (!fs.existsSync(CSV_PATH)) {
            console.warn('[csvSearch] CSV file not found at:', CSV_PATH);
            return [];
        }

        const raw = fs.readFileSync(CSV_PATH, 'utf-8');
        const rows = parse(raw, {
            columns: true,
            skip_empty_lines: true,
            relax_quotes: true,
        });

        // Filter by section
        const filtered = rows.filter(row =>
            row.section && row.section.trim().toLowerCase() === section.toLowerCase()
        );

        if (filtered.length === 0) return [];

        // Shuffle and return `count` samples
        const shuffled = filtered.sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count).map(row => ({
            question: row.question,
            a: row.a,
            b: row.b,
            c: row.c,
            d: row.d,
            answer: row.answer,
            difficulty: row.difficulty,
            topic: row.topic,
        }));
    } catch (err) {
        console.error('[csvSearch] Error reading CSV:', err.message);
        return [];
    }
}

module.exports = { matchSection, getSamplesBySection };
