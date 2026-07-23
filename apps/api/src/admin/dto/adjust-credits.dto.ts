import { IsInt, Max, Min, NotEquals } from 'class-validator';

export class AdjustCreditsDto {
  /** Pack seconds to add (positive) or claw back (negative). ±100 hours max
   *  per call — fat-finger protection, not a business rule. */
  @IsInt()
  @NotEquals(0)
  @Min(-360000)
  @Max(360000)
  seconds: number;
}
