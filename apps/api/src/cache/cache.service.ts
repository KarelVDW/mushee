import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { CachedScore } from './entities/cached-score.entity';

@Injectable()
export class CacheService {
  constructor(
    @InjectRepository(CachedScore)
    private readonly cachedScoreRepo: Repository<CachedScore>,
  ) {}

  async upsert(scoreId: string, data: Record<string, unknown>): Promise<void> {
    await this.cachedScoreRepo.query(
      `INSERT INTO cached_scores ("scoreId", data)
       VALUES ($1, $2::jsonb)
       ON CONFLICT ("scoreId")
       DO UPDATE SET data = EXCLUDED.data, "updatedAt" = now()`,
      [scoreId, JSON.stringify(data)],
    );
  }

  async findByScoreId(scoreId: string): Promise<CachedScore | null> {
    return this.cachedScoreRepo.findOneBy({ scoreId });
  }

  async updateMeasures(
    scoreId: string,
    measures: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    // Chain jsonb_set calls so all measures update in one atomic statement.
    let expr = 'data';
    const params: unknown[] = [scoreId];
    for (const [index, measureData] of Object.entries(measures)) {
      const measureIndex = Number(index);
      if (!Number.isInteger(measureIndex) || measureIndex < 0) {
        throw new Error(`Invalid measure index: ${index}`);
      }
      params.push(JSON.stringify(measureData));
      expr = `jsonb_set(${expr}, '{parts,0,measures,${measureIndex}}', $${params.length}::jsonb)`;
    }
    await this.cachedScoreRepo.query(
      `UPDATE cached_scores SET data = ${expr}, "updatedAt" = now() WHERE "scoreId" = $1`,
      params,
    );
  }

  async replaceAllMeasures(
    scoreId: string,
    measures: Record<string, unknown>[],
  ): Promise<void> {
    await this.cachedScoreRepo.query(
      `UPDATE cached_scores
       SET data = jsonb_set(data, '{parts,0,measures}', $2::jsonb), "updatedAt" = now()
       WHERE "scoreId" = $1`,
      [scoreId, JSON.stringify(measures)],
    );
  }

  async updatePartList(
    scoreId: string,
    partList: Record<string, unknown>,
  ): Promise<void> {
    await this.cachedScoreRepo.query(
      `UPDATE cached_scores
       SET data = jsonb_set(data, '{partList}', $2::jsonb), "updatedAt" = now()
       WHERE "scoreId" = $1`,
      [scoreId, JSON.stringify(partList)],
    );
  }

  async deleteByScoreId(scoreId: string): Promise<void> {
    await this.cachedScoreRepo.delete({ scoreId });
  }

  /**
   * Delete a cache row only if it hasn't been touched since `updatedAt`.
   * Used by the flush cron so an edit landing between the flush read and
   * this delete keeps its cache row (and gets flushed on a later run).
   */
  async deleteIfNotUpdatedSince(
    scoreId: string,
    updatedAt: Date,
  ): Promise<void> {
    await this.cachedScoreRepo
      .createQueryBuilder()
      .delete()
      .where('"scoreId" = :scoreId', { scoreId })
      .andWhere('"updatedAt" <= :updatedAt', { updatedAt })
      .execute();
  }

  /**
   * Find all cached scores that have NOT been updated in the last `minutes` minutes.
   * These are considered stale and should be flushed to storage.
   */
  async findStale(minutes: number): Promise<CachedScore[]> {
    const threshold = new Date(Date.now() - minutes * 60 * 1000);
    return this.cachedScoreRepo.find({
      where: { updatedAt: LessThan(threshold) },
    });
  }
}
