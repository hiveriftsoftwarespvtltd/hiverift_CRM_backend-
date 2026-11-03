import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TimesheetsService } from './timesheets.service';
import {
  ApproveTimesheetDto,
  GenerateTimesheetDto,
} from './dto/generate-timesheet.dto';

@Controller('timesheets')
@UseGuards(JwtAuthGuard)
export class TimesheetsController {
  constructor(private readonly timesheetsService: TimesheetsService) {}

  @Post('generate')
  async generateWeeklyTimesheet(
    @Request() req: any,
    @Body() dto: GenerateTimesheetDto,
  ) {
    return this.timesheetsService.generateWeeklyTimesheet(req.user._id, dto);
  }

  @Post(':id/submit')
  async submit(@Request() req: any, @Param('id') id: string) {
    return this.timesheetsService.submit(id, req.user._id);
  }

  @Post(':id/decision')
  async approveOrReject(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ApproveTimesheetDto,
  ) {
    return this.timesheetsService.approveOrReject(id, req.user, dto);
  }

  @Get('pending')
  async findPending() {
    return this.timesheetsService.findPending();
  }

  @Get('my-timesheets')
  async getMyTimesheets(@Request() req: any) {
    return this.timesheetsService.getMyTimesheets(req.user._id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.timesheetsService.findOne(id);
  }
}

