import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorItem {
  message: string;
  code?: string;
  field?: string;
}

interface ExceptionResponseObject {
  errors?: unknown;
  message?: unknown;
}

function normalizeErrorItem(item: unknown): ErrorItem {
  if (typeof item === 'string') {
    return { message: item };
  }

  if (item && typeof item === 'object') {
    const candidate = item as Record<string, unknown>;
    return {
      message:
        typeof candidate.message === 'string'
          ? candidate.message
          : 'Error inesperado',
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
      field: typeof candidate.field === 'string' ? candidate.field : undefined,
    };
  }

  return { message: 'Error inesperado' };
}

@Catch(HttpException)
export class HttpExceptionZodFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus?.() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionRes = exception.getResponse?.();

    const payload: { errors: ErrorItem[] } = {
      errors: [],
    };

    if (typeof exceptionRes === 'string') {
      payload.errors.push({ message: exceptionRes });
    } else if (typeof exceptionRes === 'object' && exceptionRes !== null) {
      const obj = exceptionRes as ExceptionResponseObject;

      if (Array.isArray(obj.errors)) {
        payload.errors = obj.errors.map(normalizeErrorItem);
      } else if (Array.isArray(obj.message)) {
        payload.errors = obj.message.map((message) =>
          normalizeErrorItem(message),
        );
      } else if (typeof obj.message === 'string') {
        payload.errors.push({ message: obj.message });
      } else {
        payload.errors.push({ message: 'Error inesperado' });
      }
    } else {
      payload.errors.push({ message: 'Error inesperado' });
    }

    response.status(status).json(payload);
  }
}
