import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Clients, ClientsSchema } from '../schemas/user.schema.js';
import { TokenEncryptionService } from '../common/services/token-encryption.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GeminiKeyService } from './gemini-key.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { jwtConfig } from './jwt.config.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Clients.name, schema: ClientsSchema }]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => jwtConfig(config),
  }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, TokenEncryptionService, GeminiKeyService],
  exports: [AuthService, TokenEncryptionService, GeminiKeyService, JwtModule],
})
export class AuthModule {}
