import { Body, Controller, Delete, Get, Put, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { SaveGeminiKeyDto } from './dto/save-gemini-key.dto.js';
import { GeminiKeyService } from './gemini-key.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuthenticatedUser } from './types/authenticated-user.type.js';

@Controller('/api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly geminiKeyService: GeminiKeyService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('/me')
  me(@Request() req: { user: AuthenticatedUser }) {
    return this.authService.validateAndGetUser(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/gemini-key')
  async getGeminiKeyStatus(@Request() req: { user: AuthenticatedUser }) {
    return { configured: await this.geminiKeyService.hasUserKey(req.user.userId) };
  }

  @UseGuards(JwtAuthGuard)
  @Put('/gemini-key')
  async saveGeminiKey(
    @Request() req: { user: AuthenticatedUser },
    @Body() dto: SaveGeminiKeyDto,
  ) {
    await this.geminiKeyService.save(req.user.userId, dto.apiKey);
    return { configured: true };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('/gemini-key')
  async deleteGeminiKey(@Request() req: { user: AuthenticatedUser }) {
    await this.geminiKeyService.remove(req.user.userId);
    return { configured: false };
  }
}
