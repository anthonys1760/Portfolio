/* Vendored Highlight.js 11.11.1 (js/highlight.min.js plus the http grammar).
   Tags pre>code with language-* and paints tokens. Plaintext is the fallback. */
(function () {
  if (!window.hljs) return;

  var alias = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    py: 'python',
    md: 'markdown',
    text: 'plaintext',
    txt: 'plaintext',
    plain: 'plaintext',
    html: 'xml',
    https: 'http'
  };

  var label = {
    javascript: 'js',
    typescript: 'ts',
    python: 'python',
    bash: 'bash',
    yaml: 'yaml',
    json: 'json',
    sql: 'sql',
    markdown: 'md',
    http: 'http',
    xml: 'html',
    css: 'css'
  };

  document.querySelectorAll('pre code').forEach(function (block) {
    var found = String(block.className || '').match(/(?:language|lang)-([A-Za-z0-9_+-]+)/);
    var lang = found ? found[1].toLowerCase() : 'plaintext';
    lang = alias[lang] || lang;
    if (!hljs.getLanguage(lang)) lang = 'plaintext';
    block.classList.add('language-' + lang);
    try {
      hljs.highlightElement(block);
    } catch (err) {
      /* Leave the original source readable if a grammar throws. */
    }
    var name = label[lang] || '';
    if (name && block.parentElement && block.parentElement.tagName === 'PRE') {
      block.parentElement.setAttribute('data-language', name);
    }
  });
})();
