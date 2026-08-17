import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) throw new UnauthorizedException('Invalid email or password');
    if (!user.isActive) throw new UnauthorizedException('Your account has been deactivated. Contact admin.');

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid email or password');

    const tokens = await this.generateTokens(user._id.toString(), user.email, user.role);
    await this.usersService.updateRefreshToken(user._id.toString(), tokens.refreshToken);

    const userObj = user.toObject();
    delete (userObj as any).password;
    delete (userObj as any).refreshToken;

    return { ...tokens, user: userObj };
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.usersService.findByRefreshToken(userId, refreshToken);
    if (!user) throw new UnauthorizedException('Invalid refresh token. Please login again.');

    const tokens = await this.generateTokens(user._id.toString(), user.email, user.role);
    await this.usersService.updateRefreshToken(user._id.toString(), tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string) {
    await this.usersService.updateRefreshToken(userId, null);
    return { message: 'Logged out successfully' };
  }

  async getMe(userId: string) {
    return this.usersService.findOne(userId);
  }
  
  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: this.configService.get('ACCESS_TOKEN_TTL') || '30d',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('REFRESH_TOKEN_TTL') || '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
