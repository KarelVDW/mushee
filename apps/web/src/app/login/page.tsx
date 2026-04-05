'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { signIn } from '@/lib/auth-client'

const SOCIAL_PROVIDERS_ENABLED = false
export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    function handleSubmit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)

        void signIn.email({ email, password }).then(({ error }) => {
            if (error) {
                setError(error.message ?? 'Login failed')
                setLoading(false)
            } else {
                router.push('/scores')
            }
        })
    }

    function handleSocialSignIn(provider: 'google' | 'github') {
        setError(null)
        void signIn.social({ provider, callbackURL: '/scores' })
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

            {/* Login Shell Container */}
            <main className="relative z-10 w-full max-w-md px-6 py-12 flex flex-col items-center">
                {/* Header / Logo */}
                <header className="mb-12 text-center">
                    <h1 className="text-4xl font-serif italic font-bold text-primary tracking-tight">Sheemu</h1>
                    <p className="mt-4 font-headline text-2xl text-on-surface-variant font-light">Welcome back, Composer.</p>
                </header>

                {/* Login Card */}
                <div className="w-full bg-surface-container-lowest rounded-xl p-8 tonal-layer-glow manuscript-canvas">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Email Field */}
                        <div className="space-y-1.5">
                            <label className="block font-label text-sm font-semibold text-on-surface-variant ml-1" htmlFor="email">
                                Email Address
                            </label>
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
                            <div className="flex justify-between items-center px-1">
                                <label className="block font-label text-sm font-semibold text-on-surface-variant" htmlFor="password">
                                    Password
                                </label>
                                <a className="text-xs font-label text-primary font-medium hover:underline transition-all" href="#">
                                    Forgot Password?
                                </a>
                            </div>
                            <div className="relative">
                                <input
                                    className="w-full bg-surface-container border-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-highest transition-all duration-200 rounded-lg px-4 py-3 text-on-surface placeholder:text-outline/50"
                                    id="password"
                                    name="password"
                                    placeholder="••••••••"
                                    required
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Remember Me */}
                        <div className="flex items-center px-1">
                            <input
                                className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                                id="remember-me"
                                name="remember-me"
                                type="checkbox"
                            />
                            <label className="ml-2 block text-sm text-on-surface-variant font-label" htmlFor="remember-me">
                                Keep me signed in
                            </label>
                        </div>

                        {error && <p className="text-sm text-error px-1">{error}</p>}

                        {/* Sign In Button */}
                        <button
                            className="w-full py-4 px-6 bg-gradient-to-br from-primary to-primary-container text-on-primary font-label font-bold text-lg rounded-lg shadow-sm hover:brightness-110 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
                            type="submit"
                            disabled={loading}>
                            {loading ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>

                    {/* Social Login Divider */}
                    {SOCIAL_PROVIDERS_ENABLED && (
                        <>
                            <div className="relative my-8">
                                <div aria-hidden="true" className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-outline-variant/30"></div>
                                </div>
                                <div className="relative flex justify-center text-xs uppercase tracking-widest">
                                    <span className="bg-surface-container-lowest px-4 text-outline font-label">or continue with</span>
                                </div>
                            </div>

                            {/* Social Buttons */}
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    type="button"
                                    onClick={() => handleSocialSignIn('google')}
                                    className="flex w-full items-center justify-center gap-3 rounded-lg bg-surface-container-low px-3 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-colors duration-200 border border-outline-variant/10">
                                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                                        <path
                                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                            fill="#4285F4"></path>
                                        <path
                                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                            fill="#34A853"></path>
                                        <path
                                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                                            fill="#FBBC05"></path>
                                        <path
                                            d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                            fill="#EA4335"></path>
                                    </svg>
                                    Google
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSocialSignIn('github')}
                                    className="flex w-full items-center justify-center gap-3 rounded-lg bg-surface-container-low px-3 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-colors duration-200 border border-outline-variant/10">
                                    <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                                        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.341-3.369-1.341-.454-1.152-1.11-1.459-1.11-1.459-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z"></path>
                                    </svg>
                                    GitHub
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer Actions */}
                <footer className="mt-10 text-center">
                    <p className="text-on-surface-variant text-sm font-label">
                        New to Sheemu?{' '}
                        <Link className="text-primary font-bold ml-1 hover:underline decoration-2 underline-offset-4" href="/signup">
                            Sign up for a free account
                        </Link>
                    </p>
                </footer>
            </main>

            {/* Glassy AI Hint Panel */}
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-auto md:right-8 w-[90%] max-w-sm backdrop-blur-xl bg-surface-container-lowest/80 border border-outline-variant/20 rounded-xl p-5 shadow-2xl z-20 flex items-start gap-4">
                <div className="bg-primary/10 p-2 rounded-lg">
                    <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                        auto_awesome
                    </span>
                </div>
                <div>
                    <h4 className="font-headline text-lg italic text-primary leading-tight">AI Manuscript Assistant</h4>
                    <p className="text-xs text-on-surface-variant font-label mt-1">
                        &ldquo;I&rsquo;m ready to continue our last orchestration once you&rsquo;re in.&rdquo;
                    </p>
                </div>
            </div>

            {/* Page Footer */}
            <footer className="absolute bottom-4 left-0 w-full flex flex-col md:flex-row justify-center items-center px-12 py-4 text-xs font-label opacity-60 text-on-surface-variant gap-4">
                <span>&copy; 2024 Sheemu Manuscript AI. All rights reserved.</span>
                <div className="flex gap-4">
                    <a className="hover:text-primary transition-colors" href="#">
                        Privacy Policy
                    </a>
                    <a className="hover:text-primary transition-colors" href="#">
                        Terms of Service
                    </a>
                    <a className="hover:text-primary transition-colors" href="#">
                        Help Center
                    </a>
                </div>
            </footer>
        </div>
    )
}
