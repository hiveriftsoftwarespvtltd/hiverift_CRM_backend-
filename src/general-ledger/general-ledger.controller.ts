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
import { GeneralLedgerService } from './general-ledger.service';
import {
  CreateChartOfAccountDto,
  LockPeriodDto,
} from './dto/create-account.dto';
import {
  CreateJournalEntryDto,
  ReverseJournalDto,
} from './dto/create-journal.dto';

@Controller('general-ledger')
@UseGuards(JwtAuthGuard)
export class GeneralLedgerController {
  constructor(private readonly glService: GeneralLedgerService) {}

  // ================= Chart of Accounts =================

  @Post('accounts')
  async createAccount(
    @Request() req: any,
    @Body() dto: CreateChartOfAccountDto,
  ) {
    return this.glService.createAccount(req.user._id, dto);
  }

  @Get('accounts')
  async getAllAccounts(@Query() query: any) {
    return this.glService.getAllAccounts(query);
  }

  // ================= Journals =================

  @Post('journals')
  async createAndPostJournal(
    @Request() req: any,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.glService.createAndPostJournal(req.user._id, dto);
  }

  @Get('journals')
  async getJournals(@Query() query: any) {
    return this.glService.getJournals(query);
  }

  @Get('journals/:id')
  async getJournalById(@Param('id') id: string) {
    return this.glService.getJournalById(id);
  }

  @Post('journals/:id/reverse')
  async reverseJournal(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReverseJournalDto,
  ) {
    return this.glService.reverseJournal(id, req.user._id, dto);
  }

  // ================= Trial Balance =================

  @Get('trial-balance')
  async getTrialBalance(@Query('asOfDate') asOfDate?: string) {
    return this.glService.getTrialBalance(asOfDate);
  }

  // ================= Period Controls =================

  @Post('periods/lock')
  async lockPeriod(@Request() req: any, @Body() dto: LockPeriodDto) {
    return this.glService.lockPeriod(req.user._id, dto);
  }

  @Get('periods')
  async getPeriods() {
    return this.glService.getPeriods();
  }
}

