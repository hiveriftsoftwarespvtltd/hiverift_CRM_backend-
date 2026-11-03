import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('quotations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  async create(@Body() dto: any, @CurrentUser() user: any) {
    const q = await this.quotationsService.create(dto, user._id.toString(), user.role);
    return { message: 'Quotation created', data: q };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.quotationsService.findAll(query, user);
    return { message: 'Quotations fetched', data: result };
  }

  // ==========================================
  // Public Client Portal Endpoints
  // ==========================================
  @Public()
  @Get('public/:id')
  async getPublicProposal(@Param('id') id: string) {
    const proposal = await this.quotationsService.getPublicQuotation(id);
    return { success: true, message: 'Proposal fetched', data: proposal };
  }

  @Public()
  @Post('public/:id/accept')
  async acceptPublicProposal(
    @Param('id') id: string,
    @Body() body: {
      notes?: string;
      approvedByName?: string;
      approvedByEmail?: string;
      approvedByPhone?: string;
      signerName?: string;
      signerEmail?: string;
      ipAddress?: string;
    }
  ) {
    const result = await this.quotationsService.acceptPublicProposal(id, body);
    return { success: true, message: result.message, data: result };
  }

  @Public()
  @Post('public/:id/request-changes')
  async requestChangesPublic(@Param('id') id: string, @Body() body: { feedback: string }) {
    const result = await this.quotationsService.requestChangesPublic(id, body.feedback || 'Revision requested');
    return { success: true, message: result.message, data: result };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    const q = await this.quotationsService.findOne(id, user);
    return { message: 'Quotation fetched', data: q };
  }

  @Get(':id/versions')
  async getVersions(@Param('id') id: string) {
    const versions = await this.quotationsService.getVersionHistory(id);
    return { message: 'Version history fetched', data: versions };
  }

  @Post(':id/create-revision')
  async createRevision(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    const revision = await this.quotationsService.createRevision(
      id,
      body,
      user._id.toString(),
      user.role,
    );
    return { message: `Quotation revision ${revision.quotationNo} created successfully`, data: revision };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: any) {
    const q = await this.quotationsService.update(id, dto, user);
    return { message: 'Quotation updated', data: q };
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }, @CurrentUser() user: any) {
    const q = await this.quotationsService.updateStatus(id, body.status, user);
    return { message: 'Quotation status updated', data: q };
  }

  @Post(':id/request-approval')
  async requestApproval(@Param('id') id: string, @CurrentUser() user: any) {
    const q = await this.quotationsService.requestApproval(id, user);
    return { message: 'Approval request submitted to SuperAdmin', data: q };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() user: any) {
    const q = await this.quotationsService.approve(id, user);
    return { message: 'Quotation approved successfully', data: q };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: any) {
    const q = await this.quotationsService.reject(id, body.reason, user);
    return { message: 'Quotation rejected', data: q };
  }

  @Post(':id/send-email')
  async sendEmail(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.quotationsService.sendEmail(id, user);
    return { message: result.message, data: result };
  }

  @Post(':id/send')
  async send(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.quotationsService.sendEmail(id, user);
    return { message: result.message, data: result };
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { ids: string[] }, @CurrentUser() user: any) {
    const result = await this.quotationsService.bulkDelete(body.ids || [], user);
    return { message: `${result.count} Quotations deleted successfully`, data: result };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.quotationsService.remove(id, user);
    return { message: 'Quotation deleted', data: null };
  }
}
