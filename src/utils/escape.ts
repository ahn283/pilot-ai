/**
 * Centralized escaping utilities for AppleScript and shell arguments.
 * Replaces duplicated escape functions across notification.ts, calendar.ts, clipboard.ts.
 */

/**
 * Escapes a string for use inside AppleScript double-quoted strings.
 * Handles: backslash, double quotes, backticks, and $() subshell expressions.
 */
export function escapeAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')   // backslashes first
    .replace(/"/g, '\\"')     // double quotes
    .replace(/`/g, '\\`')     // backticks (prevent shell expansion in osascript)
    .replace(/\$/g, '\\$');   // dollar signs (prevent $() expansion)
}

/**
 * Escapes a string for use as a POSIX shell argument.
 * Wraps in single quotes and handles embedded single quotes.
 */
export function escapeShellArg(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}
