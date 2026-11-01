// 打包：把 src/*.mjs 内联进模板，产出自包含的可直接双击打开的单文件 HTML
// 模板 index.src.html  →  成品 index.html（根目录，双击即玩）+ dist/index.html（副本）
// 目的：file:// 下 ES module 会被 CORS 拦无法加载 ./src/*.mjs，故成品去掉 type="module"
// 用法：改完 src/ 或 index.src.html 后执行  node build_standalone.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODULES = ['rules', 'formation', 'engine', 'ai'];

// （可能跨行的）import 语句
const RE_IMPORT_NAMED = /import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/(\w+)\.mjs['"]\s*;?/g;
const RE_IMPORT_NS = /import\s*\*\s*as\s*([\w$]+)\s*from\s*['"]\.\/(\w+)\.mjs['"]\s*;?/g;
// 收集导出名：export function/const/let/class NAME
const RE_EXPORT = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

// 把 ESM import 改写为从 __M 命名空间解构（跨模块引用不能丢）
function toDestructure(src) {
  return src
    .replace(RE_IMPORT_NS, (_, ns, mod) => `const ${ns} = __M.${mod};`)
    .replace(RE_IMPORT_NAMED, (_, names, mod) => `const {${names.replace(/\/\/[^\n]*/g, '')}} = __M.${mod};`);
}

function pack(name) {
  let src = readFileSync(join(ROOT, 'src', `${name}.mjs`), 'utf8');
  src = toDestructure(src);
  const names = [...src.matchAll(RE_EXPORT)].map(m => m[1]);
  src = src.replace(/^export\s+/gm, '');           // 去掉 export 前缀
  const ret = `{ ${names.join(', ')} }`;
  return `__M.${name} = (function(){\n${src}\nreturn ${ret};\n})();`;
}

let html = readFileSync(join(ROOT, 'index.src.html'), 'utf8');

// 1) 注入模块包（放在页面脚本之前）
const bundle = `<script>\nvar __M = {};\n${MODULES.map(pack).join('\n')}\n</script>`;
const scriptOpen = '<script type="module">';
if (!html.includes(scriptOpen)) throw new Error('index.src.html 中未找到 <script type="module">');
html = html.replace(scriptOpen, bundle + '\n' + '<script>');

// 2) 把页面里的 ESM import 改写为从 __M 命名空间解构
const htmlMod = html.replace(/'\.\/src\//g, "'./");   // 复用同一套正则
html = htmlMod
  .replace(RE_IMPORT_NS, (_, ns, mod) => `const ${ns} = __M.${mod};`)
  .replace(RE_IMPORT_NAMED, (_, names, mod) => `const {${names.replace(/\/\/[^\n]*/g, '')}} = __M.${mod};`);

if (/from\s*['"]\.\/src\//.test(html)) throw new Error('仍有未内联的 ./src/ 引用');

// 成品不需要「模块加载失败」兜底脚本（它只在开发模板里有意义）
html = html.replace(/<script id="boot-guard">[\s\S]*?<\/script>\s*/g, '');

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const targets = [join(ROOT, 'index.html'), join(ROOT, 'dist', 'index.html')];
for (const t of targets) writeFileSync(t, html, 'utf8');
console.log('built', targets.map(p => p.replace(ROOT, '.')).join(' + '), (html.length / 1024).toFixed(1) + ' KB');
