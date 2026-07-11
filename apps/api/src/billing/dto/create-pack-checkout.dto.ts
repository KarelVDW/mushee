import { IsIn } from 'class-validator';

import type { PackId } from '../polar/packs';
import { PACK_IDS } from '../polar/packs';

export class CreatePackCheckoutDto {
  @IsIn(PACK_IDS)
  packId: PackId;
}
