import { AppError } from './AppError.js';

export class NotFoundError extends AppError {
    constructor(message: string, code?: string) {
        super(message, 404, true, code);
    }
}
