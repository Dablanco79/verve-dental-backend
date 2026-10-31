import type { RosterEntry } from "../types/roster.js";

export type RosterPdfLogo = {
  imageData: Buffer;
  mimeType: "image/png" | "image/jpeg";
};

export type RosterPdfShift = Pick<
  RosterEntry,
  "id" | "shiftStartAt" | "shiftEndAt"
>;

export type RosterPdfLeave = {
  startDate: string;
  endDate: string;
};

export type RosterPdfStaff = {
  staffUserId: string;
  displayName: string;
  shifts: RosterPdfShift[];
  approvedLeave: RosterPdfLeave[];
};

export type RosterPdfMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type RosterPdfHeadingOptions = {
  clinicName: string;
  logo?: RosterPdfLogo;
  title: string;
  subtitle: string;
  margins: RosterPdfMargins;
  clinicNameFontSize?: number;
  titleFontSize?: number;
  subtitleFontSize?: number;
  logoFit?: readonly [number, number];
  minimumHeight?: number;
};

export function safeRosterFilenamePart(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return cleaned || "Clinic";
}

export function collectPdfBuffer(
  doc: PDFKit.PDFDocument,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", reject);
  });
}

export function drawRosterPageHeading(
  doc: PDFKit.PDFDocument,
  options: RosterPdfHeadingOptions,
): number {
  const top = options.margins.top;
  const logoFit = options.logoFit ?? [92, 38];
  let textX = options.margins.left;
  let renderedLogo = false;
  if (options.logo) {
    try {
      doc.image(options.logo.imageData, textX, top, {
        fit: [logoFit[0], logoFit[1]],
      });
      textX += logoFit[0] + 12;
      renderedLogo = true;
    } catch {
      // Phase 1 stores normalized PNG/JPEG bytes. Historical unreadable bytes
      // must not prevent an otherwise valid roster export.
    }
  }

  const clinicNameWidth =
    doc.page.width - textX - options.margins.right;
  doc
    .fillColor("#17233c")
    .font("Helvetica-Bold")
    .fontSize(options.clinicNameFontSize ?? 14);
  const clinicNameHeight = doc.heightOfString(options.clinicName, {
    width: clinicNameWidth,
  });
  doc.text(options.clinicName, textX, top, {
    width: clinicNameWidth,
  });

  const titleY = top + clinicNameHeight + 3;
  doc
    .font("Helvetica-Bold")
    .fontSize(options.titleFontSize ?? 11)
    .text(options.title, textX, titleY, { lineBreak: false });
  const subtitleY = titleY + (options.titleFontSize ?? 11) + 5;
  doc
    .fillColor("#526077")
    .font("Helvetica")
    .fontSize(options.subtitleFontSize ?? 8)
    .text(options.subtitle, textX, subtitleY, { lineBreak: false });

  const contentBottom = subtitleY + (options.subtitleFontSize ?? 8) + 5;
  const logoBottom = renderedLogo ? top + logoFit[1] + 10 : top;
  return Math.max(
    top + (options.minimumHeight ?? 55),
    contentBottom,
    logoBottom,
  );
}

export function addRosterPdfFooters(
  doc: PDFKit.PDFDocument,
  options: {
    margins: RosterPdfMargins;
    generatedAt: Date;
    timeZone: string;
  },
): number {
  const range = doc.bufferedPageRange();
  for (
    let index = range.start;
    index < range.start + range.count;
    index += 1
  ) {
    doc.switchToPage(index);
    const footerY = doc.page.height - options.margins.bottom - 11;
    doc
      .strokeColor("#b9c2d0")
      .moveTo(options.margins.left, footerY - 5)
      .lineTo(doc.page.width - options.margins.right, footerY - 5)
      .stroke();
    doc
      .fillColor("#526077")
      .font("Helvetica")
      .fontSize(7.5)
      .text("Printed from RENQOR", options.margins.left, footerY, {
        lineBreak: false,
      })
      .text(
        `Generated ${options.generatedAt.toLocaleDateString("en-AU", {
          timeZone: options.timeZone,
        })}  |  Page ${String(index - range.start + 1)} of ${String(range.count)}`,
        options.margins.left,
        footerY,
        {
          width:
            doc.page.width -
            options.margins.left -
            options.margins.right,
          align: "right",
          lineBreak: false,
        },
      );
  }
  return doc.bufferedPageRange().count;
}

export function formatRosterPdfTime(
  instant: Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}
