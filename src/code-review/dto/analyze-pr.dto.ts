import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AnalyzePrDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxFiles?: number;

  /**
   * If true, fetch file contents from the PR head SHA when GitHub doesn't provide a patch
   * (e.g. binary/large diffs). This costs extra GitHub API calls.
   */
  @IsOptional()
  @IsBoolean()
  includeContent?: boolean;
}

