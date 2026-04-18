import { beforeEach, describe, expect, it } from "vitest";
import { MatrixTransport } from "../../src/matrix.js";

describe("MatrixTransport formatting", () => {
  let transport: MatrixTransport;

  beforeEach(() => {
    transport = new MatrixTransport("http://test", "test", ["room1"], "@test:example.com");
  });

  describe("toSafeHtml", () => {
    it("escapes HTML entities", () => {
      const input = "<script>alert('xss')</script>";
      const output = (transport as any).toSafeHtml(input);
      expect(output).not.toContain("<script>");
    });

    it("converts bold markdown to strong", () => {
      const input = "Hello **world**";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<strong>world</strong>");
    });

    it("converts italic markdown to em", () => {
      const input = "Hello *world*";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<em>world</em>");
    });

    it("converts inline code", () => {
      const input = "Use `grep` to search";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<code>grep</code>");
    });

    it("converts code blocks", () => {
      const backtick = "`";
      const input = `${backtick}${backtick}${backtick}\nconsole.log('hello');\n${backtick}${backtick}${backtick}`;
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<pre><code>");
      expect(output).toContain("console.log('hello');");
      expect(output).toContain("</code></pre>");
    });

    it("converts links", () => {
      const input = "Check [example](https://example.com)";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain('<a href="https://example.com">example</a>');
    });

    it("converts h1-h3 headers", () => {
      const input = "# Header 1\n## Header 2\n### Header 3";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<h1>Header 1</h1>");
      expect(output).toContain("<h2>Header 2</h2>");
      expect(output).toContain("<h3>Header 3</h3>");
    });

    it("converts h4-h6 headers", () => {
      const input = "#### Header 4\n##### Header 5\n###### Header 6";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<h4>Header 4</h4>");
      expect(output).toContain("<h5>Header 5</h5>");
      expect(output).toContain("<h6>Header 6</h6>");
    });

    it("converts bullet lists", () => {
      const input = "\n- Item 1\n- Item 2\n- Item 3";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<ul>");
      expect(output).toContain("<li>Item 1</li>");
      expect(output).toContain("<li>Item 2</li>");
      expect(output).toContain("<li>Item 3</li>");
      expect(output).toContain("</ul>");
    });

    it("converts numbered lists", () => {
      const input = "\n1. First\n2. Second\n3. Third";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<ol>");
      expect(output).toContain("<li>First</li>");
      expect(output).toContain("<li>Second</li>");
      expect(output).toContain("<li>Third</li>");
      expect(output).toContain("</ol>");
    });

    it("converts blockquotes", () => {
      const input = "> This is a quote\n> continued on second line";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<blockquote>");
      expect(output).toContain("This is a quote");
      expect(output).toContain("continued on second line");
      expect(output).toContain("</blockquote>");
    });

    it("converts markdown tables", () => {
      const input = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |`;
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<table>");
      expect(output).toContain("<thead>");
      expect(output).toContain("<tr>");
      expect(output).toContain("<th>Header 1</th>");
      expect(output).toContain("<th>Header 2</th>");
      expect(output).toContain("<tbody>");
      expect(output).toContain("<td>Cell 1</td>");
      expect(output).toContain("<td>Cell 2</td>");
      expect(output).toContain("</table>");
    });

    it("converts fenced code blocks with language tag", () => {
      const backtick = "`";
      const input = `${backtick}${backtick}${backtick}typescript\nfunction hello() {\n  return 'world';\n}\n${backtick}${backtick}${backtick}`;
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<pre><code>");
      expect(output).toContain("function hello()");
      expect(output).toContain("return 'world'");
      expect(output).toContain("</code></pre>");
    });

    it("sanitizes dangerous HTML (XSS protection)", () => {
      const input = `# Header

<script>alert('xss')</script>

<iframe src="evil.com"></iframe>

<img src=x onerror=alert('xss')>`;
      const output = (transport as any).toSafeHtml(input);
      // marked escapes raw HTML by default, then sanitize-html removes any remaining dangerous tags
      expect(output).not.toContain("<script>");
      expect(output).not.toContain("</script>");
      expect(output).not.toContain("<iframe>");
      expect(output).not.toContain("</iframe>");
      // Verify <img> is escaped to &lt;img (safe text, not executed)
      expect(output).toContain("&lt;img");
      expect(output).not.toContain("<img");
    });

    it("handles complex mixed markdown", () => {
      const backtick = "`";
      const backtick3 = `${backtick}${backtick}${backtick}`;
      const input = `# Project Overview

## Introduction

This is a **complex** example with *multiple* features.

### Features

- Feature one
- Feature two
- Feature three

#### Detailed List

1. First item
2. Second item with ${backtick}inline code${backtick}
3. Third item

##### Code Example

${backtick3}javascript
function example() {
  console.log("Hello");
}
${backtick3}

###### Data Table

| Name    | Value |
|---------|-------|
| Alpha   | 100   |
| Beta    | 200   |

> Important: This is a blockquote

Check [the docs](https://example.com) for more.`;
      const output = (transport as any).toSafeHtml(input);
      // Headers
      expect(output).toContain("<h1>Project Overview</h1>");
      expect(output).toContain("<h2>Introduction</h2>");
      expect(output).toContain("<h3>Features</h3>");
      expect(output).toContain("<h4>Detailed List</h4>");
      expect(output).toContain("<h5>Code Example</h5>");
      expect(output).toContain("<h6>Data Table</h6>");
      // Formatting
      expect(output).toContain("<strong>complex</strong>");
      expect(output).toContain("<em>multiple</em>");
      // Lists
      expect(output).toContain("<ul>");
      expect(output).toContain("<ol>");
      // Code
      expect(output).toContain("<pre><code>");
      expect(output).toContain("<code>inline code</code>");
      // Table
      expect(output).toContain("<table>");
      expect(output).toContain("<th>Name</th>");
      expect(output).toContain("<td>Alpha</td>");
      // Blockquote
      expect(output).toContain("<blockquote>");
      // Link
      expect(output).toContain('<a href="https://example.com">the docs</a>');
    });

    it("handles paragraphs and newlines", () => {
      const input = "Line 1\nLine 2\n\nParagraph 2";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<p>");
      expect(output).toContain("</p>");
    });

    it("handles mixed content", () => {
      const backtick = "`";
      const backtick3 = `${backtick}${backtick}${backtick}`;
      const input = `# Response

Here is **bold** and *italic* text.


code block
${backtick3}
console.log("hello");
${backtick3}

Check [link](https://example.com) for more.`;
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<h1>Response</h1>");
      expect(output).toContain("<strong>bold</strong>");
      expect(output).toContain("<em>italic</em>");
      expect(output).toContain("<pre><code>");
      expect(output).toContain('<a href="https://example.com">link</a>');
    });
  });
});
