export function createDownloadableText(processedPages) {
    let fullText = "";

    processedPages.forEach((page, index) => {
        const pageNum = page.pageNumber || (index + 1);
        fullText += `--- Page/Image ${pageNum} ---\n\n`;
        fullText += (page.transliteratedText || "[No Text Found]") + "\n\n";
        fullText += "----------------------------\n\n";
    });

    return new Blob([fullText], { type: 'text/plain;charset=utf-8' });
}
