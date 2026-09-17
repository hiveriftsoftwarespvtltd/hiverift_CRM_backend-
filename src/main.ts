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
  app.set('trust proxy', 1);

  // Security - allow cross-origin media loading (e.g. frontend img tags)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.includes('hiveriftdesk.online') ||
        origin.includes('hiverift.com') ||
        origin.includes('onboarding.hiverift.com')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  });

  // Rate Limiting
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 2000, // Increased limit so polling and dev testing never hit 429
      skip: (req) => process.env.NODE_ENV !== 'production' || req.ip === '127.0.0.1' || req.ip === '::1',
      message: { success: false, message: 'Too many requests, please try again later.' },
    }),
  );

  // Global Prefix
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
  console.log(`🚀 HiveRift CRM Backend running on port ${port}`);
  console.log(`📡 API Base Endpoint: http://localhost:${port}/api/v1 (Meta Incoming Webhook Active)`);
  // console.log(`📡 API Base Endpoint: https://hiveriftdesk.online/hiveriftCRM-backend/api/v1 (Meta Incoming Webhook Active)`);
}
bootstrap();