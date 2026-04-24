import { AppError } from './AppError.js';

export class LLMError extends AppError {
    constructor(message: string, code?: string) {
        super(message, 502, true, code);
    }
}
