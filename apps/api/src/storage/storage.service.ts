import { Injectable, Logger } from '@nestjs/common';
import { execa } from 'execa';
import { readFile, writeFile } from 'fs/promises';
import { file as tmpFile } from 'tmp-promise';

/** A hung rclone (dead remote) must not stall requests indefinitely. */
const RCLONE_TIMEOUT_MS = 60_000;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly remote =
    process.env.RCLONE_REMOTE ?? 'mushee-storage:mushee';

  /**
   * Write content to remote storage via rclone.
   */
  async write(key: string, content: string): Promise<void> {
    const { path, cleanup } = await tmpFile({ postfix: '.musicxml' });
    try {
      await writeFile(path, content, 'utf-8');
      await execa('rclone', ['copyto', path, `${this.remote}/${key}`], {
        timeout: RCLONE_TIMEOUT_MS,
      });
      this.logger.log(`Wrote ${key} to storage`);
    } finally {
      await cleanup();
    }
  }

  /**
   * Read content from remote storage via rclone.
   */
  async read(key: string): Promise<string> {
    const { path, cleanup } = await tmpFile({ postfix: '.musicxml' });
    try {
      await execa('rclone', ['copyto', `${this.remote}/${key}`, path], {
        timeout: RCLONE_TIMEOUT_MS,
      });
      return await readFile(path, 'utf-8');
    } finally {
      await cleanup();
    }
  }

  /**
   * Delete a file from remote storage via rclone. Already-absent files count
   * as deleted; any other failure throws — swallowing it would orphan user
   * files after an account purge reported success.
   */
  async delete(key: string): Promise<void> {
    try {
      await execa('rclone', ['deletefile', `${this.remote}/${key}`], {
        timeout: RCLONE_TIMEOUT_MS,
      });
      this.logger.log(`Deleted ${key} from storage`);
    } catch (error) {
      // rclone exit codes 3/4 = directory/file not found.
      const exitCode = (error as { exitCode?: number }).exitCode;
      if (exitCode === 3 || exitCode === 4) {
        this.logger.log(`${key} was already absent from storage`);
        return;
      }
      this.logger.warn(`Failed to delete ${key}: ${String(error)}`);
      throw error;
    }
  }
}
