import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DocumentsService } from './documents.service';
import {
  AddDocumentVersionDto,
  CreateDocumentDto,
} from './dto/create-document.dto';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  async create(@Request() req: any, @Body() dto: CreateDocumentDto) {
    return this.documentsService.create(req.user._id, dto);
  }

  @Get('expiring')
  async getExpiring(@Query('days') days?: string) {
    const threshold = days ? parseInt(days, 10) : 30;
    return this.documentsService.getExpiringDocuments(threshold);
  }

  @Get()
  async findAll(@Request() req: any, @Query() query: any) {
    return this.documentsService.findAll(req.user, query);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.documentsService.findOne(id, req.user);
  }

  @Post(':id/version')
  async addVersion(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AddDocumentVersionDto,
  ) {
    return this.documentsService.addVersion(id, req.user._id, dto);
  }

  @Delete(':id')
  async archive(@Param('id') id: string) {
    return this.documentsService.archive(id);
  }
}

