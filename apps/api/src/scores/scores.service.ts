import { randomBytes } from 'node:crypto'

import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { instanceToPlain } from 'class-transformer'
import { ILike, Repository } from 'typeorm'

import { StorageService } from '../storage/storage.service'
import { SubscriptionsService } from '../subscriptions/subscriptions.service'
import { ErrorReporter } from '../telemetry/error-reporter'
import { CreateScoreDto } from './dto/create-score.dto'
import { UpdateScoreDto } from './dto/update-score.dto'
import { Score } from './entities/score.entity'
import { ScoreEditCacheService } from './score-edit-cache.service'

@Injectable()
export class ScoresService {
    private readonly logger = new Logger(ScoresService.name)

    constructor(
        @InjectRepository(Score)
        private readonly scoreRepo: Repository<Score>,
        private readonly editCache: ScoreEditCacheService,
        private readonly storageService: StorageService,
        private readonly subscriptions: SubscriptionsService,
        private readonly reporter: ErrorReporter,
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
        const document = await this.readDocument(source)
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
        await this.editCache.upsert(saved.id, document)

        return saved
    }

    async findAll(userId: string, search?: string): Promise<Score[]> {
        const where: Record<string, unknown> = { userId }
        if (search) {
            where.title = ILike(`%${search}%`)
        }
        return this.scoreRepo.find({ where, order: { updatedAt: 'DESC' } })
    }

