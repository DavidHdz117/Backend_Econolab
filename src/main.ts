import type { INestApplication } from '@nestjs/common';
import type { NestApplicationOptions } from '@nestjs/common/interfaces/nest-application-options.interface';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionZodFilter } from './common/filters/http-exception-zod.filter';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';
import helmet from 'helmet';
import type { AppRuntimeConfig } from './config/app.config';

function normalizeOrigin(origin?: string | null) {
  return origin?.trim().replace(/\/+$/, '') ?? '';
}

async function configureApp(app: INestApplication) {
  const configService = app.get(ConfigService);
  const runtimeConfig = configService.getOrThrow<AppRuntimeConfig>('app');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  if (runtimeConfig.helmetEnabled) {
    app.use(helmet());
  }

  if (runtimeConfig.corsEnabled) {
    const allowedOrigins = new Set(
      runtimeConfig.corsOrigins
        .map((origin) => normalizeOrigin(origin))
        .filter(Boolean),
    );

    app.enableCors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        callback(null, allowedOrigins.has(normalizeOrigin(origin)));
      },
      methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      allowedHeaders: 'Content-Type, Authorization',
    });
  }

  app.useGlobalFilters(new HttpExceptionZodFilter());
  app.setGlobalPrefix(runtimeConfig.globalPrefix);

  return runtimeConfig;
}

export async function createConfiguredApp(options?: NestApplicationOptions) {
  const app = await NestFactory.create(AppModule, options);
  const runtimeConfig = await configureApp(app);

  return {
    app,
    runtimeConfig,
  };
}

export async function bootstrap() {
  const { app, runtimeConfig } = await createConfiguredApp();

  if (runtimeConfig.host) {
    await app.listen(runtimeConfig.port, runtimeConfig.host);
  } else {
    await app.listen(runtimeConfig.port);
  }

  console.log(
    `Server running on ${await app.getUrl()} [${runtimeConfig.runtimeMode}]`,
  );

  return app;
}

if (require.main === module) {
  void bootstrap();
}
