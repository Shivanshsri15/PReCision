import { IsString, MinLength } from 'class-validator';

export class SaveGeminiKeyDto {
  @IsString()
  @MinLength(20, { message: 'apiKey does not look like a valid Gemini API key' })
  apiKey!: string;
}
