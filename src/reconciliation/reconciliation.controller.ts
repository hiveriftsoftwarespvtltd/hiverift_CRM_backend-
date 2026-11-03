import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ReconciliationService } from './reconciliation.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

@Controller('reconciliation')
@UseGuards(JwtAuthGuard)
export class ReconciliationController {
  constructor(private readonly reconService: ReconciliationService) {}

  @Post('credit-notes')
  async createCreditNote(
    @Request() req: any,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.reconService.createCreditNote(req.user._id, dto);
  }

  @Get('credit-notes')
  async getAllCreditNotes(@Query() query: any) {
    return this.reconService.getAllCreditNotes(query);
  }

  @Get('ar-ageing')
  async getArAgeing() {
    return this.reconService.getArAgeingSummary();
  }

  @Get('ap-ageing')
  async getApAgeing() {
    return this.reconService.getApAgeingSummary();
  }

  @Get('summary')
  async getSummary() {
    return this.reconService.getReconciliationSummary();
  }
}

