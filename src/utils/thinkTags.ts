const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);

export interface ExtractResult {
    thinking: string | undefined;
    cleanContent: string;
}

export function extractThinkingFromTags(content: string): ExtractResult {
    if (!content) return { thinking: undefined, cleanContent: content };

    const THINK_TAG_OPEN_STR = LT + "think" + GT;
    const THINK_FULL = new RegExp(LT + "think" + GT + "([\\s\\S]*?)" + LT + "\\x2Fthink" + GT, "g");
    const THINK_UNCLOSED = new RegExp(LT + "think" + GT + "([\\s\\S]*)$");
    const THINK_SELF_CLOSE = new RegExp(LT + "think\\s*\\x2F\\s*" + GT, "g");

    const matches: string[] = [];
    let match: RegExpExecArray | null;

    THINK_FULL.lastIndex = 0;
    while ((match = THINK_FULL.exec(content)) !== null) {
        const trimmed = match[1]?.trim();
        if (trimmed) matches.push(trimmed);
    }

    const lastThinkOpenIdx = content.lastIndexOf(THINK_TAG_OPEN_STR);
    if (lastThinkOpenIdx !== -1) {
        const afterLastOpen = content.slice(lastThinkOpenIdx);
        THINK_FULL.lastIndex = 0;
        if (!THINK_FULL.test(afterLastOpen)) {
            const unclosedContent = content.slice(lastThinkOpenIdx + THINK_TAG_OPEN_STR.length).trim();
            if (unclosedContent) matches.push(unclosedContent);
        }
        THINK_FULL.lastIndex = 0;
    }

    const cleanContent = content
        .replace(THINK_FULL, "")
        .replace(THINK_UNCLOSED, "")
        .replace(THINK_SELF_CLOSE, "")
        .trim();

    return {
        thinking: matches.length > 0 ? matches.join("\n\n") : undefined,
        cleanContent,
    };
}