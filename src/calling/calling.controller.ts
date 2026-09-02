import { Controller, Get, Post, Body, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { CallingService } from './calling.service';
import { UploadBatchDto, AssignContactsDto, LogCallDto } from './dto/calling.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('calling')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'management', 'sales')
export class CallingController {
  constructor(private readonly callingService: CallingService) { }

  @Post('upload')
  async uploadBatch(@Body() dto: UploadBatchDto, @CurrentUser() user: any) {
    const result = await this.callingService.uploadBatch(dto, user._id.toString());
    return { message: 'Calling batch uploaded and distributed successfully', data: result };
  }

  @Post('assign')
  async assignContacts(@Body() dto: AssignContactsDto, @CurrentUser() user: any) {
    const result = await this.callingService.assignOrSplit(dto, user._id.toString());
    return { message: 'Contacts assigned successfully', data: result };
  }

  @Get('my-queue')
  async getMyQueue(@CurrentUser() user: any, @Query() query: any) {
    const result = await this.callingService.getMyQueue(user._id.toString(), query);
    return { message: 'My calling queue fetched', data: result };
  }

  @Get('contacts')
  async getAllContacts(@Query() query: any) {
    const result = await this.callingService.getAllContacts(query);
    return { message: 'All contacts fetched', data: result };
  }

  @Get('batches')
  async getBatches(@Query() query: any) {
    const result = await this.callingService.getBatches(query);
    return { message: 'Batches fetched', data: result };
  }
  
  @Post('log-call/:id')
  async logCall(@Param('id') id: string, @Body() dto: LogCallDto, @CurrentUser() user: any) {
    const result = await this.callingService.logCall(id, user._id.toString(), dto);
    return { message: 'Call attempt logged successfully', data: result };
  }

  @Post('convert-to-lead/:id')
  async convertToLead(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.callingService.convertToLead(id, user._id.toString());
    return { message: 'Contact converted to Lead', data: result };
  }

  @Get('stats')
  async getStats() {
    const result = await this.callingService.getStats();
    return { message: 'Calling stats fetched', data: result };
  }

  @Delete('batches/:id')
  @Roles('admin', 'management')
  async deleteBatch(@Param('id') id: string) {
    await this.callingService.deleteBatch(id);
    return { message: 'Batch deleted successfully', data: null };
  }

  @Delete('contacts/:id')
  async deleteContact(@Param('id') id: string) {
    await this.callingService.deleteContact(id);
    return { message: 'Contact deleted successfully', data: null };
  }
}
