import type { LLMToolDefinition } from '../router/types.js';

/**
 * Native Tool API kullanım yeteneğinden yoksun modeller için (fallbacks), 
 * belirtilen araçları sistem prompt'una formatlı metin olarak enjekte eder ve çok sıkı kurallar verir.
 *
 * @param systemPrompt Temel sistem prompt metni
 * @param tools Kullanılabilecek araçların (tools) listesi
 * @returns Araç açıklamaları ve format kuralları eklenmiş sistem prompt'u
 */
export function injectFallbackToolDirectives(systemPrompt: string, tools: LLMToolDefinition[]): string {
    if (tools.length === 0) {
        return systemPrompt;
    }

    let modifiedPrompt = systemPrompt + `\n\n## Platform Araçları (Tools) & İmzaları\n`;
    modifiedPrompt += `Kullanıcı bir işlem istediğinde harici veya dahili işlemleri gerçekleştirmek için araçları (tools) kullanmalısın. JSON parametrelerinde sayısal değerleri tırnak içine alma ("count": 5 doğru, "count": "5" yanlış).\n\n`;
    modifiedPrompt += `Aşağıdaki liste senin kullanabileceğin araçların formatını ve parametrelerini detaylıca göstermektedir:\n`;

    tools.forEach((t) => {
        let parametersPrompt = '';
        if (t.parameters && typeof t.parameters === 'object' && 'properties' in t.parameters) {
            const props = t.parameters.properties as Record<string, unknown>;
            const required = Array.isArray(t.parameters.required) ? t.parameters.required as string[] : [];
            const paramList = Object.entries(props).map(([key, value]) => {
                const isReq = required.includes(key) ? 'zorunlu' : 'opsiyonel';
                const v = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
                const typeStr = typeof v.type === 'string' ? v.type : 'any';
                const desc = typeof v.description === 'string' ? ` - ${v.description}` : '';
                return `      "${key}": <${typeStr}> (${isReq})${desc}`;
            });
            
            if (paramList.length > 0) {
                parametersPrompt = `\n    Parametreler:\n    {\n${paramList.join('\n')}\n    }`;
            } else {
                parametersPrompt = ' (Parametre almıyor)';
            }
        } else {
            parametersPrompt = ' (Parametre formatı belirsiz)';
        }
        
        modifiedPrompt += `\n- **${t.name}**: ${t.description}${parametersPrompt}`;
    });
    
    modifiedPrompt += `\n\n## KRİTİK: Araç Çağrısı Formatı\n`;
    modifiedPrompt += `Dikkat! Araç kullanmak istediğinde aşağıdaki YAPIYA SIKI SIKIYA uyarak formatı yanıtına yerleştir. Bu format ZORUNLUDUR.\n\n`;
    modifiedPrompt += `**Format:** \`araçAdı(parametre="değer")\`\n\n`;
    
    modifiedPrompt += `**Örnekler:**\n`;
    modifiedPrompt += `- Dosya okumak: \`readFile(path="C:\\Users\\Yigit\\dosya.txt")\`\n`;
    modifiedPrompt += `- Dizin listelemek: \`listDirectory(path="C:\\Users\\Yigit\\Documents")\`\n`;
    modifiedPrompt += `- Web Bağlantısı Okumak: \`webTool(url="https://github.com/...", mode="quick")\`\n`;
    modifiedPrompt += `- Web araması yapmak: \`webSearch(query="Gündem")\`\n`;
    modifiedPrompt += `- Komut çalıştırmak: \`executeShell(command="echo %USERNAME%")\`\n`;
    
    modifiedPrompt += `\n**KURALLAR:**\n`;
    modifiedPrompt += `1. KESİNLİKLE BİLGİ UYDURMA (Halüsinasyon YASAK)! Kullanıcının verdiği bir web bağlantısını veya dosyayı **ilgili araçları kullanarak okumadan** KESİNLİKLE analiz ediyormuş gibi sahte metinler üretme. İlk işin DAİMA aracı çağırmak olsun.\n`;
    modifiedPrompt += `2. Araç çağrısını MUTLAKA yukarıdaki formatta yaz — bir giriş açıklamasının SONRASINDA yepyeni bir satırda tek başına bulunsun.\n`;
    modifiedPrompt += `3. Araç çağrısı dışında o satıra başka hiçbir şey yazma.\n`;
    modifiedPrompt += `4. Araç çağrısını asla kod bloğu (\`\`\`) veya markdown içerisine SARMA.\n`;
    modifiedPrompt += `5. Sana dönen "[Araç Sonucu - ...]:" formatındaki ham bilgiyi kullanarak kullanıcıya gerçek bir yanıt ver.\n`;
    modifiedPrompt += `6. Bir aracı kullanacaksan, ondan sadece BAHSETME — doğrudan çağır.\n`;

    return modifiedPrompt;
}
