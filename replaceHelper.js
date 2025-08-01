const fs = require('fs');
const glob = require('glob');
const { load } = require('cheerio');
const MagicString = require('magic-string');

// Replace extracted keys with $t()
function replaceExtractedKeysInFilesWithTCall(targetDir, translationMappingPath, options = {}) {
    // files will be skipped during the replacement process
    const excludeFiles = options.excludeFiles || [];
    // the first level key will be added when write $t() call to the file, eg. HomePage -> $t("HomePage[\"keyOne\"]")
    // NOTES: should be the one in i18n config file
    const curPageKey = options.translationPageKey;
    // whether it is processing the translationMapping for translation-as-whole-pointer
    const isTranslationAsWholePointer = options.isTranslationAsWholePointer || false;
    // whether only replace the <template> section in .vue files
    const templateOnly = options.templateOnly || false;
    const greedy = options.greedy || false;

    var vueFiles = [];
    var jsFiles = [];


    const stat = fs.statSync(targetDir);

    // Step 1: Find files
    if (stat.isFile()) {
        console.log(`Processing single file: ${targetDir}`);
        if (targetDir.endsWith('.vue')) {
            vueFiles = [targetDir];
        } else if (!templateOnly && (targetDir.endsWith('.js') || targetDir.endsWith('.ts'))) {
            jsFiles = [targetDir];
        } else {
            console.warn(`⚠️ Skipping unsupported file: ${targetDir}`);
            return; // Nothing to do
        }
    } else {
        console.log(`Processing folder: ${targetDir}`);
        const ignorePatterns = [
            '**/node_modules/**',
            ...excludeFiles.flatMap(f =>
                fs.existsSync(f) && fs.statSync(f).isDirectory()
                    ? [f, `${f}/**`] // ignore the folder and everything under it
                    : [f]            // ignore the file
            ),
        ];
        vueFiles = glob.sync(`${targetDir}/**/*.vue`, { ignore: ignorePatterns });
        // If templateOnly is true, we only process .vue files
        if(!templateOnly){
            jsFiles = glob.sync(`${targetDir}/**/*.{js,ts}`, { ignore: ignorePatterns });
        }
    }

    console.log(`Found ${vueFiles.length} .vue files`);
    console.log(`Found ${jsFiles.length} .js/.ts files`);

    // Step 2: Process translationMapping
    if (!fs.existsSync(translationMappingPath) || !translationMappingPath.endsWith('.json')) {
        console.warn(`⚠️ Translation mapping file does not exist or is not a .json file: ${translationMappingPath}`);
        return;
    }

    let translationMapping;
    try {
        translationMapping = JSON.parse(fs.readFileSync(translationMappingPath, 'utf-8'));
        console.log(`✅ Successfully loaded translation mapping from ${translationMappingPath}`);
    } catch (error) {
        console.error(`❌ Failed to parse translation mapping file: ${translationMappingPath}`, error.message);
        return;
    }
    let parsedTranslationMapping = parseTranslationMapping(translationMapping, isTranslationAsWholePointer);

    // Step 3: Replace keys in .vue files
    vueFiles.forEach(filePath => replaceVueFiles(filePath, parsedTranslationMapping, curPageKey, isTranslationAsWholePointer, templateOnly, translationMapping, greedy));

    // Step 4: Replace keys in .js/.ts files
    jsFiles.forEach(filePath => replaceJSTSFiles(filePath, parsedTranslationMapping, curPageKey));

}

