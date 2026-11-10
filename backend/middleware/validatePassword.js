/**
 * Password Strength Validator — Virtual Classroom
 * Centralized validation used by ALL registration endpoints.
 * 
 * Requirements:
 *  - At least 8 characters
 *  - At least one uppercase letter (A-Z)
 *  - At least one lowercase letter (a-z)
 *  - At least one digit (0-9)
 *  - At least one special character (!@#$%^&*…)
 */

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};:'",.<>?/\\|`~]).{8,}$/;

const PASSWORD_ERROR_MSG =
    "Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character.";

/**
 * Validates password strength.
 * @param {string} password - The plaintext password to validate.
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePassword(password) {
    if (!password || !PASSWORD_REGEX.test(password)) {
        return { valid: false, error: PASSWORD_ERROR_MSG };
    }
    return { valid: true };
}

module.exports = { validatePassword, PASSWORD_REGEX, PASSWORD_ERROR_MSG };
