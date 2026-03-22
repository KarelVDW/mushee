const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
        },
    });

    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<T>;
}

export interface ScoreMeta {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

export function listScores(search?: string): Promise<ScoreMeta[]> {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    return api(`/scores${params}`);
}

export function getScore(id: string): Promise<ScoreMeta> {
    return api(`/scores/${id}`);
}

export function loadScore(id: string): Promise<Record<string, unknown>> {
    return api(`/scores/${id}/load`);
}

export function createScore(title: string, score: Record<string, unknown>): Promise<ScoreMeta> {
    return api('/scores', {
        method: 'POST',
        body: JSON.stringify({ title, score }),
    });
}

export function updateScore(id: string, data: { title?: string; measures?: Record<string, unknown>; allMeasures?: unknown[] }): Promise<ScoreMeta> {
    return api(`/scores/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

export function deleteScore(id: string): Promise<void> {
    return api(`/scores/${id}`, { method: 'DELETE' });
}
