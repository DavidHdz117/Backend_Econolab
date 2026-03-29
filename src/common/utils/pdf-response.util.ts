import { Response } from 'express';
import { sendBufferResponse } from './file-response.util';

export function sendInlinePdf(
  response: Response,
  filename: string,
  buffer: Buffer,
) {
  sendBufferResponse(response, {
    contentType: 'application/pdf',
    filename,
    buffer,
  });
}
