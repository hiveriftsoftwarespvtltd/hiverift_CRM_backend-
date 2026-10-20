import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'management')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get('overview')
  async getOverview(@Query() query: any) {
    const overview = await this.accountsService.getFinancialOverview(query);
    return { success: true, message: 'Financial overview fetched', data: overview };
  }

  @Get('categories')
  getCategories() {
    const categories = this.accountsService.getCategories();
    return { success: true, message: 'Categories fetched', data: categories };
  }

  // ==========================================
  // Accounts Endpoints
  // ==========================================
  @Get('list')
  async getAccounts() {
    const accounts = await this.accountsService.getAccounts();
    return { success: true, message: 'Accounts fetched', data: accounts };
  }

  @Post('list')
  async createAccount(@Body() dto: any, @CurrentUser() user: any) {
    const account = await this.accountsService.createAccount(dto, user._id.toString());
    return { success: true, message: 'Account created successfully', data: account };
  }

  @Put('list/:id')
  async updateAccount(@Param('id') id: string, @Body() dto: any) {
    const account = await this.accountsService.updateAccount(id, dto);
    return { success: true, message: 'Account updated successfully', data: account };
  }

  @Delete('list/:id')
  async deleteAccount(@Param('id') id: string, @Query('force') force?: string) {
    const res = await this.accountsService.deleteAccount(id, force === 'true');
    return { success: true, message: res.message, data: null };
  }

  // ==========================================
  // Transactions Endpoints
  // ==========================================
  @Get('transactions')
  async getTransactions(@Query() query: any) {
    const res = await this.accountsService.getTransactions(query);
    return { success: true, message: 'Transactions fetched', data: res };
  }

  @Post('transactions')
  async createTransaction(@Body() dto: any, @CurrentUser() user: any) {
    const txn = await this.accountsService.createTransaction(dto, user._id.toString());
    return { success: true, message: 'Transaction recorded successfully', data: txn };
  }

  @Delete('transactions/:id')
  async deleteTransaction(@Param('id') id: string) {
    const res = await this.accountsService.deleteTransaction(id);
    return { success: true, message: res.message, data: null };
  }
}
