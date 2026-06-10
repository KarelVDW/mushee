import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * MusicXML-JSON wire format produced by the web app's ScoreSerializer
 * (apps/web/src/model/util/ScoreSerializer.ts) and mirrored by the types in
 * apps/web/src/components/notation/types.ts. Only entry kinds the serializer
 * actually emits are accepted (note, attributes, direction, barline) — backup,
 * forward, stems and beams can be added once MusicXML import produces them.
 */

const MXML_STEPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
const MXML_NOTE_TYPES = ['whole', 'half', 'quarter', 'eighth', '16th'] as const;
const MXML_CLEF_SIGNS = ['G', 'F', 'C', 'percussion', 'TAB', 'none'] as const;
const MXML_BAR_STYLES = [
  'regular',
  'light-light',
  'light-heavy',
  'none',
] as const;
const MXML_ENTRY_TYPES = ['note', 'attributes', 'direction', 'barline'] as const;

export class MxmlPitchDto {
  @IsIn(MXML_STEPS)
  step: string;

  @IsOptional()
  @IsInt()
  @Min(-2)
  @Max(2)
  alter?: number;

  @IsInt()
  @Min(0)
  @Max(9)
  octave: number;
}

export class MxmlRestDto {
  @IsOptional()
  @IsBoolean()
  measure?: boolean;
}

export class MxmlTieDto {
  @IsIn(['start', 'stop'])
  type: string;
}

export class MxmlTimeModificationDto {
  @IsInt()
  @Min(1)
  @Max(16)
  actualNotes: number;

  @IsInt()
  @Min(1)
  @Max(16)
  normalNotes: number;
}

export class MxmlKeyDto {
  @IsInt()
  @Min(-7)
  @Max(7)
  fifths: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mode?: string;
}

export class MxmlTimeDto {
  // e.g. '4' or additive meters like '3+2'
  @IsString()
  @Matches(/^\d{1,2}(\+\d{1,2})*$/)
  beats: string;

  @IsString()
  @Matches(/^\d{1,2}$/)
  beatType: string;
}

export class MxmlClefDto {
  @IsIn(MXML_CLEF_SIGNS)
  sign: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  line?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  number?: number;

  @IsOptional()
  @IsInt()
  @Min(-2)
  @Max(2)
  clefOctaveChange?: number;
}

export class MxmlTransposeDto {
  @IsInt()
  @Min(-24)
  @Max(24)
  chromatic: number;

  @IsOptional()
  @IsInt()
  @Min(-14)
  @Max(14)
  diatonic?: number;

  @IsOptional()
  @IsInt()
  @Min(-2)
  @Max(2)
  octaveChange?: number;
}

export class MxmlSoundDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  tempo?: number;
}

export class MxmlMeasureEntryDto {
  @IsIn(MXML_ENTRY_TYPES)
  _type: string;
}

export class MxmlNoteDto extends MxmlMeasureEntryDto {
  // A note carries either a pitch or a rest marker — pitch is required when rest is absent.
  @ValidateIf((note: MxmlNoteDto) => note.rest === undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => MxmlPitchDto)
  pitch?: MxmlPitchDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MxmlRestDto)
  rest?: MxmlRestDto;

  // In divisions (12 per quarter); 1920 covers MusicXML's common 480-per-quarter convention.
  @IsInt()
  @Min(1)
  @Max(1920)
  duration: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,2}$/)
  voice?: string;

  @IsIn(MXML_NOTE_TYPES)
  type: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  dot?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => MxmlTieDto)
  tie?: MxmlTieDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MxmlTimeModificationDto)
  timeModification?: MxmlTimeModificationDto;
}

export class MxmlAttributesDto extends MxmlMeasureEntryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(960)
  divisions?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => MxmlKeyDto)
  key?: MxmlKeyDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => MxmlTimeDto)
  time?: MxmlTimeDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  staves?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => MxmlClefDto)
  clef?: MxmlClefDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MxmlTransposeDto)
  transpose?: MxmlTransposeDto;
}

export class MxmlDirectionDto extends MxmlMeasureEntryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => MxmlSoundDto)
  sound?: MxmlSoundDto;
}

export class MxmlBarlineDto extends MxmlMeasureEntryDto {
  @IsOptional()
  @IsIn(['left', 'right', 'middle'])
  location?: string;

  @IsOptional()
  @IsIn(MXML_BAR_STYLES)
  barStyle?: string;
}

export class MxmlMeasureDto {
  @IsString()
  @Matches(/^\d{1,6}$/)
  number: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MxmlMeasureEntryDto, {
    discriminator: {
      property: '_type',
      subTypes: [
        { value: MxmlNoteDto, name: 'note' },
        { value: MxmlAttributesDto, name: 'attributes' },
        { value: MxmlDirectionDto, name: 'direction' },
        { value: MxmlBarlineDto, name: 'barline' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  entries: MxmlMeasureEntryDto[];
}

export class MxmlScoreInstrumentDto {
  @IsString()
  @MaxLength(50)
  id: string;

  @IsString()
  @MaxLength(100)
  instrumentName: string;
}

export class MxmlMidiInstrumentDto {
  @IsString()
  @MaxLength(50)
  id: string;

  // 1-indexed General MIDI program (MusicXML convention).
  @IsInt()
  @Min(1)
  @Max(128)
  midiProgram: number;
}

export class MxmlScorePartDto {
  @IsString()
  @MaxLength(50)
  id: string;

  @IsString()
  @MaxLength(100)
  partName: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MxmlScoreInstrumentDto)
  scoreInstrument?: MxmlScoreInstrumentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MxmlMidiInstrumentDto)
  midiInstrument?: MxmlMidiInstrumentDto;
}

export class MxmlPartListDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => MxmlScorePartDto)
  scoreParts: MxmlScorePartDto[];
}

export class MxmlPartDto {
  @IsString()
  @MaxLength(50)
  id: string;

  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => MxmlMeasureDto)
  measures: MxmlMeasureDto[];
}

export class ScorePartwiseDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MxmlPartListDto)
  partList: MxmlPartListDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => MxmlPartDto)
  parts: MxmlPartDto[];
}
