/**
 * Universal HTML and Code Sanitizer for VisionOS
 * Strips markdown code fences (```html, ```xml, ```, etc.), conversational wrappers,
 * and extracts pure executable code for sandboxed iframe execution.
 * Pure TypeScript — compatible with Edge Runtime, Node.js, Web Workers, and Browser.
 */

export function stripMarkdownFences(code: string): string {
  if (!code || typeof code !== 'string') return '';
  let cleaned = code.trim();
  if (!cleaned) return '';

  // 1. Strip standard or multi-backtick/tilde code fences with optional language tag and file metadata
  // e.g. ````html:app.html\n...```` or ```xml\n...``` or ~~~html\n...~~~
  const fullEnclosureRegex =
    /^(?:`{3,}|~{3,})[^\r\n]*\r?\n([\s\S]*?)\r?\n?(?:`{3,}|~{3,})\s*$/;
  const matchFull = cleaned.match(fullEnclosureRegex);
  if (matchFull && matchFull[1] !== undefined) {
    cleaned = matchFull[1].trim();
  } else {
    // 2. Closed fenced block inside conversational preamble and outro text
    const embeddedBlockRegex =
      /(?:`{3,}|~{3,})[^\r\n]*\r?\n([\s\S]*?)\r?\n?(?:`{3,}|~{3,})/;
    const matchEmbedded = cleaned.match(embeddedBlockRegex);
    if (matchEmbedded && matchEmbedded[1] && matchEmbedded[1].trim()) {
      cleaned = matchEmbedded[1].trim();
    } else {
      // 3. Unclosed code block preceded by conversational text: "Here is the code: ```html ..."
      const unclosedPreambleRegex = /(?:`{3,}|~{3,})[^\r\n]*\r?\n?([\s\S]+)$/;
      const matchUnclosedPreamble = cleaned.match(unclosedPreambleRegex);
      if (
        matchUnclosedPreamble &&
        matchUnclosedPreamble[1] &&
        matchUnclosedPreamble[1].trim()
      ) {
        cleaned = matchUnclosedPreamble[1].trim();
      } else {
        // Strip leading fence if present
        cleaned = cleaned.replace(/^(?:`{3,}|~{3,})[^\r\n]*\r?\n?/i, '');
        // Strip trailing fence if present
        cleaned = cleaned.replace(/\r?\n?(?:`{3,}|~{3,})\s*$/i, '');
      }
    }
  }

  // 4. If full HTML document exists inside any remaining conversational text
  const docMatch = cleaned.match(
    /(<!DOCTYPE\s+html[\s\S]*<\/html>|<html[\s\S]*<\/html>)/i
  );
  if (docMatch && docMatch[1]) {
    cleaned = docMatch[1].trim();
  } else {
    const openDocMatch = cleaned.match(
      /(<!DOCTYPE\s+html[\s\S]+|<html[\s\S]+)/i
    );
    if (openDocMatch && openDocMatch[1]) {
      cleaned = openDocMatch[1].trim();
    }
  }

  // 5. Final safety pass: strip stray markdown backticks or boundary fences that might still linger
  cleaned = cleaned.replace(/^`+|`+$/g, '').trim();

  return cleaned;
}
