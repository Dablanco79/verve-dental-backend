import { inflateSync } from "node:zlib";

/**
 * Extracts text drawn with PDFKit's standard fonts. This is deliberately
 * narrow: it supports the hex text operands emitted by this application's
 * PDFKit documents and is not a general-purpose PDF parser.
 */
export function extractPdfKitText(buffer: Buffer): string {
  const source = buffer.toString("latin1");
  const decodedStreams: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(source)) !== null) {
    const streamStart = streamPattern.lastIndex;
    const objectStart = source.lastIndexOf("obj", match.index);
    const dictionary = source.slice(Math.max(0, objectStart), match.index);
    const declaredLength = dictionary.match(/\/Length\s+(\d+)\b/)?.[1];
    const streamEndMarker = source.indexOf(
      "endstream",
      declaredLength
        ? streamStart + Number(declaredLength)
        : streamStart,
    );
    if (streamEndMarker < 0) break;

    let streamEnd = declaredLength
      ? streamStart + Number(declaredLength)
      : streamEndMarker;
    if (!declaredLength && source[streamEnd - 1] === "\n") {
      streamEnd -= 1;
      if (source[streamEnd - 1] === "\r") streamEnd -= 1;
    }

    const bytes = Buffer.from(
      source.slice(streamStart, streamEnd),
      "latin1",
    );
    let content: string;
    try {
      content = dictionary.includes("/FlateDecode")
        ? inflateSync(bytes).toString("latin1")
        : bytes.toString("latin1");
    } catch {
      streamPattern.lastIndex = streamEndMarker + "endstream".length;
      continue;
    }

    const text = [...content.matchAll(/<([0-9A-Fa-f]+)>/g)]
      .map((hexMatch) =>
        Buffer.from(hexMatch[1] ?? "", "hex")
          .toString("latin1")
          // PDFKit's standard Helvetica encoding uses Windows-1252 bytes for
          // typographic dashes rather than ISO-8859-1 control characters.
          .replace(/\x96/g, "–")
          .replace(/\x97/g, "—"))
      .join("");
    if (text) decodedStreams.push(text);
    streamPattern.lastIndex = streamEndMarker + "endstream".length;
  }

  return decodedStreams.join("\n");
}
