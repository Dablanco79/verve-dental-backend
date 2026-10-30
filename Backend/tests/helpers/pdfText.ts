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
    const streamEndMarker = source.indexOf("endstream", streamStart);
    if (streamEndMarker < 0) break;

    let streamEnd = streamEndMarker;
    while (
      streamEnd > streamStart &&
      (source[streamEnd - 1] === "\r" || source[streamEnd - 1] === "\n")
    ) {
      streamEnd -= 1;
    }

    const objectStart = source.lastIndexOf("obj", match.index);
    const dictionary = source.slice(Math.max(0, objectStart), match.index);
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
        Buffer.from(hexMatch[1] ?? "", "hex").toString("latin1"))
      .join("");
    if (text) decodedStreams.push(text);
    streamPattern.lastIndex = streamEndMarker + "endstream".length;
  }

  return decodedStreams.join("\n");
}
