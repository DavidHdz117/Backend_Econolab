import { Injectable } from '@nestjs/common';
import { StoragePathService } from './storage-path.service';

@Injectable()
export class DocumentArtifactService {
  constructor(private readonly storagePaths: StoragePathService) {}

  private sanitizeToken(value: string | number) {
    const normalized = String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return normalized || 'documento';
  }

  buildPdfFilename(prefix: string, identifier: string | number) {
    return `${this.sanitizeToken(prefix)}-${this.sanitizeToken(identifier)}.pdf`;
  }

  buildCsvFilename(prefix: string, identifier: string | number) {
    return `${this.sanitizeToken(prefix)}-${this.sanitizeToken(identifier)}.csv`;
  }

  getDocumentArtifactsDirectory(subdirectory?: string) {
    return this.storagePaths.ensureDocumentArtifactsDirectory(subdirectory);
  }
}
