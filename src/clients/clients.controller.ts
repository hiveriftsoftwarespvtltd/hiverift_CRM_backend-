import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @Roles('admin', 'management', 'sales')
  async create(@Body() dto: CreateClientDto, @CurrentUser() user: any) {
    const client = await this.clientsService.create(dto, user._id.toString());
    return { message: 'Client created successfully', data: client };
  }

  @Get()
  async findAll(@Query() query: any) {
    const result = await this.clientsService.findAll(query);
    return { message: 'Clients fetched', data: result };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const client = await this.clientsService.findOne(id);
    return { message: 'Client fetched', data: client };
  }

  @Put(':id')
  @Roles('admin', 'management', 'sales')
  async update(@Param('id') id: string, @Body() dto: any) {
    const client = await this.clientsService.update(id, dto);
    return { message: 'Client updated', data: client };
  }

  @Delete(':id')
  @Roles('admin')
  async remove(@Param('id') id: string) {
    await this.clientsService.remove(id);
    return { message: 'Client deleted', data: null };
  }
}
