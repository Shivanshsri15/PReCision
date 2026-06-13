import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AnalyzePrDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxFiles?: number;
}
