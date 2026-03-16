import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionZodFilter } from './common/filters/http-exception-zod.filter';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.use(helmet());
  app.enableCors({
    origin: ['https://econolabe.netlify.app', 'http://localhost:5173'],
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
  });

  app.useGlobalFilters(new HttpExceptionZodFilter());
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 3000);
  console.log(`Server running on port ${await app.getUrl()}`);
}

bootstrap();
