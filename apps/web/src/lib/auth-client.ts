import { emailOTPClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { API_URL } from './env'

const authClient = createAuthClient({
    baseURL: API_URL,
    plugins: [emailOTPClient()],
})

export const { signIn, signUp, signOut, useSession, changePassword, requestPasswordReset, resetPassword, emailOtp, updateUser } = authClient
