import { Response } from 'express';

function sanitizeDownloadFilename(filename: string) {
  const normalized = filename
    .trim()
    .replace(/["\\\r\n]/g, '')
    .replace(/\s+/g, '-');

  return normalized || 'archivo';
}

export function sendBufferResponse(
  response: Response,
  options: {
    contentType: string;
    filename: string;
    disposition?: 'inline' | 'attachment';
    buffer: Buffer;
  },
) {
  const disposition = options.disposition ?? 'inline';
  const filename = sanitizeDownloadFilename(options.filename);

  response.setHeader('Content-Type', options.contentType);
  response.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${filename}"`,
  );
  response.send(options.buffer);
}

export function sendAttachmentFile(
  response: Response,
  filename: string,
  contentType: string,
  buffer: Buffer,
) {
  sendBufferResponse(response, {
    contentType,
    filename,
    disposition: 'attachment',
    buffer,
  });
}
