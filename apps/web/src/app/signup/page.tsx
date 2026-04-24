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
    const [showPassword, setShowPassword] = useState(false)
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
        <div className="bg-surface text-on-surface min-h-screen flex items-center justify-center p-3 sm:p-6 antialiased selection:bg-primary-container selection:text-on-primary-container">
            <main className="w-full max-w-[57.6rem] bg-surface-container-lowest rounded-xl shadow-[0px_0px_19px_0px_rgba(45,47,47,0.06)] flex flex-col lg:flex-row overflow-hidden min-h-[640px] relative">
                {/* Decorative blur */}
                <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-primary-container/20 rounded-full blur-[96px] pointer-events-none"></div>

                {/* Left: Branding */}
                <section className="w-full lg:w-5/12 bg-surface-container-low relative flex flex-col justify-between p-8 lg:p-[3.2rem] overflow-hidden">
                    <div
                        aria-hidden
                        className="absolute inset-0 z-0 opacity-40 mix-blend-multiply bg-cover bg-center"
                        style={{
                            backgroundImage:
                                "url('https://lh3.googleusercontent.com/aida-public/AB6AXuAjXeWx4GgH7UvOCbg6vPA6CwwUyqp3Y8gUD9d-B-7JVFIdcsVPuhXC98vQd0P0XHmLcKhU5WL8Ypr15suLLnunL1gAgyioiIJ3_ewMzkFgG5Lx8sZEFFwCzZpiFf0GkjD4t28bD-sZSdwfHrD3zXy72Hl1bc5C7Ey79nmz77FjZoK__imH4sUsSouynua7oSKpxFgdjGCd51wthq6HddCnxYkvzlHp-1OrtLok0D8WQFvnqfwBJENvBR6xnrvriRmkGweozcpwyYs')",
                        }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-surface-container-low/80 via-surface-container-low/90 to-surface-container-low z-10"></div>
                    <div className="relative z-20 flex flex-col h-full justify-between">
                        <div className="text-[1.8rem] font-black tracking-tighter text-on-surface italic mb-[2.4rem]">
                            Sheemu
                        </div>
                        <div className="space-y-[1.2rem] mt-auto">
                            <h1 className="text-[2.8rem] leading-[0.9] font-black tracking-[-0.04em] text-on-surface uppercase break-words">
                                Join The<br />Rebellion
                            </h1>
                            <p className="text-[0.9rem] text-on-surface-variant font-medium max-w-[18rem]">
                                The Precision Maverick. Reject the clutter. Compose boldly in a high-tech sanctuary.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Right: Form */}
                <section className="w-full lg:w-7/12 p-[1.6rem] sm:p-[2.4rem] lg:p-16 flex flex-col justify-start relative z-20 bg-surface-container-lowest">
                    <div className="max-w-[22.4rem] w-full mx-auto flex-1 flex flex-col">
                        {/* Tabs */}
                        <div className="flex items-center gap-[1.6rem] mb-[2.4rem] border-b-2 border-surface-container pb-[0.8rem]">
                            <button
                                type="button"
                                className="font-bold text-base text-primary border-b-[3px] border-primary-container -mb-[14px] pb-[0.8rem] transition-all uppercase tracking-tight">
                                Create New
                            </button>
                            <Link
                                href="/login"
                                className="font-bold text-base text-on-surface-variant hover:text-on-surface pb-[0.8rem] transition-all uppercase tracking-tight">
                                Sign In
                            </Link>
                        </div>

                        <form onSubmit={handleSubmit} className="flex-1 flex flex-col space-y-[1.6rem]">
                            <div className="space-y-[1.2rem] flex-1 flex flex-col justify-center">
                                {/* Name */}
                                <div>
                                    <label
                                        className="text-[0.6rem] font-bold text-on-surface uppercase tracking-widest mb-[0.4rem] block"
                                        htmlFor="name">
                                        Callsign (Full Name)
                                    </label>
                                    <div className="input-field-container bg-surface-container-low rounded">
                                        <input
                                            className="input-field w-full bg-transparent text-on-surface p-[0.8rem] text-[0.9rem] placeholder-on-surface-variant/50"
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

                                {/* Email */}
                                <div>
                                    <label
                                        className="text-[0.6rem] font-bold text-on-surface uppercase tracking-widest mb-[0.4rem] block"
                                        htmlFor="email">
                                        Transmission Address (Email)
                                    </label>
                                    <div className="input-field-container bg-surface-container-low rounded">
                                        <input
                                            className="input-field w-full bg-transparent text-on-surface p-[0.8rem] text-[0.9rem] placeholder-on-surface-variant/50"
                                            id="email"
                                            name="email"
                                            placeholder="maverick@sheemu.io"
                                            required
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                        />
                                    </div>
                                </div>

                                {/* Password */}
                                <div>
                                    <label
                                        className="text-[0.6rem] font-bold text-on-surface uppercase tracking-widest mb-[0.4rem] block"
                                        htmlFor="password">
                                        Access Code (Password)
                                    </label>
                                    <div className="input-field-container bg-surface-container-low rounded flex items-center pr-[0.8rem]">
                                        <input
                                            className="input-field w-full bg-transparent text-on-surface p-[0.8rem] text-[0.9rem] placeholder-on-surface-variant/50"
                                            id="password"
                                            name="password"
                                            placeholder="••••••••••••"
                                            required
                                            minLength={8}
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword((v) => !v)}
                                            className="text-outline-variant hover:text-primary transition-colors focus:outline-none">
                                            <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>
                                                {showPassword ? 'visibility_off' : 'visibility'}
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {error && <p className="text-[0.7rem] text-error">{error}</p>}

                            <div className="pt-[0.8rem] space-y-[1.2rem]">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full bg-primary-container text-white rounded-full py-4 px-[1.6rem] font-bold text-[0.9rem] uppercase tracking-widest hover:opacity-90 transition-all shadow-[5px_5px_0px_var(--color-secondary-container)] flex justify-center items-center gap-2 group disabled:opacity-50">
                                    <span>{loading ? 'Initializing' : 'Initialize'}</span>
                                    <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform" style={{ fontSize: '19px' }}>
                                        arrow_forward
                                    </span>
                                </button>
                                <div className="flex items-center justify-between text-[0.7rem]">
                                    <span className="text-on-surface-variant">Already an operative?</span>
                                    <Link
                                        href="/login"
                                        className="text-secondary font-bold hover:text-secondary-container transition-colors uppercase tracking-wider text-[0.6rem]">
                                        Access Studio
                                    </Link>
                                </div>
                            </div>
                        </form>
                    </div>
                </section>
            </main>
        </div>
    )
}
