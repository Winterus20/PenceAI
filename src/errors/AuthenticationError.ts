import { AppError } from './AppError.js';

export class AuthenticationError extends AppError {
    constructor(message: string, code?: string) {
        super(message, 401, true, code);
    }
}
