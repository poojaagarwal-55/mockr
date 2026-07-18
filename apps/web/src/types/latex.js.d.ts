declare module "latex.js" {
    export class HtmlGenerator {
        constructor(options?: { hyphenate?: boolean });
    }

    export function parse(
        input: string,
        options?: { generator?: HtmlGenerator }
    ): {
        htmlDocument(): Document;
    };
}
