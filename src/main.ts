import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { json, urlencoded } from 'express';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Increase payload limit for sending images / attachments as base64 or large bodies
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Trust Apache reverse proxy (1 hop) so X-Forwarded-For / req.ip work correctly


  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
  // Global Pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global Filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global Interceptors
  app.useGlobalInterceptors(new TransformInterceptor());

  const port = process.env.PORT || 5000;
  await app.listen(port);
  // console.log(`📡 API Base Endpoint: https://api.hiveriftdesk.online/api/v1 (Meta Incoming Webhook Active)`);
  console.log(`📡 API Base Endpoint: http://localhost:${port}/api/v1 (Meta Incoming Webhook Active)`);
  // console.log(`📡 API Base Endpoint: https://hiveriftdesk.online/hiveriftCRM-backend/api/v1 (Meta Incoming Webhook Active)`);
}
bootstrap();