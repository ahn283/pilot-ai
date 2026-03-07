import {
  readUserMemory,
  writeUserMemory,
  appendUserMemory,
  readProjectMemory,
  resetMemory,
} from './memory.js';

export interface MemoryCommandResult {
  handled: boolean;
  response?: string;
}

const MEMORY_PATTERNS = {
  showUserMemory: /^(내\s*메모리|my\s*memory|메모리\s*보여|show\s*memory)/i,
  showProjectMemory: /^(.+?)\s*(프로젝트\s*메모리|project\s*memory)\s*(보여|show)?/i,
  updateMemory: /^(메모리\s*(?:업데이트|수정|변경|바꿔)|(?:update|change)\s*memory)[:\s]+(.+)/i,
  addMemory: /^(메모리\s*(?:추가|저장)|(?:add|save)\s*(?:to\s*)?memory)[:\s]+(.+)/i,
  resetMemory: /^(메모리\s*초기화|reset\s*memory)/i,
};

/**
 * Checks if a message is a memory command and handles it.
 * Returns { handled: true, response } if it was a memory command,
 * or { handled: false } if it should be passed to Claude.
 */
export async function handleMemoryCommand(text: string): Promise<MemoryCommandResult> {
  const trimmed = text.trim();

  // Show user memory
  if (MEMORY_PATTERNS.showUserMemory.test(trimmed)) {
    const memory = await readUserMemory();
    if (!memory) {
      return { handled: true, response: 'No saved memory yet.' };
    }
    return { handled: true, response: `**MEMORY.md**\n\`\`\`\n${memory}\n\`\`\`` };
  }

  // Show project memory
  const projectMatch = trimmed.match(MEMORY_PATTERNS.showProjectMemory);
  if (projectMatch) {
    const projectName = projectMatch[1].trim();
    const memory = await readProjectMemory(projectName);
    if (!memory) {
      return { handled: true, response: `No memory found for project "${projectName}".` };
    }
    return { handled: true, response: `**${projectName} memory**\n\`\`\`\n${memory}\n\`\`\`` };
  }

  // Update memory (replace)
  const updateMatch = trimmed.match(MEMORY_PATTERNS.updateMemory);
  if (updateMatch) {
    const newContent = updateMatch[2].trim();
    await writeUserMemory(newContent);
    return { handled: true, response: `Memory updated:\n${newContent}` };
  }

  // Add to memory
  const addMatch = trimmed.match(MEMORY_PATTERNS.addMemory);
  if (addMatch) {
    const entry = addMatch[2].trim();
    await appendUserMemory(`- ${entry}`);
    return { handled: true, response: `Added to memory: ${entry}` };
  }

  // Reset memory
  if (MEMORY_PATTERNS.resetMemory.test(trimmed)) {
    await resetMemory();
    return { handled: true, response: 'All memory has been reset.' };
  }

  return { handled: false };
}
