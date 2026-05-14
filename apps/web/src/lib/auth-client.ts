import { emailOTPClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react';

const authClient = createAuthClient({
    baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    plugins: [emailOTPClient()],
});

export const {
    signIn,
    signUp,
    signOut,
    useSession,
    changePassword,
    requestPasswordReset,
    resetPassword,
    changeEmail,
    emailOtp,
} = authClient;
