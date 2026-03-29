# Backend Runtime Modes

## Objetivo

Este backend NestJS queda preparado para convivir con tres modos de ejecucion sin romper el flujo web actual:

- `web-online`
- `desktop-online`
- `desktop-offline`

La compatibilidad offline no cambia hoy los contratos HTTP existentes. Lo que si cambia es la infraestructura que rodea al backend: base de datos, storage, integraciones externas y cola de sincronizacion.

## Defaults por runtime

### `web-online`

- Base esperada: `postgres`
- Outbox de sync: desactivada por default
- Fotos de perfil: `database`
- Mail y OAuth: activos por default
- Uso recomendado: backend servidor central

### `desktop-online`

- Base recomendada: `sqlite`
- Outbox de sync: activada por default
- Fotos de perfil: `filesystem`
- Mail y OAuth: activos si hay credenciales
- Uso recomendado: escritorio conectado con sync posterior

### `desktop-offline`

- Base recomendada: `sqlite`
- Outbox de sync: activada por default
- Fotos de perfil: `filesystem`
- Mail y OAuth: desactivados por default
- Uso recomendado: escritorio local con trabajo offline y sincronizacion diferida

## Variables importantes

- `APP_RUNTIME_MODE`
- `DATABASE_TYPE`
- `DATABASE_SQLITE_PATH`
- `DATABASE_SYNCHRONIZE=false`
- `DATABASE_LOGGING=false`
- `SYNC_OUTBOX_ENABLED`
- `SYNC_MACHINE_TOKEN`
- `APP_PROFILE_IMAGE_STORAGE_MODE`

## Recomendaciones para hardware modesto

- Preferir `sqlite` en runtimes desktop.
- Mantener `DATABASE_LOGGING=false`.
- Mantener `DATABASE_SYNCHRONIZE=false` fuera de bootstrap controlado.
- Usar `filesystem` para fotos de perfil en desktop.
- Mantener `SYNC_OUTBOX_BATCH_SIZE` pequeno o moderado. Un valor entre `25` y `100` suele ser razonable.
- Evitar habilitar mail/OAuth en `desktop-offline`.

## Smokes operativos

Comandos utiles para validar el backend sin tocar frontend:

```bash
npm run build
npm run test -- --runTestsByPath src/app.controller.spec.ts
npm run runtime:modes:smoke
npm run runtime:bootstrap:smoke
npm run runtime:bootstrap:prod:smoke
npm run db:sqlite:init
npm run db:sync-state:smoke
npm run db:sync-outbox:smoke
npm run db:sync-inbound:smoke
npm run sync:machine-auth:smoke
```

## Endpoints operativos

- `GET /api/runtime/diagnostics`
- `GET /api/sync/outbox/summary`
- `POST /api/sync/outbox/claim`
- `POST /api/sync/outbox/ack`
- `POST /api/sync/outbox/fail`
- `POST /api/sync/outbox/requeue`
- `POST /api/sync/outbox/inbound/apply`

Los endpoints de sync aceptan JWT admin o autenticacion tecnica con `SYNC_MACHINE_TOKEN` via header `x-sync-token` o `Authorization: Sync <token>`.
