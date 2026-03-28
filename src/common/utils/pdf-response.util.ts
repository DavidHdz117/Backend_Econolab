import { Response } from 'express';

export function sendInlinePdf(
  response: Response,
  filename: string,
  buffer: Buffer,
) {
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  response.send(buffer);
}
