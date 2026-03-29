import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AppRuntimeConfig,
  type AppRuntimeMode,
} from '../config/app.config';

@Injectable()
export class RuntimePolicyService {
  constructor(private readonly configService: ConfigService) {}

  private get runtimeConfig(): AppRuntimeConfig {
    return this.configService.getOrThrow<AppRuntimeConfig>('app');
  }

  get runtimeMode(): AppRuntimeMode {
    return this.runtimeConfig.runtimeMode;
  }

  get allowHardDelete() {
    return this.runtimeConfig.allowHardDelete;
  }

  assertHardDeleteAllowed(resourceLabel = 'registro') {
    if (this.allowHardDelete) {
      return;
    }

    throw new ConflictException(
      `La eliminacion permanente de ${resourceLabel} esta deshabilitada en el runtime ${this.runtimeMode}. Usa baja logica o una purga controlada en el servidor central.`,
    );
  }
}
