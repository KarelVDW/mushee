export class UpdateScoreDto {
  title?: string;
  measures?: Record<string, Record<string, unknown>>;
  allMeasures?: Record<string, unknown>[];
}
