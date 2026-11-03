import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RecruitmentService } from './recruitment.service';
import { CreateJobRequisitionDto } from './dto/create-requisition.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { AddScorecardDto } from './dto/add-scorecard.dto';
import { CreateOfferDto, ConvertEmployeeDto } from './dto/create-offer.dto';
import { CandidateStage } from './schemas/candidate.schema';

@Controller('recruitment')
@UseGuards(JwtAuthGuard)
export class RecruitmentController {
  constructor(private readonly recruitmentService: RecruitmentService) {}

  // ================= Requisitions =================

  @Post('requisitions')
  async createRequisition(
    @Request() req: any,
    @Body() dto: CreateJobRequisitionDto,
  ) {
    return this.recruitmentService.createRequisition(req.user._id, dto);
  }

  @Get('requisitions')
  async findAllRequisitions(@Query() query: any) {
    return this.recruitmentService.findAllRequisitions(query);
  }

  @Get('requisitions/:id')
  async findRequisitionById(@Param('id') id: string) {
    return this.recruitmentService.findRequisitionById(id);
  }

  // ================= Candidates =================

  @Post('candidates')
  async createCandidate(@Request() req: any, @Body() dto: CreateCandidateDto) {
    return this.recruitmentService.createCandidate(req.user._id, dto);
  }

  @Get('candidates')
  async findAllCandidates(@Query() query: any) {
    return this.recruitmentService.findAllCandidates(query);
  }

  @Get('candidates/:id')
  async findCandidateById(@Param('id') id: string) {
    return this.recruitmentService.findCandidateById(id);
  }

  @Put('candidates/:id/stage')
  async updateStage(
    @Request() req: any,
    @Param('id') id: string,
    @Body('stage') stage: CandidateStage,
    @Body('notes') notes?: string,
    @Body('rejectionReason') rejectionReason?: string,
  ) {
    return this.recruitmentService.updateStage(
      id,
      req.user._id,
      stage,
      notes,
      rejectionReason,
    );
  }

  @Post('candidates/:id/scorecards')
  async addScorecard(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AddScorecardDto,
  ) {
    return this.recruitmentService.addScorecard(id, req.user._id, dto);
  }

  @Post('candidates/:id/offer')
  async manageOffer(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateOfferDto,
  ) {
    return this.recruitmentService.manageOffer(id, req.user._id, dto);
  }

  @Post('candidates/:id/convert-to-employee')
  async convertToEmployee(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ConvertEmployeeDto,
  ) {
    return this.recruitmentService.convertToEmployee(id, req.user._id, dto);
  }
}

