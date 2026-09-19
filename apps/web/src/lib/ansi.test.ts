import { describe, expect, test } from "bun:test";
import { parseAnsiLine, parseAnsiScreen, stripAnsi, styleToCss } from "./ansi.js";

const ESC = "\x1b";

describe("parseAnsiLine", () => {
  test("plain text is one unstyled span", () => {
    const { spans } = parseAnsiLine("hello");
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe("hello");
    expect(spans[0]!.style.fg).toBeNull();
  });

  test("colours and attributes open and close runs", () => {
    const { spans } = parseAnsiLine(`${ESC}[1;32mok${ESC}[0m plain`);
    expect(spans.map((span) => span.text)).toEqual(["ok", " plain"]);
    expect(spans[0]!.style.bold).toBe(true);
    expect(spans[0]!.style.fg).toBe("var(--term-2)");
    expect(spans[1]!.style.bold).toBe(false);
    expect(spans[1]!.style.fg).toBeNull();
  });

  test("256-colour and truecolour sequences consume their arguments", () => {
    const { spans } = parseAnsiLine(`${ESC}[38;5;208mA${ESC}[48;2;10;20;30mB`);
    expect(spans[0]!.style.fg).toBe("rgb(255,135,0)");
    expect(spans[1]!.style.bg).toBe("rgb(10,20,30)");
    // The 5/2 selectors and their arguments must not be read as attribute codes.
    expect(spans[1]!.style.dim).toBe(false);
  });

  test("bright colours map onto the upper half of the base palette", () => {
    const { spans } = parseAnsiLine(`${ESC}[91mred`);
    expect(spans[0]!.style.fg).toBe("var(--term-9)");
  });

  test("a bare reset clears everything", () => {
    const { spans } = parseAnsiLine(`${ESC}[4;31mu${ESC}[mv`);
    expect(spans[1]!.style.underline).toBe(false);
    expect(spans[1]!.style.fg).toBeNull();
  });

  test("non-SGR sequences are dropped without leaking bytes", () => {
    const { spans } = parseAnsiLine(`a${ESC}[2Kb${ESC}]0;title\x07c${ESC}(Bd`);
    expect(spans.map((span) => span.text).join("")).toBe("abcd");
  });

  test("adjacent runs with the same style merge", () => {
    const { spans } = parseAnsiLine(`${ESC}[31ma${ESC}[31mb`);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe("ab");
  });
});

describe("parseAnsiScreen", () => {
  test("styles carry across line breaks", () => {
    const lines = parseAnsiScreen(`${ESC}[33mfirst\nsecond${ESC}[0m`);
    expect(lines[1]![0]!.style.fg).toBe("var(--term-3)");
  });

  test("an empty line still yields a row so the layout keeps its height", () => {
    expect(parseAnsiScreen("a\n\nb")).toHaveLength(3);
  });
});

describe("stripAnsi", () => {
  test("removes every escape sequence", () => {
    expect(stripAnsi(`${ESC}[1mbold${ESC}[0m ${ESC}[38;5;1mx`)).toBe("bold x");
  });
});

describe("styleToCss", () => {
  test("resolves inverse video by swapping colours", () => {
    const css = styleToCss({ ...parseAnsiLine(`${ESC}[7;31mx`).spans[0]!.style });
    expect(css["backgroundColor"]).toBe("var(--term-1)");
    expect(css["color"]).toBe("var(--term-bg)");
  });

  test("combines underline and strike into one declaration", () => {
    const css = styleToCss(parseAnsiLine(`${ESC}[4;9mx`).spans[0]!.style);
    expect(css["textDecoration"]).toBe("underline line-through");
  });
});
