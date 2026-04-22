import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const utilsDir = path.join(srcDir, 'utils');

function getRelativePath(fromFile, toFile) {
    const rel = path.relative(path.dirname(fromFile), toFile);
    return rel.replace(/\\/g, '/').replace(/\.ts$/, '.js');
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;

    // Check if file has console.* usage (exclude comments and strings roughly)
    const hasConsole = /\bconsole\.(log|error|warn|info|debug)\s*\(/.test(content);
    if (!hasConsole) return;

    // Check if logger is already imported
    const hasLoggerImport = /import\s*\{\s*logger\s*\}\s*from\s*['"][^'"]*logger\.js['"]/.test(content);

    if (!hasLoggerImport) {
        const importPath = getRelativePath(filePath, path.join(utilsDir, 'logger.ts'));
        const importLine = `import { logger } from '${importPath}';`;
        const lines = content.split('\n');
        let lastImportIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('import ')) {
                lastImportIdx = i;
            }
        }
        if (lastImportIdx >= 0) {
            lines.splice(lastImportIdx + 1, 0, importLine);
            content = lines.join('\n');
        } else {
            content = importLine + '\n' + content;
        }
    }

    // Replace console.* calls globally
    content = content.replace(/\bconsole\.log\s*\(/g, 'logger.info(');
    content = content.replace(/\bconsole\.error\s*\(/g, 'logger.error(');
    content = content.replace(/\bconsole\.warn\s*\(/g, 'logger.warn(');
    content = content.replace(/\bconsole\.info\s*\(/g, 'logger.info(');
    content = content.replace(/\bconsole\.debug\s*\(/g, 'logger.debug(');

    if (content !== original) {
        fs.writeFileSync(filePath, content);
        console.log('Updated:', path.relative(rootDir, filePath));
    }
}

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (['node_modules', 'tests', 'dist', 'web'].includes(entry.name)) continue;
            walk(fullPath);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            processFile(fullPath);
        }
    }
}

walk(srcDir);
console.log('Logger migration complete.');
