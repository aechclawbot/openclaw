/**
 * OASIS Dashboard v3 - Input Sanitization Utilities
 * Prevents command injection via Claude CLI prompts and other user-supplied input.
 */

/**
 * Sanitize user input before interpolating into Claude CLI prompts.
 * Strips control characters, trims length, escapes template-injection vectors.
 */
export function sanitizePromptInput(str, maxLen = 500) {
  if (typeof str !== "string") {return "";}
  return str
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "") // strip control chars (keep \n, \r, \t)
    .replace(/`/g, "'") // escape backticks (template literal injection)
    .replace(/\$\{/g, "\\${") // escape template interpolation
    .substring(0, maxLen)
    .trim();
}

/**
 * Sanitize a Docker API query parameter (timestamps, durations).
 * Only allows digits, T, colons, dots, Z, and hyphens.
 */
export function sanitizeDockerParam(str) {
  if (typeof str !== "string") {return "";}
  return str.replace(/[^0-9T:.Z-]/g, "");
}
