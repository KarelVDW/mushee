import { Injectable, Logger } from '@nestjs/common';
import { execa } from 'execa';
import { readFile, writeFile } from 'fs/promises';
import { file as tmpFile } from 'tmp-promise';

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
      await execa('rclone', ['copyto', path, `${this.remote}/${key}`]);
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
      await execa('rclone', ['copyto', `${this.remote}/${key}`, path]);
      return await readFile(path, 'utf-8');
    } finally {
      await cleanup();
    }
  }

  /**
   * Delete a file from remote storage via rclone.
   */
  async delete(key: string): Promise<void> {
    try {
      await execa('rclone', ['deletefile', `${this.remote}/${key}`]);
      this.logger.log(`Deleted ${key} from storage`);
    } catch (error) {
      this.logger.warn(`Failed to delete ${key}: ${error}`);
    }
  }
}
