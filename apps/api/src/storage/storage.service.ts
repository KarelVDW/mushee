import { Injectable, Logger } from '@nestjs/common';
import { resolve } from 'path';
import type { Writable } from 'stream';

import { GcsStorageProvider } from './gcs-storage.provider';
import { LocalStorageProvider } from './local-storage.provider';
import type { StorageProvider } from './storage-provider';

const DEFAULT_LOCAL_DIR = resolve(process.cwd(), 'storage');

/**
 * Blob storage for user data (score MusicXML, recording audio + debug
 * bundles), delegating to a {@link StorageProvider} picked from the
 * environment:
 *
 * - `STORAGE_DRIVER=gcs` (or just `GCS_BUCKET` set): Google Cloud Storage,
 *   authenticated via Application Default Credentials.
 * - `STORAGE_DRIVER=local` (default): the filesystem under
 *   `STORAGE_LOCAL_DIR` — a mounted volume in docker-compose/k8s-local.
 */
@Injectable()
export class StorageService implements StorageProvider {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: StorageProvider;

  constructor() {
    this.provider = this.resolveProvider();
    this.logger.log(`Storage backend: ${this.provider.name}`);
  }

  private resolveProvider(): StorageProvider {
    const driver =
      process.env.STORAGE_DRIVER ?? (process.env.GCS_BUCKET ? 'gcs' : 'local');
    if (driver === 'gcs') {
      const bucket = process.env.GCS_BUCKET;
      if (!bucket) {
        throw new Error('STORAGE_DRIVER=gcs requires GCS_BUCKET to be set');
      }
      return new GcsStorageProvider(bucket, process.env.GCS_PROJECT_ID);
    }
    if (driver !== 'local') {
      throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
    }
    return new LocalStorageProvider(
      process.env.STORAGE_LOCAL_DIR ?? DEFAULT_LOCAL_DIR,
    );
  }

  get name(): string {
    return this.provider.name;
  }

  async write(key: string, content: string | Buffer): Promise<void> {
    await this.provider.write(key, content);
    this.logger.log(`Wrote ${key} to storage`);
  }

  async read(key: string): Promise<string> {
    return this.provider.read(key);
  }

  createWriteStream(
    key: string,
    options?: { contentType?: string },
  ): Writable {
    return this.provider.createWriteStream(key, options);
  }

  async delete(key: string): Promise<void> {
    await this.provider.delete(key);
    this.logger.log(`Deleted ${key} from storage`);
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.provider.deletePrefix(prefix);
    this.logger.log(`Deleted prefix ${prefix} from storage`);
  }
}
