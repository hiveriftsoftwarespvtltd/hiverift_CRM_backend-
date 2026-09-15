import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings() {
    const settings = await this.settingsService.getSettings();
    return {
      success: true,
      message: 'System settings fetched successfully',
      data: settings,
    };
  }

  @Put()
  @Roles('admin', 'management')
  async updateSettings(@Body() body: any, @CurrentUser() user: any) {
    const settings = await this.settingsService.updateSettings(body, user._id || user.id);
    return {
      success: true,
      message: 'System settings updated successfully',
      data: settings,
    };
  }
}
