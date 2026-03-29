import { Global, Module } from '@nestjs/common';
import { IntegrationPolicyService } from './integration-policy.service';
import { RuntimeController } from './runtime.controller';
import { RuntimeDiagnosticsService } from './runtime-diagnostics.service';
import { RuntimePolicyService } from './runtime-policy.service';

@Global()
@Module({
  providers: [
    RuntimePolicyService,
    IntegrationPolicyService,
    RuntimeDiagnosticsService,
  ],
  controllers: [RuntimeController],
  exports: [
    RuntimePolicyService,
    IntegrationPolicyService,
    RuntimeDiagnosticsService,
  ],
})
export class RuntimeModule {}
