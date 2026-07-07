/**
 * Minimal KiCad S-expression helpers, shared by the netlist and board parsers.
 *
 * These do balanced-paren scanning rather than a full parse — enough to pull
 * named blocks and scalar attributes out of KiCad's `.net` / `.kicad_pcb`
 * exports without pulling in a parser dependency.
 */

/**
 * Extract all top-level `(keyword ...)` blocks from src using balanced-paren
 * scanning. The keyword must be followed by whitespace or `)` to avoid false
 * matches on longer identifiers (e.g. `comp` won't match inside `components`,
 * `layer` won't match inside `layers`).
 */
export function extractBlocks(src: string, keyword: string): string[] {
  const blocks: string[] = [];
  const prefix = `(${keyword}`;
  let pos = 0;

  while (pos < src.length) {
    const idx = src.indexOf(prefix, pos);
    if (idx === -1) break;

    const charAfter = src[idx + prefix.length];
    if (
      charAfter !== " " &&
      charAfter !== "\n" &&
      charAfter !== "\r" &&
      charAfter !== "\t" &&
      charAfter !== ")"
    ) {
      pos = idx + 1;
      continue;
    }

    let depth = 0;
    let end = -1;
    for (let i = idx; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) break; // malformed — bail
    blocks.push(src.slice(idx, end + 1));
    pos = end + 1;
  }

  return blocks;
}

/**
 * Extract the string value of `(keyword "value")` or `(keyword value)` from
 * within a block. Returns the first match, or null if absent.
 */
export function extractAttr(block: string, keyword: string): string | null {
  const quoted = new RegExp(`\\(${keyword}\\s+"([^"]*)"`, "s");
  const m = quoted.exec(block);
  if (m) return m[1];

  const unquoted = new RegExp(`\\(${keyword}\\s+([^\\s)]+)`);
  const m2 = unquoted.exec(block);
  return m2?.[1] ?? null;
}