function parseTranslationMapping(translationMapping, isTranslationAsWholePointer = false) {
    const output = {};
    // extract the placeholders from the key
    if( isTranslationAsWholePointer ){
        Object.entries(translationMapping)
        .sort((a,b)=>{
            const aNum = parseInt(a[0]);
            const bNum = parseInt(b[0]);
            return aNum - bNum;
        }).forEach(([key, value]) => {
            // 1. parse key
            // NOTES: the key is definitely a string, so we can safely use it
            const actualKey = key.split('~~')[1];
            if (!actualKey) {
                console.warn(`⚠️ Skipping invalid key for translate-as-whole-pointer: ${key}`);
                return;
            }
            if(!output[actualKey]){
                output[actualKey] = {};
            }
            output[actualKey]['restoredKey'] = actualKey;
            const placeholdersInKey = extractPlaceholdersFromString(actualKey);
            output[actualKey]['keyPlaceholders'] = placeholdersInKey;
            // 2. parse value
            if (typeof value === 'string') {
                // If the value is a string, extract placeholders from it
                const placeholdersInValue = extractPlaceholdersFromString(value);
                if(!output[actualKey]['valuePlaceholders']){
                    output[actualKey]['valuePlaceholders'] = [];
                }
                output[actualKey]['valuePlaceholders'].push(...placeholdersInValue);
            }else{
                output[actualKey]['valuePlaceholders'] = [];
            }
        });
    } else {
        Object.entries(translationMapping).forEach(([key, value]) => {
            // 1. parse key
            // NOTES: the key is definitely a string, so we can safely use it
            if(!output[key]){
                output[key] = {};
            }
            output[key]['restoredKey'] = convertPlainBracesToVue(key);
            const placeholdersInKey = extractPlaceholdersFromString(key);
            output[key]['keyPlaceholders'] = placeholdersInKey;
            // 2. parse value
            if (typeof value === 'string') {
                // If the value is a string, extract placeholders from it
                const placeholdersInValue = extractPlaceholdersFromString(value);
                output[key]['valuePlaceholders'] = placeholdersInValue;
            }else{
                output[key]['valuePlaceholders'] = [];
            }
        });
    }
    return output;
}
function extractPlaceholdersFromString(str) {
    // Extract placeholders from a string,
    // E.g. "Hello {name}" -> ["name"]
    // E.g. "Hello {name} {age}" -> ["name", "age"]
    // NOTES: already handle the case of ${}. E.g. "Hello ${name} {age}" -> ["name", "age"]
    const matches = str.match(/\{([^}]+)\}|\$\{([^}]+)\}/g);
    if (!matches) return [];
    return matches.map(m => m.replace(/^\$\{/, '').replace(/^\{/, '').replace(/\}$/, '').trim());
}
function convertPlainBracesToVue(text) {
    // Convert plain braces to Vue-style interpolation
    // E.g. "Hello {name}" -> "Hello {{name}}"
    // E.g. "Hello {name} {age}" -> "Hello {{name}} {{age}}"
    // NOTES: will skip the case of ${}, e.g. "Hello ${name} {age}" -> "Hello ${name} {{age}}"
    return text.replace(/(?<!\$)\{([^}]+)\}/g, (match, p1) => `{{${p1}}}`);
}

