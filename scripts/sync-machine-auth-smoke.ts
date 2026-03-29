import { ConfigService } from '@nestjs/config';
import { Role } from '../src/common/enums/roles.enum';
import { getSyncRuntimeConfig, syncConfig } from '../src/config/sync.config';
import { SyncMachineAuthGuard } from '../src/sync/guards/sync-machine-auth.guard';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createMockRequest(headers: Record<string, string | undefined>) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    headers: normalizedHeaders,
    user: undefined as unknown,
    header(name: string) {
      return normalizedHeaders[name.toLowerCase()];
    },
  };
}

function createExecutionContext(request: ReturnType<typeof createMockRequest>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

async function expectUnauthorized(
  guard: SyncMachineAuthGuard,
  headers: Record<string, string | undefined>,
) {
  const request = createMockRequest(headers);

  try {
    await guard.canActivate(createExecutionContext(request));
  } catch (error) {
    assert(
      error instanceof Error &&
        'status' in error &&
        (error as Error & { status?: number }).status === 401,
      'Se esperaba UnauthorizedException para token de sync invalido.',
    );
    return;
  }

  throw new Error('Se esperaba rechazo para token de sync invalido.');
}

async function main() {
  const env = {
    ...process.env,
    SYNC_MACHINE_TOKEN: 'super-sync-secret',
    SYNC_MACHINE_AUTH_ENABLED: 'true',
    SYNC_MACHINE_HEADER: 'x-sync-token',
  };

  const configService = new ConfigService({
    sync: getSyncRuntimeConfig(env),
  });
  const guard = new SyncMachineAuthGuard(configService);

  const headerRequest = createMockRequest({
    'x-sync-token': 'super-sync-secret',
  });
  const headerAllowed = await guard.canActivate(
    createExecutionContext(headerRequest),
  );

  assert(headerAllowed === true, 'El header de sync valido debio autenticar.');
  assert(
    (headerRequest.user as { rol?: Role } | undefined)?.rol === Role.Admin,
    'El cliente de sync debe mapearse como admin tecnico.',
  );

  const authorizationRequest = createMockRequest({
    authorization: 'Sync super-sync-secret',
  });
  const authorizationAllowed = await guard.canActivate(
    createExecutionContext(authorizationRequest),
  );

  assert(
    authorizationAllowed === true,
    'Authorization: Sync <token> debio autenticar.',
  );

  await expectUnauthorized(guard, {
    'x-sync-token': 'otro-token',
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        headerAuth: true,
        authorizationAuth: true,
        principalRole: (headerRequest.user as { rol?: Role }).rol ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
