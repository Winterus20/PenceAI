import { AppError } from './AppError.js';

export class DatabaseError extends AppError {
    constructor(message: string, code?: string) {
        super(message, 500, true, code);
    }
}
