import 'reflect-metadata';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AdminService } from '../../src/admin/admin.service';
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service';
import type { ScoresService } from '../../src/scores/scores.service';
import type { StorageService } from '../../src/storage/storage.service';

const balance = {
  tier: { id: 'free', name: 'Sketch', dailyRecordingCredits: 180 },
  used: 30,
  remaining: 150,
  packSeconds: 900,
  exhausted: false,
};

function makeService(overrides?: {
  query?: ReturnType<typeof vi.fn>;
  scores?: Partial<ScoresService>;
  storage?: Partial<StorageService>;
}) {
  const query =
    overrides?.query ??
    vi.fn((sql: string) => {
      if (sql.trimStart().startsWith('DELETE')) return Promise.resolve([[], 0]);
      return Promise.resolve([]);
    });
  const scoresService = {
    findOneInternal: vi.fn(() => Promise.resolve(null)),
    load: vi.fn(() => Promise.resolve({})),
    ...overrides?.scores,
  };
  const recordingCredits = {
    balance: vi.fn(() => Promise.resolve(balance)),
    grantPackSeconds: vi.fn(() => Promise.resolve()),
    revokePackSeconds: vi.fn(() => Promise.resolve()),
  };
  const storage = {
    list: vi.fn(() => Promise.resolve([] as string[])),
    signedUrl: vi.fn(() => Promise.resolve(null as string | null)),
    createReadStream: vi.fn(() => 'fake-stream'),
    ...overrides?.storage,
  };
  const service = new AdminService(
    { query } as unknown as DataSource,
    scoresService as unknown as ScoresService,
    recordingCredits as unknown as RecordingCreditsService,
    storage as unknown as StorageService,
  );
  return { service, query, scoresService, recordingCredits, storage };
}

describe('AdminService.listUsers', () => {
  it('clamps page and pageSize and escapes LIKE wildcards', async () => {
    const query = vi.fn((sql: string) =>
      Promise.resolve(sql.includes('count(*)::int AS total') ? [{ total: 0 }] : []),
    );
    const { service } = makeService({ query });

    const result = await service.listUsers({ search: '100%_a\\b', page: -3, pageSize: 9999 });

    expect(result).toMatchObject({ page: 1, pageSize: 100, total: 0, users: [] });
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params[0]).toBe('100%_a\\b');
    expect(params[1]).toBe('%100\\%\\_a\\\\b%');
    expect(params[2]).toBe(100); // LIMIT
    expect(params[3]).toBe(0); // OFFSET
  });

  it('passes paging through untouched when already sane', async () => {
    const query = vi.fn((sql: string) =>
      Promise.resolve(sql.includes('count(*)::int AS total') ? [{ total: 42 }] : []),
    );
    const { service } = makeService({ query });

    const result = await service.listUsers({ page: 3, pageSize: 10 });

    expect(result).toMatchObject({ page: 3, pageSize: 10, total: 42 });
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params[3]).toBe(20); // OFFSET = (page-1) * pageSize
  });
});

