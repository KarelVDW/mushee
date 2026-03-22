import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { CachedScore, CachedScoreDocument } from './cached-score.schema';

@Injectable()
export class CacheService {
  constructor(
    @InjectModel(CachedScore.name)
    private readonly cachedScoreModel: Model<CachedScoreDocument>,
  ) {}

  async upsert(
    scoreId: string,
    data: Record<string, unknown>,
  ): Promise<CachedScoreDocument> {
    return this.cachedScoreModel.findOneAndUpdate(
      { scoreId },
      { data },
      { upsert: true, new: true },
    );
  }

  async findByScoreId(scoreId: string): Promise<CachedScoreDocument | null> {
    return this.cachedScoreModel.findOne({ scoreId });
  }

  async updateMeasures(
    scoreId: string,
    measures: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    const $set: Record<string, unknown> = {};
    for (const [index, measureData] of Object.entries(measures)) {
      $set[`data.parts.0.measures.${index}`] = measureData;
    }
    await this.cachedScoreModel.updateOne({ scoreId }, { $set });
  }

  async replaceAllMeasures(
    scoreId: string,
    measures: Record<string, unknown>[],
  ): Promise<void> {
    await this.cachedScoreModel.updateOne(
      { scoreId },
      { $set: { 'data.parts.0.measures': measures } },
    );
  }

  async deleteByScoreId(scoreId: string): Promise<void> {
    await this.cachedScoreModel.deleteOne({ scoreId });
  }

  /**
   * Find all cached scores that have NOT been updated in the last `minutes` minutes.
   * These are considered stale and should be flushed to storage.
   */
  async findStale(minutes: number): Promise<CachedScoreDocument[]> {
    const threshold = new Date(Date.now() - minutes * 60 * 1000);
    return this.cachedScoreModel.find({
      updatedAt: { $lt: threshold },
    });
  }
}
