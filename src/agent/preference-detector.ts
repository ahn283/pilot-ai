import { readUserMemory, appendUserMemory } from './memory.js';

/**
 * Patterns that indicate user preferences expressed in commands.
 * Each pattern has a regex to match and an extractor to produce a memory entry.
 */
const PREFERENCE_PATTERNS: Array<{
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => string;
}> = [
  {
    pattern: /(?:항상|always)\s+(.+?)(?:로|으로|해줘|해|하자|please)/i,
    extract: (m) => m[1].trim(),
  },
  {
    pattern: /(?:앞으로|from now on)\s+(.+?)(?:해줘|해|하자|please)?$/i,
    extract: (m) => m[1].trim(),
  },
  {
    pattern: /(?:커밋\s*메시지|commit\s*message).*(?:한국어|korean|영어|english)/i,
    extract: (m) => m[0].trim(),
  },
  {
    pattern: /(?:PR|pull request).*(?:항상|always)\s+(.+)/i,
    extract: (m) => `PR: ${m[1].trim()}`,
  },
  {
    pattern: /(?:테스트|test).*(?:항상|always|반드시|must)\s+(.+)/i,
    extract: (m) => `Test: ${m[1].trim()}`,
  },
];

/**
 * Detects user preferences from a message and saves them to MEMORY.md.
 * Returns the detected preference string if found, null otherwise.
 */
export async function detectAndSavePreference(text: string): Promise<string | null> {
  for (const { pattern, extract } of PREFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const preference = extract(match);
      if (!preference || preference.length < 3) continue;

      // Check for duplicates
      const existing = await readUserMemory();
      if (existing.includes(preference)) {
        return null;
      }

      await appendUserMemory(`- ${preference}`);
      return preference;
    }
  }
  return null;
}
