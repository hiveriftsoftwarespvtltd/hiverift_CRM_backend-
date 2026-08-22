import { Controller, Post, Body, Get, UseGuards, Req, HttpCode, Header } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto) {
    const result = await this.authService.login(loginDto);
    return { message: 'Login successful', data: result };
  }
  
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: { userId: string; refreshToken: string }) {
    const tokens = await this.authService.refresh(body.userId, body.refreshToken);
    return { message: 'Tokens refreshed', data: tokens };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser('_id') userId: string) {
    await this.authService.logout(userId.toString());
    return { message: 'Logged out successfully', data: null };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  async getMe(@CurrentUser('_id') userId: string) {
    const user = await this.authService.getMe(userId.toString());
    return { message: 'Profile fetched', data: user };
  }
}
