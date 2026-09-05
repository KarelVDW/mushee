import { randomBytes } from 'node:crypto'

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { instanceToPlain } from 'class-transformer'
import { ILike, Repository } from 'typeorm'

import { CacheService } from '../cache/cache.service'
import { StorageService } from '../storage/storage.service'
import { SubscriptionsService } from '../subscriptions/subscriptions.service'
import { CreateScoreDto } from './dto/create-score.dto'
import { UpdateScoreDto } from './dto/update-score.dto'
import { Score } from './entities/score.entity'

@Injectable()
export class ScoresService {
    constructor(
        @InjectRepository(Score)
        private readonly scoreRepo: Repository<Score>,
        private readonly cacheService: CacheService,
        private readonly storageService: StorageService,
        private readonly subscriptions: SubscriptionsService,
    ) {}

    async create(userId: string, dto: CreateScoreDto): Promise<Score> {
        await this.assertBelowScoreCap(userId)
        return this.insert(userId, dto.title, instanceToPlain(dto.score))
    }

    /**
     * Copy a score into a new one owned by the same user. The copy takes the
     * live document — the edit cache when present (unsaved edits included),
     * otherwise the stored file — so it always matches what the editor shows.
     */
    async duplicate(userId: string, id: string): Promise<Score> {
        const source = await this.findOne(userId, id)
        await this.assertBelowScoreCap(userId)
        const document = await this.load(userId, source.id)
        return this.insert(userId, this.copyTitle(source.title), document)
    }

    /** "Étude" → "Étude (copy)"; the title column allows 200 characters, so trim to fit the suffix. */
    private copyTitle(title: string): string {
        const suffix = ' (copy)'
        return title.slice(0, 200 - suffix.length).trimEnd() + suffix
    }

    private async assertBelowScoreCap(userId: string): Promise<void> {
        const tier = await this.subscriptions.tierFor(userId)
        if (tier.maxScores === null) return
        // Count-then-insert is racy, but the cap is a plan entitlement, not a
        // security boundary — a photo-finish double click slipping one score
        // past it is harmless.
        const count = await this.scoreRepo.countBy({ userId })
        if (count >= tier.maxScores) {
            throw new ForbiddenException({
                code: 'score-limit',
                message: `Your ${tier.name} plan holds up to ${tier.maxScores} scores. Upgrade to add more.`,
            })
        }
    }

    private async insert(userId: string, title: string, document: Record<string, unknown>): Promise<Score> {
        const score = this.scoreRepo.create({
            userId,
            title,
            storageKey: `scores/${userId}/${Date.now()}.musicxml`,
        })
        const saved = await this.scoreRepo.save(score)

        // Put the document in the edit cache for immediate editing; the flush
        // cron writes it to storage later.
        await this.cacheService.upsert(saved.id, document)

        return saved
    }

    async findAll(userId: string, search?: string): Promise<Score[]> {
        const where: Record<string, unknown> = { userId }
        if (search) {
            where.title = ILike(`%${search}%`)
        }
        return this.scoreRepo.find({ where, order: { updatedAt: 'DESC' } })
    }

    async findOneInternal(id: string): Promise<Score | null> {
        return this.scoreRepo.findOneBy({ id })
    }

    async findOne(userId: string, id: string): Promise<Score> {
        const score = await this.scoreRepo.findOneBy({ id })
        if (!score) throw new NotFoundException('Score not found')
        if (score.userId !== userId) throw new ForbiddenException()
        return score
    }

    /**
     * Load a score for editing. Reads from the edit cache if available,
     * otherwise reads MusicXML from storage, converts to JSON, and caches it.
     */
    async load(userId: string, id: string): Promise<Record<string, unknown>> {
        return this.loadDocument(await this.findOne(userId, id))
    }

    /**
     * The live document: the edit cache when present, else storage. Editing
     * loads prime the cache (the editor's saves patch it); read-only loads (the
     * share page) must not — an anonymous visit would otherwise write a cache
     * row that the flush cron later rewrites to storage for nothing.
     */
    private async loadDocument(score: Score, { prime = true } = {}): Promise<Record<string, unknown>> {
        const cached = await this.cacheService.findByScoreId(score.id)
        if (cached) {
            return cached.data
        }

        // Read MusicXML from storage and convert to JSON
        const musicxml = await this.storageService.read(score.storageKey)
        const scoreData = this.musicxmlToJson(musicxml)

        if (prime) await this.cacheService.upsert(score.id, scoreData)

        return scoreData
    }

    // --- Read-only share links ---