function replaceVueFiles(filePath, parsedTranslationMapping, pageKey, isTranslationAsWholePointer, templateOnly, originalTranslationMapping, greedy) {
    // console.log(`Processing Vue file: ${filePath}`);
    let vueContent = fs.readFileSync(filePath, 'utf-8');

    // Step 1: Replace keys with $t() calls in template section
    const templateMatch = vueContent.match(/<template>([\s\S]*?)<\/template>/);
    if (!templateMatch) {
        console.log(` ❌ No <template> block found in ${filePath}. Skipping replacement.`);
        return;
    }

    const templateContent = templateMatch[1];
    var replacedTemplateContent;
    // 🔥 Replace template content
    if( isTranslationAsWholePointer) {
        replacedTemplateContent = replaceTranslateAsWholePointerInTemplate(templateContent, originalTranslationMapping, parsedTranslationMapping, pageKey);
    }else{
        replacedTemplateContent = replaceRegularMappingWithTCall(templateContent, parsedTranslationMapping, pageKey, 'template', greedy);
    }
    // 🔥 Reassemble file content
    vueContent = vueContent.replace(templateMatch[1], replacedTemplateContent);

    // Step 2: If not templateOnly, replace keys with $t() calls in script section
    if (!templateOnly && !isTranslationAsWholePointer) {
        // this regex matches different kinds of <script> blocks, including attributes and inner content
        const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
        let matches;

        while ((matches = scriptRegex.exec(vueContent)) !== null) {
            const fullMatch = matches[0];
            const attrs = matches[1];
            const innerContent = matches[2];

            const replacedScriptContent = replaceRegularMappingWithTCall(innerContent, parsedTranslationMapping, pageKey, "js");

            const newScriptBlock = `<script${attrs}>${replacedScriptContent}</script>`;
            vueContent = vueContent.replace(fullMatch, newScriptBlock);
        }
    }

    // Step 3: Write the modified content back to the file
    fs.writeFileSync(filePath, vueContent, 'utf-8');
    console.log(`✅ Successfully updated ${filePath}`);
}
function replaceJSTSFiles(filePath, parsedTranslationMapping, pageKey){
    // console.log(`Processing JS/TS file: ${filePath}`);
    let jsContent = fs.readFileSync(filePath, 'utf-8');

    // Step 1: Replace keys with $t() calls in the content
    jsContent = replaceRegularMappingWithTCall(jsContent, parsedTranslationMapping, pageKey, 'js');

    // Step 2: Write the modified content back to the file
    fs.writeFileSync(filePath, jsContent, 'utf-8');
    console.log(`✅ Successfully updated ${filePath}`);
}
function replaceRegularMappingWithTCall(content, mappings, pageKey, contentType = 'template', greedy = false) {
    // contentType: 'template', 'js', 'ts
    if (!greedy && contentType === 'template') {
        //here put magic string methods
        // 💥 Magic String logic for safe template replacement
        const s = new MagicString(content);

        // Match text between tags (ignores attributes)
        const regex = />\s*([^<>\{\}][^<>]*?)\s*</g;

        let match;
        while ((match = regex.exec(content)) !== null) {
            const originalText = match[1].trim();

            // Only proceed if non-empty and not pure interpolation
            if (!originalText || /^\{\{.*\}\}$/.test(originalText)) continue;

            // ✅ Skip if already contains $t( or t( inside
            if (originalText.includes('$t(') || originalText.includes('t(')) {
                continue;
            }


            // Find matching key from mappings
            const matchedKey = Object.keys(mappings).find(k => {
                const afterTilde = mappings[k].restoredKey;
                const normalizedKey = afterTilde
                    .replace(/\s+/g, ' ')
                    .replace(/\s+([:.,!?])/g, '$1')
                    .replace(/>\s+</g, '><')
                    .trim();
                return normalizedKey === originalText;
            });

            if (matchedKey) {
                const parsedObj = mappings[matchedKey];
                const tCall = buildTCall(pageKey, matchedKey, parsedObj.keyPlaceholders, parsedObj.valuePlaceholders, contentType);

                if (!tCall) {
                    console.warn(`⚠️ Failed to build $t() for key: ${matchedKey}`);
                    continue;
                }

                const start = match.index + match[0].indexOf(originalText);
                const end = start + originalText.length;

                s.overwrite(start, end, `{{ ${tCall} }}`);
                // console.log(`✅ Replaced (non-greedy): "${originalText}"`);
            }
        }

        // Pass 2: Interpolation blocks like {{ `...` }}
        const interpolationRegex = /\{\{\s*([\s\S]*?)\s*\}\}/g;
        while ((match = interpolationRegex.exec(content)) !== null) {
            const exprContent = match[1].trim();
            // Only handle template literals
            if (exprContent.startsWith('`') && exprContent.endsWith('`')) {
                // Remove backticks
                let pureString = exprContent.slice(1, -1);

                // Trim possible inner whitespace
                pureString = pureString.trim();

                // Remove any unnecessary extra spaces inside (normalize)
                const normalizedPureString = pureString
                    .replace(/\s+/g, ' ')
                    .replace(/\s+([:.,!?])/g, '$1')
                    .trim();

                const matchedKey = Object.keys(mappings).find(k => {
                    const normalizedKey = mappings[k].restoredKey
                        .replace(/\s+/g, ' ')
                        .replace(/\s+([:.,!?])/g, '$1')
                        .trim();
                    return normalizedKey === normalizedPureString;
                });

                if (matchedKey) {
                    const parsedObj = mappings[matchedKey];
                    const tCall = buildTCall(pageKey, matchedKey, parsedObj.keyPlaceholders, parsedObj.valuePlaceholders, contentType);
                    if (!tCall) {
                        console.warn(`⚠️ Failed to build $t() for interpolated key: ${matchedKey}`);
                        continue;
                    }

                    const start = match.index;
                    const end = start + match[0].length;
                    s.overwrite(start, end, `{{ ${tCall} }}`);
                }
            }
        }

        return s.toString();
    }else{
        Object.keys(mappings)
        .sort((a, b) => b.length - a.length)
        .forEach(key => {
            const parsedObj = mappings[key];
            const pattern = buildFlexiblePattern(parsedObj.restoredKey);
            const regex = new RegExp(pattern, 'g');

            const tCall = buildTCall(pageKey, key, parsedObj.keyPlaceholders, parsedObj.valuePlaceholders, contentType);

            if(!tCall) {
                console.warn(`⚠️ Failed to build $t() call for key: ${key}. Key placeholders: ${parsedObj.keyPlaceholders}, Value placeholders: ${parsedObj.valuePlaceholders}`);
                return;
            }

            content = content.replace(regex, (match, offset, fullStr) => {
                // Skip if inside an import statement
                const before = fullStr.lastIndexOf('\n', offset) + 1;
                const line = fullStr.slice(before, fullStr.indexOf('\n', offset + match.length));
                if (line.trim().startsWith('import')) {
                    return match;
                }
                // Find last t( or $t( before this offset
                const tStart = fullStr.lastIndexOf('t(', offset);
                const dollarTStart = fullStr.lastIndexOf('$t(', offset);

                const skipT = (tStart !== -1 && tStart < offset && fullStr.indexOf(')', tStart) > offset);
                const skipDollarT = (dollarTStart !== -1 && dollarTStart < offset && fullStr.indexOf(')', dollarTStart) > offset);

                if (skipT || skipDollarT) {
                    // ✅ Skip replacement
                    return match;
                }

                if (contentType === 'template') {
                    return `{{ ${tCall} }}`;
                } else {
                    return `${tCall}`;
                }
            });
        });

        return content;
    }
}
function buildFlexiblePattern(str) {
    let p = str.trim();

    // Escape regex special characters first
    p = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace flexible whitespaces
    p = p.replace(/\s+/g, '\\s+');

    // Support flexible placeholders (if any)
    p = p.replace(/{{\\s*([a-zA-Z0-9_.]+)\\s*}}/g, '{{\\s*$1\\s*}}');

    // Now allow to optionally match backticks around the whole string
    // This works by adding ^`? at the start and `?$ at the end
    // Example final regex: ^`?escapedPattern`?$

    const finalPattern = '`?' + p + '`?';

    return finalPattern;
}

