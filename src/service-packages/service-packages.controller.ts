import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ServicePackagesService } from './service-packages.service';
import { CreateServicePackageDto } from './dto/create-service-package.dto';
import { UpdateServicePackageDto } from './dto/update-service-package.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('service-packages')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServicePackagesController {
  constructor(private readonly packagesService: ServicePackagesService) {}

  @Post()
  @Roles('admin', 'management')
  async create(@Body() dto: CreateServicePackageDto, @CurrentUser() user: any) {
    const pkg = await this.packagesService.create(dto, user);
    return { success: true, message: 'Service package created successfully', data: pkg };
  }

  @Get()
  async findAll(@Query() query: any) {
    const result = await this.packagesService.findAll(query);
    return { success: true, message: 'Service packages fetched successfully', data: result };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const pkg = await this.packagesService.findOne(id);
    return { success: true, message: 'Service package fetched', data: pkg };
  }

  @Put(':id')
  @Roles('admin', 'management')
  async update(@Param('id') id: string, @Body() dto: UpdateServicePackageDto) {
    const pkg = await this.packagesService.update(id, dto);
    return { success: true, message: 'Service package updated successfully', data: pkg };
  }

  @Delete(':id')
  @Roles('admin', 'management')
  async remove(@Param('id') id: string) {
    await this.packagesService.remove(id);
    return { success: true, message: 'Service package deleted successfully', data: null };
  }
}