    /**
     * Turn sharing on: mint the score's share token (idempotent — an already
     * shared score keeps its link, so a re-click never invalidates a link that
     * was already sent around). 16 url-safe chars ≈ 96 bits of entropy.
     */
    async share(userId: string, id: string): Promise<{ token: string }> {
        const score = await this.findOne(userId, id)
        if (!score.shareToken) {
            score.shareToken = randomBytes(12).toString('base64url')
            await this.scoreRepo.save(score)
        }
        return { token: score.shareToken }
    }

    /** Turn sharing off: the link stops resolving immediately. A later share() mints a new token. */
    async unshare(userId: string, id: string): Promise<void> {
        const score = await this.findOne(userId, id)
        if (score.shareToken === null) return
        score.shareToken = null
        await this.scoreRepo.save(score)
    }

    /** Admin: turn a score's share link off regardless of owner (abuse reports). No-op when not shared. */
    async revokeShare(scoreId: string): Promise<void> {
        const score = await this.scoreRepo.findOneBy({ id: scoreId })
        if (!score) throw new NotFoundException('Score not found')
        if (score.shareToken === null) return
        score.shareToken = null
        await this.scoreRepo.save(score)
    }

    /**
     * What a share link shows: the live document (edit cache first, like the
     * owner sees it) plus the title. No owner identity leaves the server. An
     * unknown or revoked token is simply not found — same answer either way, so
     * a link cannot be probed for whether it used to exist.
     */
    async loadShared(token: string): Promise<{ id: string; title: string; updatedAt: Date; document: Record<string, unknown> }> {
        if (!ScoresService.isShareToken(token)) throw new NotFoundException('Score not found')
        const score = await this.scoreRepo.findOneBy({ shareToken: token })
        if (!score) throw new NotFoundException('Score not found')
        return { id: score.id, title: score.title, updatedAt: score.updatedAt, document: await this.loadDocument(score, { prime: false }) }
    }

    /** The shape share() mints — anything else is rejected before touching the database. */
    static isShareToken(token: string): boolean {
        return /^[A-Za-z0-9_-]{16,64}$/.test(token)
    }

    async update(userId: string, id: string, dto: UpdateScoreDto): Promise<Score> {
        const score = await this.findOne(userId, id)

        if (dto.title) {
            score.title = dto.title
            await this.scoreRepo.save(score)
        }

        if (dto.allMeasures) {
            await this.cacheService.replaceAllMeasures(
                score.id,
                dto.allMeasures.map((measure) => instanceToPlain(measure)),
            )
        } else if (dto.measures) {
            const measures: Record<string, Record<string, unknown>> = {}
            for (const [index, measure] of Object.entries(dto.measures)) {
                measures[index] = instanceToPlain(measure)
            }
            await this.cacheService.updateMeasures(score.id, measures)
        }

        if (dto.partList) {
            await this.cacheService.updatePartList(score.id, instanceToPlain(dto.partList))
        }

        return score
    }

    async remove(userId: string, id: string): Promise<void> {
        const score = await this.findOne(userId, id)
        await this.removeScore(score)
    }

    /** Delete every score a user owns, including cache entries and stored files. */
    async removeAllForUser(userId: string): Promise<void> {
        const scores = await this.scoreRepo.find({ where: { userId } })
        for (const score of scores) {
            await this.removeScore(score)
        }
    }

    private async removeScore(score: Score): Promise<void> {
        await this.cacheService.deleteByScoreId(score.id)

        if (score.storageKey) {
            await this.storageService.delete(score.storageKey)
        }

        await this.scoreRepo.remove(score)
    }

    // Storage format: the score's MusicXML-JSON is persisted verbatim under a
    // `.musicxml` key (a historical name — the bytes are JSON), and genuine
    // MusicXML found in storage is wrapped as { raw } untouched. The round trip
    // must stay lossless: the flush cron deletes the cached copy after writing,
    // so a lossy conversion would permanently destroy the score.
    //
    // Real MusicXML <-> JSON conversion exists since 2026-09 in
    // @mushee/notation (MusicXmlExporter / MusicXmlImporter, round-trip-tested
    // for every construct the model has) but that package ships TypeScript
    // source for bundler consumers; the API's tsc build can't consume it and
    // the importer needs a DOM parser Node lacks. Wiring it here means giving
    // the package a Node build (or bundling the API) and picking an XML parser
    // — a deliberate follow-up, not a quick change. The client already exports
    // real MusicXML (editor export menu, account data export).
    musicxmlToJson(content: string): Record<string, unknown> {
        if (content.trimStart().startsWith('{')) {
            try {
                return JSON.parse(content) as Record<string, unknown>
            } catch {
                // Not valid JSON after all — treat as raw MusicXML below.
            }
        }
        return { raw: content }
    }

    jsonToMusicxml(json: Record<string, unknown>): string {
        if (typeof json.raw === 'string') return json.raw
        return JSON.stringify(json)
    }
}