// Replace whole pointer class translation keys
function replaceTranslateAsWholePointerInTemplate(templateContent, originalMappings, parsedMappings, pageKey) {
    const $ = load(templateContent, { decodeEntities: false, xmlMode: false });

    const updates = [];

    $('[class], [:class]').each(function () {
        const el = $(this);
        const rawClass = el.attr('class') || el.attr(':class');
        if (!rawClass) return;
        // console.log(`Processing element with class: ${rawClass}`, rawClass.includes('translate-as-whole-pointer'));
        if (!rawClass.includes('translate-as-whole-pointer')) return;

            
        // const outerHTML = $.html(el); // snapshot before change
        const oldInner = el.html();
        // console.log(`Processing block: ${outerHTML}, oldInner: ${oldInner}`);
        // Process inner as you do
        const inner$ = load(`<root>${oldInner}</root>`, { decodeEntities: false, xmlMode: true });
        const rootNodes = inner$('root').contents().toArray();

        let keyBase = buildKeyBase(rootNodes);
        // console.log(`Processing block111: ${outerHTML}, oldInner: ${oldInner}, keyBase: ${keyBase}`);
        keyBase = keyBase
        .replace(/\s+/g, ' ')
        .replace(/\s+([:.,!?])/g, '$1')
        .replace(/>\s+</g, '><')
        .trim();

        const matchedKeys = Object.keys(originalMappings).filter(key => {
            const actualKeyBase = key.split('~~')[1];
            if (!actualKeyBase) return false;
            const normalizedJsonKey = actualKeyBase
                .replace(/\s+/g, ' ')
                .replace(/\s+([:.,!?])/g, '$1')
                .replace(/>\s+</g, '><')
                .trim();
            return normalizedJsonKey === keyBase;
        });

        matchedKeys.sort((a, b) => {
            const aIdx = parseInt(a.match(/^(\d+)/)[1], 10);
            const bIdx = parseInt(b.match(/^(\d+)/)[1], 10);
            return aIdx - bIdx;
        });

        if (matchedKeys.length === 0) {
            console.warn(`⚠️ No matching keys for block (baseKey): "${keyBase}"`);
            return;
        }

        let result = '';
        let matchedKeyIdx = 0;

        matchedKeys.forEach((key) => {
            const actualKeyBase = key.split('~~')[1];
            if (!actualKeyBase) {
                console.warn(`⚠️ Skipping invalid key for translate-as-whole-pointer: ${key}`);
                return;
            }

            const isNested = key.includes('Nested');
            const { keyPlaceholders, valuePlaceholders } = parsedMappings[actualKeyBase] || {};
            const tCall = buildTCall(pageKey, key, keyPlaceholders, valuePlaceholders, 'template');

            if (!tCall) {
                console.warn(`⚠️ Failed to build $t() for key: ${key}`);
                return;
            }

            if (isNested) {
                let tagNode = null;
                while (matchedKeyIdx < rootNodes.length) {
                if (rootNodes[matchedKeyIdx].type === 'tag') {
                    tagNode = rootNodes[matchedKeyIdx];
                    matchedKeyIdx++;
                    break;
                }
                matchedKeyIdx++;
                }
                if (tagNode) {
                    const tagName = tagNode.name;
                    const attribs = Object.entries(tagNode.attribs || {})
                        .map(([k, v]) => `${k}="${v}"`)
                        .join(' ');
                    result += `<${tagName}${attribs ? ' ' + attribs : ''}>{{ ${tCall} }}</${tagName}>`;
                } else {
                    result += `{{ ${tCall} }}`;
                }
            } else {
                result += `{{ ${tCall} }}`;
            }
        });

        // Append any leftover tags
        for (; matchedKeyIdx < rootNodes.length; matchedKeyIdx++) {
            const node = rootNodes[matchedKeyIdx];
            if (node.type === 'tag') {
                const tagName = node.name;
                const attribs = Object.entries(node.attribs || {})
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ');
                result += `<${tagName}${attribs ? ' ' + attribs : ''}></${tagName}>`;
            }
        }
        // Find original opening tag via regex
        const tagName = el[0].name;
        const tagPattern = new RegExp(`<${tagName}[^>]*?translate-as-whole-pointer[^>]*?>`, 'm');
        const match = templateContent.match(tagPattern);

        if (!match) {
            console.warn(`⚠️ Could not locate tag in raw content: <${tagName}>`);
            return;
        }

        const openTag = match[0];
        const start = match.index + openTag.length;
        const closeTag = `</${tagName}>`;
        const end = templateContent.indexOf(closeTag, start);

        if (end === -1) {
            console.warn(`⚠️ Could not find closing tag for <${tagName}>`);
            return;
        }

        templateContent = templateContent.slice(0, start) + result + templateContent.slice(end);

        
        // 🔥 Directly set new inner HTML on the element
        if( result ){
            // updates.push({ oldInner, newInner: result, outerHTML });
            updates.push({ tag: tagName, replacedInner: result });
        }
    });
    updates.length > 0 && console.log(`🔄 Replaced ${updates.length} translate-as-whole-pointer blocks in template ${templateContent}`);
    
    return templateContent;
}
// Final buildKeyBase logic (help to simulate the translate-as-whole-pointer key structure)
function buildKeyBase(nodes) {
    let base = '';
    nodes.forEach(node => {
      if (node.type === 'text') {
        base += node.data;
      } else if (node.type === 'tag') {
        const children = node.children.filter(child => child.type !== 'comment');
        const childrenContent = buildKeyBase(children);
        if (childrenContent.trim()) {
          base += `<${childrenContent}>`;
        }
      }
    });
    return base;
}
function buildTCall(pageKey, key, keyPlaceholders, valuePlaceholders, contextType = 'template') {
    if(keyPlaceholders.length !== valuePlaceholders.length) {
        console.warn(`⚠️ Mismatched placeholders for key: ${key}. Key placeholders: ${keyPlaceholders}, Value placeholders: ${valuePlaceholders}`);
        return null;
    }
    // Build the $t() call
    if(keyPlaceholders.length === 0 && valuePlaceholders.length === 0) {
        if(contextType === 'template') {
            return pageKey ? `$t("${pageKey}[\\\"${key}\\\"]")` : `$t("${key}")`;
        } else {
            return pageKey ? `t("${pageKey}[\\\"${key}\\\"]")` : `t("${key}")`;
        }
    }else if(keyPlaceholders.length > 0 && valuePlaceholders.length > 0) {
        const tCallParams = buildTCallParams(keyPlaceholders, valuePlaceholders);
        if(contextType === 'template') {
            return pageKey ? `$t("${pageKey}[\\\"${key}\\\"]", { ${tCallParams} })` : `$t("${key}", { ${tCallParams} })`;
        }else {
            return pageKey ? `t("${pageKey}[\\\"${key}\\\"]", { ${tCallParams} })` : `t("${key}", { ${tCallParams} })`;
        }
    }
    return tCall;
}
function buildTCallParams(keyPlaceholders, valuePlaceholders) {
    const map = {};
    keyPlaceholders.forEach((placeholder, index) => {
        map[placeholder] = valuePlaceholders[index];
    });
    return Object.entries(map).map(([k, v]) => `${v}: ${k}`).join(", ");
}

module.exports = { replaceExtractedKeysInFilesWithTCall };
