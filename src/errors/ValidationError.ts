import { AppError } from './AppError.js';

export class ValidationError extends AppError {
    constructor(message: string, code?: string) {
        super(message, 400, true, code);
    }
}
