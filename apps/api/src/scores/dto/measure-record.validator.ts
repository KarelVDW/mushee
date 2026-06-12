import { plainToInstance } from 'class-transformer';
import {
  registerDecorator,
  validateSync,
  ValidationArguments,
  ValidationError,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { MxmlMeasureDto } from './mxml.dto';

/**
 * Validates a Record<measureIndex, MxmlMeasure>. class-validator has no native
 * support for records with dynamic keys, so each value is validated against
 * MxmlMeasureDto here. Keys must be plain integer indices — they are spliced
 * into `jsonb_set` paths in raw SQL (cache.service.ts), so anything else
 * would allow update-path/SQL injection.
 */
@ValidatorConstraint({ name: 'isMeasureRecord', async: false })
export class MeasureRecordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return this.collectErrors(value).length === 0;
  }

  defaultMessage(args: ValidationArguments): string {
    return this.collectErrors(args.value).join('; ');
  }

  private collectErrors(value: unknown): string[] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return ['measures must be an object mapping measure indices to measures'];
    }
    const errors: string[] = [];
    for (const [key, measure] of Object.entries(value)) {
      if (!/^\d{1,6}$/.test(key)) {
        errors.push(`measures key "${key}" must be a measure index`);
        continue;
      }
      if (typeof measure !== 'object' || measure === null || Array.isArray(measure)) {
        errors.push(`measures.${key} must be a measure object`);
        continue;
      }
      const instance = plainToInstance(MxmlMeasureDto, measure);
      for (const error of validateSync(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      })) {
        errors.push(...this.flatten(error, `measures.${key}`));
      }
    }
    return errors;
  }

  private flatten(error: ValidationError, path: string): string[] {
    const here = `${path}.${error.property}`;
    const messages = Object.values(error.constraints ?? {}).map(
      (message) => `${here}: ${message}`,
    );
    for (const child of error.children ?? []) {
      messages.push(...this.flatten(child, here));
    }
    return messages;
  }
}

export function IsMeasureRecord(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: MeasureRecordConstraint,
    });
  };
}
