import fs from 'fs';
import path from 'path';

export function getEnvPath(): string {
    // Return path to .env file in project root
    return process.cwd() + '/.env';
}

export function readEnv(): Record<string, string> {
    const envPath = getEnvPath();
    if (!fs.existsSync(envPath)) return {};

    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const env: Record<string, string> = {};

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const splitIndex = trimmed.indexOf('=');
            if (splitIndex > -1) {
                const key = trimmed.substring(0, splitIndex).trim();
                let value = trimmed.substring(splitIndex + 1).trim();
                // Remove surrounding quotes if any
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length - 1);
                }
                env[key] = value;
            }
        }
    }
    return env;
}

export function updateEnv(updates: Record<string, string>): boolean {
    const envPath = getEnvPath();
    if (!fs.existsSync(envPath)) return false;

    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const newLines: string[] = [];
    const updatedKeys = new Set<string>();

    for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const splitIndex = trimmed.indexOf('=');
            if (splitIndex > -1) {
                const key = trimmed.substring(0, splitIndex).trim();
                if (key in updates) {
                    // Update value
                    let val = updates[key];
                    // e.g handle quotes if needed or just dump
                    line = `${key}=${val}`;
                    updatedKeys.add(key);
                }
            }
        }
        newLines.push(line);
    }

    // Append any keys that were not found in the existing .env
    for (const [key, val] of Object.entries(updates)) {
        if (!updatedKeys.has(key)) {
            newLines.push(`${key}=${val}`);
        }
    }

    fs.writeFileSync(envPath, newLines.join('\n'));
    return true;
}

