import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SyncRuntimeConfig } from '../config/sync.config';
import type { SyncOutboxEvent } from './entities/sync-outbox-event.entity';
import type { SyncInboundMutationInput } from './dto/apply-sync-mutations.dto';
import type { SupportedInboundSyncResourceType } from './sync-resource.util';

type ClaimRemoteBatchResponse = {
  leaseToken: string | null;
  count: number;
  events: SyncOutboxEvent[];
};

type LeaseMutationResult = {
  message: string;
  affected: number;
};

type ExportBootstrapPageResponse = {
  resourceType: SupportedInboundSyncResourceType;
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
  mutations: SyncInboundMutationInput[];
};

@Injectable()
export class SyncRemoteClientService {
  constructor(private readonly configService: ConfigService) {}

  private get runtimeConfig(): SyncRuntimeConfig {
    return this.configService.getOrThrow<SyncRuntimeConfig>('sync');
  }

  private getRemoteBaseUrl() {
    const baseUrl = this.runtimeConfig.remoteBaseUrl?.trim();
    if (!baseUrl) {
      throw new Error(
        'SYNC_REMOTE_BASE_URL no esta configurado para esta instancia.',
      );
    }

    return baseUrl.replace(/\/+$/, '');
  }

  private getRemoteHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.runtimeConfig.machineAuthEnabled && this.runtimeConfig.machineToken) {
      headers[this.runtimeConfig.machineHeaderName] = this.runtimeConfig.machineToken;
    }

    return headers;
  }

  private async request<T>(path: string, body?: Record<string, unknown>) {
    const baseUrl = this.getRemoteBaseUrl();
    const url = `${baseUrl}/${path.replace(/^\/+/, '')}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.getRemoteHeaders(),
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(this.runtimeConfig.remoteTimeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(
        `No fue posible conectar con el servidor central en ${baseUrl}. ${message}`,
      );
    }

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Sync remoto respondio ${response.status}: ${responseText || response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }

  claimPendingBatch(limit?: number) {
    return this.request<ClaimRemoteBatchResponse>('sync/outbox/claim', { limit });
  }

  ackBatch(leaseToken: string, ids: number[]) {
    return this.request<LeaseMutationResult>('sync/outbox/ack', {
      leaseToken,
      ids,
    });
  }

  failBatch(
    leaseToken: string,
    failures: Array<{ id: number; error: string }>,
  ) {
    return this.request<LeaseMutationResult>('sync/outbox/fail', {
      leaseToken,
      failures,
    });
  }

  applyInbound(mutations: SyncInboundMutationInput[]) {
    return this.request<{
      total: number;
      appliedCount: number;
      skippedCount: number;
      deferredCount: number;
      failedCount: number;
      results: Array<{
        index: number;
        status: string;
        message: string;
      }>;
    }>('sync/outbox/inbound/apply', {
      mutations,
    });
  }

  exportBootstrapPage(options: {
    resourceType: SupportedInboundSyncResourceType;
    cursor?: string;
    limit?: number;
    includeDeleted?: boolean;
  }) {
    return this.request<ExportBootstrapPageResponse>('sync/bootstrap/export', options);
  }
}
