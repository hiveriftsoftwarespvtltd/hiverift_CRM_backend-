import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApprovalsService } from './approvals.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';

@Controller('approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post('request')
  async createRequest(@Request() req: any, @Body() dto: CreateApprovalRequestDto) {
    return this.approvalsService.createRequest(req.user._id, dto);
  }

  @Get('pending')
  async getPending(@Request() req: any) {
    return this.approvalsService.findPendingForUser(req.user._id, req.user.role);
  }

  @Get('entity/:type/:id')
  async getHistoryForEntity(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.approvalsService.findHistoryForEntity(type, id);
  }

  @Post(':id/decision')
  async decide(
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: DecideApprovalDto,
  ) {
    return this.approvalsService.decide(id, req.user._id, req.user.role, dto);
  }

  @Get()
  async findAll(@Query() query: any) {
    return this.approvalsService.findAll(query);
  }
}
