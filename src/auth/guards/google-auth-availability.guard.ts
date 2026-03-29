import { CanActivate, Injectable } from '@nestjs/common';
import { IntegrationPolicyService } from '../../runtime/integration-policy.service';

@Injectable()
export class GoogleAuthAvailabilityGuard implements CanActivate {
  constructor(
    private readonly integrationPolicy: IntegrationPolicyService,
  ) {}

  canActivate() {
    this.integrationPolicy.assertGoogleAuthEnabled(
      'El inicio de sesion con Google',
    );
    return true;
  }
}