    /** A score by id with no owner check — for admin and maintenance callers only. */
    async findById(id: string): Promise<Score | null> {
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
     * otherwise decodes the stored document and caches it.
     */
    async load(userId: string, id: string): Promise<Record<string, unknown>> {
        return this.loadDocument(await this.findOne(userId, id))
    }

    /**
     * The read-only counterpart of load(): the same live document, without
     * priming the edit cache. For every reader that won't edit (share page,
     * admin console, duplicate's source).
     */
    async readDocument(score: Score): Promise<Record<string, unknown>> {
        return this.loadDocument(score, { prime: false })
    }

    /**
     * The live document: the edit cache when present, else storage. Editing
     * loads prime the cache (the editor's saves patch it); read-only loads (the
     * share page) must not — an anonymous visit would otherwise write a cache
     * row that the flush cron later rewrites to storage for nothing.
     */
    private async loadDocument(score: Score, { prime = true } = {}): Promise<Record<string, unknown>> {
        const cached = await this.editCache.findByScoreId(score.id)
        if (cached) {
            return cached.data
        }

        const scoreData = this.decodeStored(await this.storageService.read(score.storageKey))

        if (prime) await this.editCache.upsert(score.id, scoreData)

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
        return { id: score.id, title: score.title, updatedAt: score.updatedAt, document: await this.readDocument(score) }
    }

    /** The shape share() mints — anything else is rejected before touching the database. */
    static isShareToken(token: string): boolean {
        return /^[A-Za-z0-9_-]{16,64}$/.test(token)
    }

    async update(userId: string, id: string, dto: UpdateScoreDto): Promise<Score> {
        const score = await this.findOne(userId, id)
        let documentChanged = false

        if (dto.allMeasures) {
            const measures = dto.allMeasures.map((measure) => instanceToPlain(measure))
            await this.patchDocument(score, () => this.editCache.replaceAllMeasures(score.id, measures))
            documentChanged = true
        } else if (dto.measures) {
            const measures: Record<string, Record<string, unknown>> = {}
            for (const [index, measure] of Object.entries(dto.measures)) {
                measures[index] = instanceToPlain(measure)
            }
            await this.patchDocument(score, () => this.editCache.updateMeasures(score.id, measures))
            documentChanged = true
        }

        if (dto.partList) {
            const partList = instanceToPlain(dto.partList)
            await this.patchDocument(score, () => this.editCache.updatePartList(score.id, partList))
            documentChanged = true
        }

        // Document edits only touch cached_scores, so the row's updatedAt — what
        // the library shows as "Updated" and sorts by — is moved explicitly.
        // Only the columns this request changes are written: save() would write
        // back every column of the row read above, so a share revoke or a rename
        // committed while this autosave was in flight would be silently undone.
        if (documentChanged || dto.title) {
            score.updatedAt = new Date()
            if (dto.title) score.title = dto.title
            await this.scoreRepo.update({ id: score.id }, { updatedAt: score.updatedAt, ...(dto.title ? { title: dto.title } : {}) })
        }

        return score
    }

    /**
     * Apply one edit to the score's edit-cache row. A missing row means the
     * flush cron already wrote the document to storage and dropped it — the
     * editor loads once and then only sends deltas, so its next save lands
     * here. Re-prime from storage (which holds exactly what the row held) and
     * apply again; the prime never overwrites, so a concurrent save that got
     * there first keeps its edit. A second miss fails loudly instead of
     * answering 200 for an edit that was stored nowhere, so the client retries.
     */
    private async patchDocument(score: Score, patch: () => Promise<boolean>): Promise<void> {
        if (await patch()) return
        const stored = this.decodeStored(await this.storageService.read(score.storageKey))
        await this.editCache.primeIfAbsent(score.id, stored)
        if (!(await patch())) throw new ServiceUnavailableException('Score could not be saved')
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
        await this.editCache.deleteByScoreId(score.id)

        if (score.storageKey) {
            await this.storageService.delete(score.storageKey)
        }

        await this.scoreRepo.remove(score)
    }

    /**
     * Write every edit-cache row idle for `idleMinutes` back to storage and drop
     * it, returning how many were flushed. Storage is written before the row is
     * deleted, and the delete only lands if no edit touched the row since it was
     * read — such an edit keeps its row and is flushed on a later run. A failed
     * score is logged and skipped so one bad document doesn't stall the rest.
     */
    async flushIdleDocuments(idleMinutes: number): Promise<number> {
        const idle = await this.editCache.findStale(idleMinutes)
        let flushed = 0
        let failed = 0
        for (const cached of idle) {
            try {
                const score = await this.findById(cached.scoreId)
                if (!score) {
                    this.logger.warn(`Score ${cached.scoreId} not found in DB, removing from cache`)
                    await this.editCache.deleteByScoreId(cached.scoreId)
                    continue
                }

                await this.storageService.write(score.storageKey, this.encodeForStorage(cached.data))
                await this.editCache.deleteIfNotUpdatedSince(cached.scoreId, cached.updatedAt)
                flushed++

                this.logger.log(`Flushed score ${score.id} (${score.title}) to storage`)
            } catch (error) {
                // The row stays and the next run retries; reported because edits
                // stuck in the cache are invisible in the logs alone.
                this.logger.error(`Failed to flush score ${cached.scoreId}: ${String(error)}`)
                this.reporter.capture(error, { origin: 'cron', job: 'flush-scores', scoreId: cached.scoreId })
                failed++
            }
        }
        // One line per run, quiet runs included, so "ran and found nothing" is
        // told apart from "never ran" and failures show beside the successes.
        this.logger.log(`Flush run: ${idle.length} idle, ${flushed} flushed, ${failed} failed`)
        return flushed
    }

    // Storage format: the score's MusicXML-JSON is persisted verbatim under a
    // `.musicxml` key (a historical name — the bytes are JSON), and genuine
    // MusicXML found in storage is wrapped as { raw } untouched. The round trip
    // must stay lossless: flushIdleDocuments deletes the cached copy after
    // writing, so a lossy conversion would permanently destroy the score.
    //
    // Real MusicXML <-> JSON conversion exists since 2026-09 in
    // @mushee/notation (MusicXmlExporter / MusicXmlImporter, round-trip-tested
    // for every construct the model has) but that package ships TypeScript
    // source for bundler consumers; the API's tsc build can't consume it and
    // the importer needs a DOM parser Node lacks. Wiring it here means giving
    // the package a Node build (or bundling the API) and picking an XML parser
    // — a deliberate follow-up, not a quick change. The client already exports
    // real MusicXML (editor export menu, account data export).
    private decodeStored(content: string): Record<string, unknown> {
        if (content.trimStart().startsWith('{')) {
            try {
                return JSON.parse(content) as Record<string, unknown>
            } catch {
                // Not valid JSON after all — treat as raw MusicXML below.
            }
        }
        return { raw: content }
    }

    private encodeForStorage(document: Record<string, unknown>): string {
        if (typeof document.raw === 'string') return document.raw
        return JSON.stringify(document)
    }
}
