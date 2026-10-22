'use client'

import { Component, type ReactNode } from 'react'

/**
 * Error boundary for read-only renders of documents the app did not author
 * (an engraving of an arbitrary stored score): if anything below throws while
 * rendering, it shows `fallback` instead of taking the page down.
 */
export class RenderBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false }

    static getDerivedStateFromError() {
        return { failed: true }
    }

    render() {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}
