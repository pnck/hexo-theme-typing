// {% fold h1 title with space.. %}
// {% fold inline text foldable %}

const { log } = hexo;

function parseTagFold(args, content) {
    if (/[hH][1-6]/.test(args[0])) { // title
        const title = args.slice(1).join(' ');
        const H = args[0];
        log.debug('?=>', title);
        return `<${H} class="foldable folded">${title}</${H}>\n`
            + '<div class="fold-content">\n'
            + hexo.render.renderSync({ text: content, engine: 'markdown' })
            + '</div>\n';
    }
}

hexo.extend.tag.register('fold', parseTagFold, { ends: true });