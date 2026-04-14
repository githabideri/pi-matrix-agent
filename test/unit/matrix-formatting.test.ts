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
      expect(output).toContain("&lt;script&gt;");
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
      const input = "```\nconsole.log('hello');\n```";
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

    it("converts headers", () => {
      const input = "# Header 1\n## Header 2\n### Header 3";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<h1>Header 1</h1>");
      expect(output).toContain("<h2>Header 2</h2>");
      expect(output).toContain("<h3>Header 3</h3>");
    });

    it("converts paragraphs and newlines", () => {
      const input = "Line 1\nLine 2\n\nParagraph 2";
      const output = (transport as any).toSafeHtml(input);
      expect(output).toContain("<p>");
      expect(output).toContain("</p>");
      expect(output).toContain("<br>");
    });

    it("handles mixed content", () => {
      const input = `# Response

Here is **bold** and *italic* text.


code block
\`\`\`
console.log("hello");
\`\`\`

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
