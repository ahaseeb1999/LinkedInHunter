/**
 * Auto-expand a user-supplied keyword into multiple search variants.
 *
 * Real human researchers don't just type one query — they try synonyms,
 * abbreviations, and intent variations. This module mimics that behavior
 * programmatically.
 */

// Hand-curated synonyms for common tech / business roles.
// Conservative — only includes well-established equivalents.
const SYNONYMS = {
  // Mobile dev
  'react native':   ['rn developer', 'mobile developer (react native)', 'cross-platform developer'],
  'rn':             ['react native'],
  'flutter':        ['flutter developer', 'flutter engineer', 'dart developer'],
  'ios':            ['ios developer', 'ios engineer', 'swift developer'],
  'android':        ['android developer', 'android engineer', 'kotlin developer'],
  // Frontend
  'react':          ['react developer', 'reactjs developer', 'frontend developer (react)'],
  'angular':        ['angular developer', 'angular engineer'],
  'vue':            ['vue developer', 'vuejs developer'],
  'frontend':       ['front-end developer', 'ui developer', 'web developer'],
  // Backend
  'backend':        ['back-end developer', 'server developer'],
  'node':           ['nodejs developer', 'node.js developer', 'backend developer (node)'],
  'python':         ['python developer', 'python engineer'],
  'java':           ['java developer', 'java engineer'],
  'go':             ['golang developer', 'go engineer'],
  // Data
  'data scientist': ['data science', 'ml engineer', 'machine learning engineer'],
  'ml':             ['machine learning', 'ai engineer', 'ml engineer'],
  // Other
  'devops':         ['site reliability engineer', 'sre', 'platform engineer', 'cloud engineer'],
  'qa':             ['quality assurance', 'qa engineer', 'test engineer', 'sdet'],
  'product':        ['product manager', 'pm'],
  'designer':       ['ui designer', 'ux designer', 'product designer'],
}

// Intent prefixes/suffixes — combinations that humans commonly try
const INTENT_VARIANTS = [
  '{kw}',                    // bare
  '{kw} hiring',
  'hiring {kw}',
  '{kw} developer',
  '{kw} engineer',
  '{kw} remote',
  'looking for {kw}',
]

function normalize(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Expand a single keyword into N variants.
 *
 * @param {string} keyword - user input, e.g. "React Native"
 * @param {object} opts
 *   maxVariants: hard cap (default 5)
 *   includeIntent: also add "hiring X", "looking for X" variants (default true)
 *   includeSynonyms: pull from synonym table (default true)
 *
 * @returns {string[]} ordered list, original first, then alternatives
 */
function expandKeyword(keyword, { maxVariants = 5, includeIntent = true, includeSynonyms = true } = {}) {
  const norm = normalize(keyword)
  if (!norm) return []

  const out = new Set([keyword.trim()])

  // 1. Synonym lookup — match against keys, case-insensitive
  if (includeSynonyms) {
    for (const [key, alts] of Object.entries(SYNONYMS)) {
      if (norm === key || norm.includes(key)) {
        alts.forEach(a => out.add(a))
        if (out.size >= maxVariants) break
      }
    }
  }

  // 2. Intent variants — only for short keywords (don't suffix long phrases)
  if (includeIntent && norm.split(' ').length <= 4) {
    for (const tmpl of INTENT_VARIANTS) {
      if (out.size >= maxVariants) break
      const v = tmpl.replace('{kw}', norm).trim()
      if (v && v !== norm) out.add(v)
    }
  }

  return Array.from(out).slice(0, maxVariants)
}

/**
 * Expand multiple keywords, dedup the union.
 */
function expandKeywords(keywords, opts = {}) {
  const all = new Set()
  for (const kw of (keywords || [])) {
    expandKeyword(kw, opts).forEach(v => all.add(v))
  }
  return Array.from(all)
}

module.exports = { expandKeyword, expandKeywords, SYNONYMS, INTENT_VARIANTS }
