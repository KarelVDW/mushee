import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { CacheService } from '../cache/cache.service';
import { StorageService } from '../storage/storage.service';
import { CreateScoreDto } from './dto/create-score.dto';
import { UpdateScoreDto } from './dto/update-score.dto';
import { Score } from './entities/score.entity';

@Injectable()
export class ScoresService {
  constructor(
    @InjectRepository(Score)
    private readonly scoreRepo: Repository<Score>,
    private readonly cacheService: CacheService,
    private readonly storageService: StorageService,
  ) {}

  async create(userId: string, dto: CreateScoreDto): Promise<Score> {
    const score = this.scoreRepo.create({
      userId,
      title: dto.title,
      storageKey: `scores/${userId}/${Date.now()}.musicxml`,
    });
    const saved = await this.scoreRepo.save(score);

    // Put initial score data in MongoDB cache for immediate editing
    await this.cacheService.upsert(saved.id, dto.score);

    return saved;
  }

  async findAll(userId: string, search?: string): Promise<Score[]> {
    const where: Record<string, unknown> = { userId };
    if (search) {
      where.title = ILike(`%${search}%`);
    }
    return this.scoreRepo.find({ where, order: { updatedAt: 'DESC' } });
  }

  async findOneInternal(id: string): Promise<Score | null> {
    return this.scoreRepo.findOneBy({ id });
  }

  async findOne(userId: string, id: string): Promise<Score> {
    const score = await this.scoreRepo.findOneBy({ id });
    if (!score) throw new NotFoundException('Score not found');
    if (score.userId !== userId) throw new ForbiddenException();
    return score;
  }

  /**
   * Load a score for editing. Reads from MongoDB cache if available,
   * otherwise reads MusicXML from storage, converts to JSON, and caches it.
   */
  async load(userId: string, id: string): Promise<Record<string, unknown>> {
    const score = await this.findOne(userId, id);

    // Check if already cached in MongoDB
    const cached = await this.cacheService.findByScoreId(score.id);
    if (cached) {
      return cached.data;
    }

    // Read MusicXML from storage and convert to JSON
    const musicxml = await this.storageService.read(score.storageKey);
    const scoreData = this.musicxmlToJson(musicxml);

    // Cache in MongoDB for editing
    await this.cacheService.upsert(score.id, scoreData);

    return scoreData;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateScoreDto,
  ): Promise<Score> {
    const score = await this.findOne(userId, id);

    if (dto.title) {
      score.title = dto.title;
      await this.scoreRepo.save(score);
    }

    if (dto.allMeasures) {
      await this.cacheService.replaceAllMeasures(score.id, dto.allMeasures);
    } else if (dto.measures) {
      await this.cacheService.updateMeasures(score.id, dto.measures);
    }

    return score;
  }

  async remove(userId: string, id: string): Promise<void> {
    const score = await this.findOne(userId, id);

    await this.cacheService.deleteByScoreId(score.id);

    if (score.storageKey) {
      await this.storageService.delete(score.storageKey);
    }

    await this.scoreRepo.remove(score);
  }

  // TODO: implement actual MusicXML <-> JSON conversion
  musicxmlToJson(musicxml: string): Record<string, unknown> {
    return { raw: musicxml };
  }

  jsonToMusicxml(json: Record<string, unknown>): string {
    return (json.raw as string) ?? '<score-partwise></score-partwise>';
  }
}
