/**
 * Message splitting utility for messenger adapters.
 * Handles platform-specific message length limits and preserves
 * code block formatting across split boundaries.
 */

/** Platform message character limits */
export const MAX_MESSAGE_LENGTH = {
  slack: 4000,
  telegram: 4096,
} as const;

/**
 * Splits a long message into chunks that fit within the given character limit.
 * Preserves code blocks (```) across split boundaries by closing and reopening them.
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point within maxLength
    let splitAt = findSplitPoint(remaining, maxLength);
    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

    // Handle code block continuity
    const openBlocks = countOpenCodeBlocks(chunk);
    if (openBlocks % 2 === 1) {
      // Odd number of ``` means we're inside a code block
      // Close it at the end of this chunk, reopen at start of next
      chunk += '\n```';
      remaining = '```\n' + remaining;
    }

    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Finds the best position to split text at, preferring line boundaries.
 */
function findSplitPoint(text: string, maxLength: number): number {
  // Try to split at a newline before maxLength
  const lastNewline = text.lastIndexOf('\n', maxLength);
  if (lastNewline > maxLength * 0.5) {
    return lastNewline + 1; // Include the newline in the current chunk
  }

  // Try to split at a space
  const lastSpace = text.lastIndexOf(' ', maxLength);
  if (lastSpace > maxLength * 0.5) {
    return lastSpace + 1;
  }

  // Hard split at maxLength
  return maxLength;
}

/**
 * Counts the number of ``` markers in text.
 * An odd count means the text ends inside a code block.
 */
function countOpenCodeBlocks(text: string): number {
  const matches = text.match(/```/g);
  return matches ? matches.length : 0;
}
