/**
 * Render a tmux screen capture (`capture-pane -e`) as styled spans.
 *
 * tmux emits only SGR sequences when asked for escapes, so this handles exactly
 * those — colours and text attributes — and strips anything else it does not
 * understand rather than leaking control bytes into the page. It is deliberately
 * not a terminal emulator: the screen is already laid out by tmux, line by line, and
 * all that is left is to colour it.
 */

export type AnsiStyle = {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strike: boolean;
};

export type AnsiSpan = { text: string; style: AnsiStyle };

const DEFAULT_STYLE: AnsiStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
};

/** The 16 base colours, expressed as CSS variables the page can theme. */
function baseColor(index: number): string {
  return `var(--term-${index})`;
}

/** Colours 16–255 of the xterm palette, computed rather than tabled. */
function paletteColor(index: number): string {
  if (index < 16) return baseColor(index);
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return `rgb(${level},${level},${level})`;
  }
  const value = index - 16;
  const steps = [0, 95, 135, 175, 215, 255];
  const r = steps[Math.floor(value / 36) % 6]!;
  const g = steps[Math.floor(value / 6) % 6]!;
  const b = steps[value % 6]!;
  return `rgb(${r},${g},${b})`;
}

/**
 * Apply one SGR parameter list to a style.
 *
 * Extended colours (`38;5;n`, `38;2;r;g;b`) consume their arguments, which is why
 * this walks with an index instead of mapping.
 */
export function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  const next = { ...style };
  if (params.length === 0) return { ...DEFAULT_STYLE };

  for (let i = 0; i < params.length; i += 1) {
    const code = params[i]!;
    if (code === 0) Object.assign(next, DEFAULT_STYLE);
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strike = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false;
    else if (code === 29) next.strike = false;
    else if (code >= 30 && code <= 37) next.fg = baseColor(code - 30);
    else if (code === 39) next.fg = null;
    else if (code >= 40 && code <= 47) next.bg = baseColor(code - 40);
    else if (code === 49) next.bg = null;
    else if (code >= 90 && code <= 97) next.fg = baseColor(code - 90 + 8);
    else if (code >= 100 && code <= 107) next.bg = baseColor(code - 100 + 8);
    else if (code === 38 || code === 48) {
      const target = code === 38 ? "fg" : "bg";
      const mode = params[i + 1];
      if (mode === 5 && params[i + 2] !== undefined) {
        next[target] = paletteColor(params[i + 2]!);
        i += 2;
      } else if (mode === 2 && params[i + 4] !== undefined) {
        next[target] = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
        i += 4;
      }
    }
  }
  return next;
}

// CSI sequences (`ESC [ ... final`), OSC sequences (`ESC ] ... BEL|ST`), charset
// designations such as `ESC ( B`, and the remaining two-byte escapes.
const ESCAPE =
  /\x1b\[([\d;]*)([\x40-\x7e])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[\x20-\x2f][\x30-\x7e]|\x1b[\x40-\x5f]/g;

/** Split one line of captured screen into styled runs. */
export function parseAnsiLine(line: string, initial: AnsiStyle = DEFAULT_STYLE): {
  spans: AnsiSpan[];
  style: AnsiStyle;
} {
  const spans: AnsiSpan[] = [];
  let style = initial;
  let last = 0;

  const push = (text: string) => {
    if (!text) return;
    const previous = spans[spans.length - 1];
    if (previous && sameStyle(previous.style, style)) previous.text += text;
    else spans.push({ text, style });
  };

  for (const match of line.matchAll(ESCAPE)) {
    push(line.slice(last, match.index));
    last = match.index + match[0].length;
    const [, params, final] = match;
    if (final === "m") {
      style = applySgr(
        style,
        (params ?? "")
          .split(";")
          .filter((part) => part.length > 0)
          .map((part) => Number.parseInt(part, 10)),
      );
    }
    // Any other sequence is dropped: cursor movement has no meaning in a capture.
  }
  push(line.slice(last));
  return { spans, style };
}

/** Parse a whole screen; styles carry across line breaks as they do in a terminal. */
export function parseAnsiScreen(screen: string): AnsiSpan[][] {
  const lines: AnsiSpan[][] = [];
  let style = DEFAULT_STYLE;
  for (const line of screen.split("\n")) {
    const parsed = parseAnsiLine(line, style);
    lines.push(parsed.spans);
    style = parsed.style;
  }
  return lines;
}

/** Strip every escape sequence, for plain-text uses such as copying. */
export function stripAnsi(text: string): string {
  return text.replace(ESCAPE, "");
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    a.strike === b.strike
  );
}

/** Inline CSS for a span, resolving inverse video so the page never has to. */
export function styleToCss(style: AnsiStyle): Record<string, string> {
  const css: Record<string, string> = {};
  const fg = style.inverse ? (style.bg ?? "var(--term-bg)") : style.fg;
  const bg = style.inverse ? (style.fg ?? "var(--term-fg)") : style.bg;
  if (fg) css["color"] = fg;
  if (bg) css["backgroundColor"] = bg;
  if (style.bold) css["fontWeight"] = "600";
  if (style.dim) css["opacity"] = "0.6";
  if (style.italic) css["fontStyle"] = "italic";
  const decorations = [style.underline ? "underline" : null, style.strike ? "line-through" : null].filter(Boolean);
  if (decorations.length > 0) css["textDecoration"] = decorations.join(" ");
  return css;
}
