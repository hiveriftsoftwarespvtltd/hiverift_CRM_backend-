import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServicePackagesController } from './service-packages.controller';
import { ServicePackagesService } from './service-packages.service';
import { ServicePackage, ServicePackageSchema } from './schemas/service-package.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ServicePackage.name, schema: ServicePackageSchema },
    ]),
  ],
  controllers: [ServicePackagesController],
  providers: [ServicePackagesService],
  exports: [ServicePackagesService],
})
export class ServicePackagesModule {}

