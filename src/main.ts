import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust Apache reverse proxy (1 hop) so X-Forwarded-For / req.ip work correctly
  app.set('trust proxy', 1);

  // Security
  app.use(helmet());
  app.use(cookieParser());

  // CORS
  const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000', 'https://onboarding.hiverift.com', 'https://crm.hiverift.com', 'https://hiveriftdesk.online']
    : true;

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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
  console.log(`📡 API: http://localhost:${port}/api/v1`);
}
bootstrap();