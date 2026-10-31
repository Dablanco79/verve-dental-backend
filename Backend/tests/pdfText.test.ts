import { describe, expect, it } from "@jest/globals";

import { extractPdfKitText } from "./helpers/pdfText.js";

describe("extractPdfKitText", () => {
  it("preserves a compressed stream whose final byte is a newline", () => {
    const compressed = Buffer.from(
      "789c730a51b0313136b134323037324b33373637313335373232303335b73037304b33373237313230b334b7b45308c952700de1020018930b0a",
      "hex",
    );
    expect(compressed.at(-1)).toBe(0x0a);

    const pdf = Buffer.concat([
      Buffer.from(
        `%PDF-1.3\n1 0 obj\n<< /Length ${String(compressed.length)} /Filter /FlateDecode >>\nstream\n`,
        "latin1",
      ),
      compressed,
      Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
    ]);

    expect(extractPdfKitText(pdf)).toContain("CI roster export iy");
  });
});