describe('AdminService.adjustCredits', () => {
  const existingUser = vi.fn((sql: string) =>
    Promise.resolve(sql.includes('SELECT id FROM "user"') ? [{ id: 'u1' }] : []),
  );

  it('grants positive amounts through the pack balance', async () => {
    const { service, recordingCredits } = makeService({ query: existingUser });
    const state = await service.adjustCredits('u1', 600);
    expect(recordingCredits.grantPackSeconds).toHaveBeenCalledWith('u1', 600);
    expect(recordingCredits.revokePackSeconds).not.toHaveBeenCalled();
    expect(state).toEqual({
      tierId: 'free',
      tierName: 'Sketch',
      dailyLimit: 180,
      usedToday: 30,
      remainingToday: 150,
      packSeconds: 900,
    });
  });

  it('revokes negative amounts', async () => {
    const { service, recordingCredits } = makeService({ query: existingUser });
    await service.adjustCredits('u1', -300);
    expect(recordingCredits.revokePackSeconds).toHaveBeenCalledWith('u1', 300);
    expect(recordingCredits.grantPackSeconds).not.toHaveBeenCalled();
  });

  it('rejects zero and non-integer amounts', async () => {
    const { service } = makeService({ query: existingUser });
    await expect(service.adjustCredits('u1', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.adjustCredits('u1', 1.5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for unknown users', async () => {
    const { service } = makeService(); // query resolves to no rows
    await expect(service.adjustCredits('ghost', 60)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminService.revokeSessions', () => {
  it('reports how many sessions were dropped', async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes('SELECT id FROM "user"')) return Promise.resolve([{ id: 'u1' }]);
      if (sql.trimStart().startsWith('DELETE'))
        return Promise.resolve([[{ id: 's1' }, { id: 's2' }], 2]);
      return Promise.resolve([]);
    });
    const { service } = makeService({ query });
    await expect(service.revokeSessions('u1')).resolves.toEqual({ revoked: 2 });
  });
});

describe('AdminService.getScore', () => {
  const score = {
    id: 'f6a7b0d0-0000-4000-8000-000000000001',
    userId: 'u1',
    title: 'Nocturne',
    storageKey: 'scores/u1/1.musicxml',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  it('404s for unknown scores', async () => {
    const { service } = makeService();
    await expect(service.getScore(score.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the document loaded via the owner', async () => {
    const load = vi.fn(() => Promise.resolve({ parts: [] }));
    const { service } = makeService({
      scores: {
        findOneInternal: vi.fn(() => Promise.resolve(score)),
        load,
      } as unknown as Partial<ScoresService>,
    });
    const result = await service.getScore(score.id);
    expect(load).toHaveBeenCalledWith('u1', score.id);
    expect(result).toMatchObject({ title: 'Nocturne', document: { parts: [] }, documentError: null });
  });

  it('surfaces a load failure instead of failing the request', async () => {
    const { service } = makeService({
      scores: {
        findOneInternal: vi.fn(() => Promise.resolve(score)),
        load: vi.fn(() => Promise.reject(new Error('storage object missing'))),
      } as unknown as Partial<ScoresService>,
    });
    const result = await service.getScore(score.id);
    expect(result).toMatchObject({ document: null, documentError: 'storage object missing' });
  });

  it('lists the score\'s recordings, newest first', async () => {
    const rows = [{ id: 'r2', creditsSpent: 30, hasAudio: true }];
    const query = vi.fn((sql: string) =>
      Promise.resolve(sql.includes('FROM recordings') ? rows : []),
    );
    const { service } = makeService({
      query,
      scores: { findOneInternal: vi.fn(() => Promise.resolve(score)) } as unknown as Partial<ScoresService>,
    });
    const result = await service.getScore(score.id);
    expect(result.recordings).toBe(rows);
  });
});

describe('AdminService.recordingAudio', () => {
  const RECORDING_ID = 'f6a7b0d0-0000-4000-8000-000000000002';
  const withRecording = (storagePath: string | null) =>
    vi.fn((sql: string) =>
      Promise.resolve(sql.includes('FROM recordings') ? [{ storagePath }] : []),
    );

  it('404s for unknown recordings and for recordings without archived audio', async () => {
    const { service } = makeService();
    await expect(service.recordingAudio(RECORDING_ID)).rejects.toBeInstanceOf(NotFoundException);

    const { service: noAudio } = makeService({ query: withRecording(null) });
    await expect(noAudio.recordingAudio(RECORDING_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the base path holds no audio object', async () => {
    const { service } = makeService({
      query: withRecording('recordings/u/s/r'),
      storage: { list: vi.fn(() => Promise.resolve(['recordings/u/s/r/debug.json'])) },
    });
    await expect(service.recordingAudio(RECORDING_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prefers a signed bucket URL', async () => {
    const { service, storage } = makeService({
      query: withRecording('recordings/u/s/r'),
      storage: {
        list: vi.fn(() => Promise.resolve(['recordings/u/s/r/audio.webm'])),
        signedUrl: vi.fn(() => Promise.resolve('https://bucket/signed')),
      },
    });
    await expect(service.recordingAudio(RECORDING_ID)).resolves.toEqual({ url: 'https://bucket/signed' });
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('streams with the right content type when the backend has no URLs', async () => {
    const { service } = makeService({
      query: withRecording('recordings/u/s/r'),
      storage: { list: vi.fn(() => Promise.resolve(['recordings/u/s/r/audio.mp3'])) },
    });
    await expect(service.recordingAudio(RECORDING_ID)).resolves.toEqual({
      stream: 'fake-stream',
      contentType: 'audio/mpeg',
    });
  });

  it('falls back to streaming when signing fails', async () => {
    const { service } = makeService({
      query: withRecording('recordings/u/s/r'),
      storage: {
        list: vi.fn(() => Promise.resolve(['recordings/u/s/r/audio.webm'])),
        signedUrl: vi.fn(() => Promise.reject(new Error('no signBlob permission'))),
      },
    });
    await expect(service.recordingAudio(RECORDING_ID)).resolves.toEqual({
      stream: 'fake-stream',
      contentType: 'audio/webm',
    });
  });
});
