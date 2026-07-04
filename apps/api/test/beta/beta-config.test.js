"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const beta_config_1 = require("../../src/beta/beta-config");
const ORIGINAL_ENV = { ...process.env };
(0, vitest_1.afterEach)(() => {
    process.env = { ...ORIGINAL_ENV };
});
(0, vitest_1.describe)('beta switches', () => {
    (0, vitest_1.it)('is off unless BETA_MODE is exactly "true"', () => {
        delete process.env.BETA_MODE;
        (0, vitest_1.expect)((0, beta_config_1.isBetaMode)()).toBe(false);
        process.env.BETA_MODE = 'false';
        (0, vitest_1.expect)((0, beta_config_1.isBetaMode)()).toBe(false);
        process.env.BETA_MODE = '1';
        (0, vitest_1.expect)((0, beta_config_1.isBetaMode)()).toBe(false);
        process.env.BETA_MODE = 'true';
        (0, vitest_1.expect)((0, beta_config_1.isBetaMode)()).toBe(true);
    });
    (0, vitest_1.it)('parses ADMIN_EMAILS case-insensitively', () => {
        process.env.ADMIN_EMAILS = ' Karel@Example.com, admin@sheemu.app ,,';
        (0, vitest_1.expect)((0, beta_config_1.adminEmails)()).toEqual(['karel@example.com', 'admin@sheemu.app']);
        (0, vitest_1.expect)((0, beta_config_1.isAdminEmail)('KAREL@example.COM')).toBe(true);
        (0, vitest_1.expect)((0, beta_config_1.isAdminEmail)('someone@else.com')).toBe(false);
    });
    (0, vitest_1.it)('stamps regular signups: free tier + no beta status outside the beta', () => {
        process.env.BETA_MODE = 'false';
        delete process.env.ADMIN_EMAILS;
        (0, vitest_1.expect)((0, beta_config_1.signupUserFields)('user@example.com')).toEqual({ role: 'user', betaStatus: null });
        (0, vitest_1.expect)((0, beta_config_1.signupTierId)()).toBe('free');
    });
    (0, vitest_1.it)('stamps beta signups: beta tier + pending status', () => {
        process.env.BETA_MODE = 'true';
        delete process.env.ADMIN_EMAILS;
        (0, vitest_1.expect)((0, beta_config_1.signupUserFields)('user@example.com')).toEqual({ role: 'user', betaStatus: 'pending' });
        (0, vitest_1.expect)((0, beta_config_1.signupTierId)()).toBe('beta');
    });
    (0, vitest_1.it)('auto-approves admins and grants the admin role', () => {
        process.env.BETA_MODE = 'true';
        process.env.ADMIN_EMAILS = 'karel@example.com';
        (0, vitest_1.expect)((0, beta_config_1.signupUserFields)('karel@example.com')).toEqual({ role: 'admin', betaStatus: 'approved' });
        process.env.BETA_MODE = 'false';
        (0, vitest_1.expect)((0, beta_config_1.signupUserFields)('karel@example.com')).toEqual({ role: 'admin', betaStatus: null });
    });
});
//# sourceMappingURL=beta-config.test.js.map