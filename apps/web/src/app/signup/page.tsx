'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { signUp } from '@/lib/auth-client'

export default function SignupPage() {
    const router = useRouter()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    function handleSubmit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)

        void signUp.email({ name, email, password }).then(({ error }) => {
            if (error) {
                setError(error.message ?? 'Signup failed')
                setLoading(false)
            } else {
                router.push('/scores')
            }
        })
    }

    return (
        <div className="bg-background text-on-background min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
            {/* Subtle Musical Motif Background */}
            <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none select-none flex items-center justify-center">
                <span className="material-symbols-outlined text-[40rem]">music_note</span>
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-0 opacity-10 pointer-events-none overflow-hidden">
                <div className="absolute top-1/4 -left-10 w-full border-t border-primary/20 h-2"></div>
                <div className="absolute top-[calc(25%+12px)] -left-10 w-full border-t border-primary/20 h-2"></div>
                <div className="absolute top-[calc(25%+24px)] -left-10 w-full border-t border-primary/20 h-2"></div>
                <div className="absolute top-[calc(25%+36px)] -left-10 w-full border-t border-primary/20 h-2"></div>
                <div className="absolute top-[calc(25%+48px)] -left-10 w-full border-t border-primary/20 h-2"></div>
            </div>

            {/* Signup Shell Container */}
            <main className="relative z-10 w-full max-w-md px-6 py-12 flex flex-col items-center">
                {/* Header / Logo */}
                <header className="mb-12 text-center">
                    <h1 className="text-4xl font-serif italic font-bold text-primary tracking-tight">Sheemu</h1>
                    <p className="mt-4 font-headline text-2xl text-on-surface-variant font-light">Begin your symphony.</p>
                </header>

                {/* Signup Card */}
                <div className="w-full bg-surface-container-lowest rounded-xl p-8 tonal-layer-glow manuscript-canvas">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Name Field */}
                        <div className="space-y-1.5">
                            <label className="block font-label text-sm font-semibold text-on-surface-variant ml-1" htmlFor="name">Full Name</label>
                            <div className="relative">
                                <input
                                    className="w-full bg-surface-container border-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-highest transition-all duration-200 rounded-lg px-4 py-3 text-on-surface placeholder:text-outline/50"
                                    id="name"
                                    name="name"
                                    placeholder="Amadeus Mozart"
                                    required
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Email Field */}
                        <div className="space-y-1.5">
                            <label className="block font-label text-sm font-semibold text-on-surface-variant ml-1" htmlFor="email">Email Address</label>
                            <div className="relative">
                                <input
                                    className="w-full bg-surface-container border-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-highest transition-all duration-200 rounded-lg px-4 py-3 text-on-surface placeholder:text-outline/50"
                                    id="email"
                                    name="email"
                                    placeholder="name@example.com"
                                    required
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Password Field */}
                        <div className="space-y-1.5">
                            <label className="block font-label text-sm font-semibold text-on-surface-variant ml-1" htmlFor="password">Password</label>
                            <div className="relative">
                                <input
                                    className="w-full bg-surface-container border-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-highest transition-all duration-200 rounded-lg px-4 py-3 text-on-surface placeholder:text-outline/50"
                                    id="password"
                                    name="password"
                                    placeholder="••••••••"
                                    required
                                    type="password"
                                    minLength={8}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        {error && <p className="text-sm text-error px-1">{error}</p>}

                        {/* Create Account Button */}
                        <button
                            className="w-full py-4 px-6 bg-gradient-to-br from-primary to-primary-container text-on-primary font-label font-bold text-lg rounded-lg shadow-sm hover:brightness-110 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
                            type="submit"
                            disabled={loading}
                        >
                            {loading ? 'Creating account...' : 'Create Account'}
                        </button>
                    </form>
                </div>

                {/* Footer Actions */}
                <footer className="mt-10 text-center">
                    <p className="text-on-surface-variant text-sm font-label">
                        Already have an account?{' '}
                        <Link className="text-primary font-bold ml-1 hover:underline decoration-2 underline-offset-4" href="/login">Sign in</Link>
                    </p>
                </footer>
            </main>

            {/* Glassy AI Hint Panel */}
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-auto md:right-8 w-[90%] max-w-sm backdrop-blur-xl bg-surface-container-lowest/80 border border-outline-variant/20 rounded-xl p-5 shadow-2xl z-20 flex items-start gap-4">
                <div className="bg-primary/10 p-2 rounded-lg">
                    <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                </div>
                <div>
                    <h4 className="font-headline text-lg italic text-primary leading-tight">AI Manuscript Assistant</h4>
                    <p className="text-xs text-on-surface-variant font-label mt-1">&ldquo;I&rsquo;m ready to continue our last orchestration once you&rsquo;re in.&rdquo;</p>
                </div>
            </div>

            {/* Page Footer */}
            <footer className="absolute bottom-4 left-0 w-full flex flex-col md:flex-row justify-center items-center px-12 py-4 text-xs font-label opacity-60 text-on-surface-variant gap-4">
                <span>&copy; 2024 Sheemu Manuscript AI. All rights reserved.</span>
                <div className="flex gap-4">
                    <a className="hover:text-primary transition-colors" href="#">Privacy Policy</a>
                    <a className="hover:text-primary transition-colors" href="#">Terms of Service</a>
                    <a className="hover:text-primary transition-colors" href="#">Help Center</a>
                </div>
            </footer>
        </div>
    )
}
