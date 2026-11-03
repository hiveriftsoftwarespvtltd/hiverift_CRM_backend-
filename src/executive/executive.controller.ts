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
import { ExecutiveService } from './executive.service';
import { CloseMonthDto } from './dto/close-month.dto';

@Controller('executive')
@UseGuards(JwtAuthGuard)
export class ExecutiveController {
  constructor(private readonly executiveService: ExecutiveService) {}

  @Get('snapshots/current')
  async getCurrentSnapshot(@Query('period') period?: string) {
    return this.executiveService.calculateLiveMetrics(period);
  }

  @Post('snapshots/close-month')
  async closeMonth(@Request() req: any, @Body() dto: CloseMonthDto) {
    return this.executiveService.closeMonth(req.user._id, dto);
  }

  @Get('snapshots/history')
  async getSnapshotHistory() {
    return this.executiveService.getSnapshotHistory();
  }

  @Get('snapshots/:period')
  async getSnapshotByPeriod(@Param('period') period: string) {
    return this.executiveService.getSnapshotByPeriod(period);
  }
}

