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
import { ProcurementService } from './procurement.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import {
  AssignSeatDto,
  CreatePurchaseOrderDto,
  CreateSoftwareLicenceDto,
} from './dto/create-po.dto';

@Controller('procurement')
@UseGuards(JwtAuthGuard)
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  // ================= Vendors =================

  @Post('vendors')
  async createVendor(@Request() req: any, @Body() dto: CreateVendorDto) {
    return this.procurementService.createVendor(req.user._id, dto);
  }

  @Get('vendors')
  async getAllVendors(@Query() query: any) {
    return this.procurementService.getAllVendors(query);
  }

  @Get('vendors/:id')
  async getVendorById(@Param('id') id: string) {
    return this.procurementService.getVendorById(id);
  }

  // ================= Purchase Orders =================

  @Post('purchase-orders')
  async createPurchaseOrder(
    @Request() req: any,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.procurementService.createPurchaseOrder(req.user._id, dto);
  }

  @Get('purchase-orders')
  async getAllPurchaseOrders(@Query() query: any) {
    return this.procurementService.getAllPurchaseOrders(query);
  }

  @Post('purchase-orders/:id/approve')
  async approvePurchaseOrder(
    @Request() req: any,
    @Param('id') id: string,
    @Body('notes') notes?: string,
  ) {
    return this.procurementService.approvePurchaseOrder(id, req.user._id, notes);
  }

  @Post('purchase-orders/:id/receive')
  async receiveGoodsAndPostAP(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.procurementService.receiveGoodsAndPostAP(id, req.user._id);
  }

  // ================= Software Licences =================

  @Post('licences')
  async createSoftwareLicence(
    @Request() req: any,
    @Body() dto: CreateSoftwareLicenceDto,
  ) {
    return this.procurementService.createSoftwareLicence(req.user._id, dto);
  }

  @Get('licences')
  async getAllSoftwareLicences() {
    return this.procurementService.getAllSoftwareLicences();
  }

  @Post('licences/:id/assign-seat')
  async assignSeat(
    @Param('id') id: string,
    @Body() dto: AssignSeatDto,
  ) {
    return this.procurementService.assignSeat(id, dto);
  }

  @Get('licences/expiring')
  async getExpiringLicences(@Query('days') days?: string) {
    const threshold = days ? parseInt(days, 10) : 30;
    return this.procurementService.getExpiringLicences(threshold);
  }
}

