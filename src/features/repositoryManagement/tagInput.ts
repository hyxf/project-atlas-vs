export function formatTagInput(tags: readonly string[]): string {
    return tags
        .map((tag) =>
            tag.replace(/[\\,\r\n]/g, (character) => {
                if (character === '\r') {
                    return '\\r';
                }
                if (character === '\n') {
                    return '\\n';
                }
                return `\\${character}`;
            }),
        )
        .join('\n');
}

export function parseTagInput(input: string): string[] {
    const tags: string[] = [];
    let tag = '';
    for (let index = 0; index < input.length; index++) {
        const character = input[index]!;
        const next = input[index + 1];
        if (character === '\\' && next && ['\\', ',', 'r', 'n'].includes(next)) {
            tag += next === 'r' ? '\r' : next === 'n' ? '\n' : next;
            index++;
        } else if (character === ',' || character === '\r' || character === '\n') {
            tags.push(tag);
            tag = '';
        } else {
            tag += character;
        }
    }
    tags.push(tag);
    return tags;
}
