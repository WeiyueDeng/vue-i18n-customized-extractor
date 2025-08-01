const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { parse } = require('@vue/compiler-sfc');
const { compile } = require('@vue/compiler-dom');
const babelParser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const { load } = require('cheerio');
const MagicString = require('magic-string');

function replace(targetDir, translationMappingPath, options = {}) {
    // the first level key will be added when write $t() call to the file, eg. HomePage -> $t("HomePage[\"keyOne\"]")
    // NOTES: should be the one in i18n config file
    const curPageKey = options.translationPageKey; // this is for t call replacement
    const pageKeys = options.pageKeys || []; // this is for customized component mapping
    // whether it is processing the translationMapping for translation-as-whole-pointer
    const isTranslationAsWholePointer = options.isTranslationAsWholePointer || false;
    const excludeFiles = options.excludeFiles || [];
    const configFilePath = path.resolve(process.cwd(), options.configFilePath);
    const templateOnly = options.templateOnly;
    const vueScriptMode = options.vueScriptMode || "Options";
    // NOTES: If the config file is not provided, it will use the default config file path: vue-i18n-customized-extractor.config.cjs
    // NOTES: If no config file is found, it will use the default config file data: null
    var configFileData = null;
    if(fs.existsSync(configFilePath)){
        configFileData = require(configFilePath);
    }
    const customizedComponentsMapping = parseCustomizedComponentMapping(configFileData?.customizedComponentsTranslationMap, pageKeys);

    // Step 1: Process translationMapping
    if (!fs.existsSync(translationMappingPath) || !translationMappingPath.endsWith('.json')) {
        console.warn(`⚠️ Translation mapping file does not exist or is not a .json file: ${translationMappingPath}`);
        return;
    }

    var originalTranslationMapping;
    try {
        originalTranslationMapping = JSON.parse(fs.readFileSync(translationMappingPath, 'utf-8'));
        console.log(`✅ Successfully loaded translation mapping from ${translationMappingPath}`);
    } catch (error) {
        console.error(`❌ Failed to parse translation mapping file: ${translationMappingPath}`, error.message);
        return;
    }
    const parsedTranslationMapping = parseTranslationMapping(originalTranslationMapping, isTranslationAsWholePointer);

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
        const ignorePatterns = [
            '**/node_modules/**',
            ...excludeFiles.flatMap(f =>
                fs.existsSync(f) && fs.statSync(f).isDirectory()
                    ? [f, `${f}/**`] // ignore the folder and everything under it
                    : [f]            // ignore the file
            ),
        ];
        console.log(`Processing folder: ${targetDir}`);
        vueFiles = glob.sync(`${targetDir}/**/*.vue`, { ignore: ignorePatterns });
        // If templateOnly is true, we only process .vue files
        if(!templateOnly && !isTranslationAsWholePointer) {
            jsFiles = glob.sync(`${targetDir}/**/*.{js,ts}`, { ignore: ignorePatterns });
        }
    }

    console.log(`Found ${vueFiles.length} .vue files`);
    console.log(`Found ${jsFiles.length} .js/.ts files`);

    // Step 2: Process Vue files
    vueFiles.forEach(file => {
        replaceTextInVueFile(file, originalTranslationMapping, parsedTranslationMapping, customizedComponentsMapping, templateOnly, isTranslationAsWholePointer, curPageKey, vueScriptMode);
    });

    // Step 3: Process JS/TS files
    jsFiles.forEach(file => {
        replaceTextInJSFile(file, parsedTranslationMapping, curPageKey);
    });
}
function parseCustomizedComponentMapping(customizedComponentsTranslationMap, pageKeys){
    if (!customizedComponentsTranslationMap){
        // If no customized components mapping is provided, return null
        return null;
    }else{
        // If has customized components mapping, parse it based on the pageKeys
        const parsedMapping = {};
        if(pageKeys?.length > 0) {
            // If pageKeys is provided, filter the customizedComponentsTranslationMap based on the pageKeys
            pageKeys.forEach(pageKey => {
                const mappingOfCurPageKey = customizedComponentsTranslationMap[pageKey];
                if(mappingOfCurPageKey){
                    Object.keys(mappingOfCurPageKey).forEach(componentName => {
                        const propsToExtract = mappingOfCurPageKey[componentName];
                        if(parsedMapping[componentName]){
                            // If the component already exists, add the new props to extract
                            parsedMapping[componentName] = new Set([...parsedMapping[componentName], ...propsToExtract]);
                        }else{
                            // If the component does not exist, create a new set of props to extract
                            parsedMapping[componentName] = new Set(propsToExtract);
                        }
                    });
                }
            });
        }else{
            // If no pageKeys is provided, parse the whole customizedComponentsTranslationMap
            Object.keys(customizedComponentsTranslationMap).forEach( key => {
                if(Array.isArray(customizedComponentsTranslationMap[key])){
                    // If The value is an array, it means the key is a component name and the value is an array of props to extract
                    const propsToExtract = customizedComponentsTranslationMap[key];
                    if(parsedMapping[key]){
                        // If the component already exists, add the new props to extract
                        parsedMapping[key] = new Set([...parsedMapping[key], ...propsToExtract]);
                    }else{
                        // If the component does not exist, create a new set of props to extract
                        parsedMapping[key] = new Set(propsToExtract);
                    }
                }else{
                    const mappingOfCurPageKey = customizedComponentsTranslationMap[key];
                    if(mappingOfCurPageKey){
                        Object.keys(mappingOfCurPageKey).forEach(componentName => {
                            const propsToExtract = mappingOfCurPageKey[componentName];
                            if(parsedMapping[componentName]){
                                // If the component already exists, add the new props to extract
                                parsedMapping[componentName] = new Set([...parsedMapping[componentName], ...propsToExtract]);
                            }else{
                                // If the component does not exist, create a new set of props to extract
                                parsedMapping[componentName] = new Set(propsToExtract);
                            }
                        });
                    }
                }
            });
        }

        return parsedMapping;
    }
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
            output[actualKey]['key'] = actualKey;
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
            output[key]['key'] = key;
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

function replaceTextInVueFile(filePath, originalTranslationMapping, parsedTranslationMapping, customizedComponentsMapping, templateOnly=false, isTranslationAsWholePointer, pageKey, vueScriptMode){
    const content = fs.readFileSync(filePath, 'utf-8');
    const { descriptor } = parse(content);
    const extractedStringsOffsetAndReplacementCollection = [];

    // 1. Process template
    if (descriptor.template) {
        const templateAst = compile(descriptor.template.content, { hoistStatic: false }).ast;
        // Start of <template> content in the .vue file
        const baseOffset = descriptor.template.loc.start.offset;
        const matchedKeysRelativeOffsetAndReplacementCollection = [];
        // get relative offsets and replacements from the template AST
        walkTemplateAstAndRecordMatch(templateAst, matchedKeysRelativeOffsetAndReplacementCollection, originalTranslationMapping, parsedTranslationMapping, customizedComponentsMapping, isTranslationAsWholePointer, pageKey);
        if (matchedKeysRelativeOffsetAndReplacementCollection.length > 0) {
            // Convert relative offsets to absolute offsets based on the template's start offset
            matchedKeysRelativeOffsetAndReplacementCollection.forEach(({ start, end, replacement }) => {
                extractedStringsOffsetAndReplacementCollection.push({
                    start: start + baseOffset,
                    end: end + baseOffset,
                    replacement
                });
            });
        }
    }

    // 2. Process script
    // NOTES: If templateOnly is true, we only process the template, not the script
    if ((descriptor.script || descriptor.scriptSetup) && !templateOnly && !isTranslationAsWholePointer) {
        const scriptContent = descriptor.script?.content || descriptor.scriptSetup?.content;
        // Start of <script> or <script setup> content in the .vue file
        const baseOffset = descriptor.script?.loc.start.offset || descriptor.scriptSetup?.loc.start.offset || 0;
        walkScriptContentInVueAndRecord(scriptContent, baseOffset, extractedStringsOffsetAndReplacementCollection, parsedTranslationMapping, pageKey, vueScriptMode);
    }

    // 3. use MagicString to replace the text based on extractedStringsOffsetAndReplacementCollection
    if (extractedStringsOffsetAndReplacementCollection.length > 0) {
        const magicString = new MagicString(content);
        extractedStringsOffsetAndReplacementCollection.forEach(({ start, end, replacement }) => {
            // console.log(`Replacing from ${start} to ${end} which is ${content.slice(start, end)} with "${replacement}"`);
            magicString.overwrite(start, end, replacement);
        });

        // Write the modified content back to the file
        fs.writeFileSync(filePath, magicString.toString(), 'utf-8');
        console.log(`✅ Replaced text in ${filePath}`);
    }
}

function walkTemplateAstAndRecordMatch(node, extractedStringsOffsetAndReplacementCollection, originalTranslationMapping, parsedTranslationMapping, customizedComponentsMapping, isTranslationAsWholePointer, pageKey) {
    // console.log('walkTemplateAst node:', node.type, node.content);
    if (!node) return;

    switch (node.type) {
        // ROOT
        case 0: 
        // ELEMENT 
        case 1:
        // IF_BRANCH
        case 10:{
            const hasClassPropNamedTranslateAsWholePointer = node.props?.some(prop => {
                // Check if the prop is a class or :class (type: 7) and contains translate-as-whole-pointer
                // NOTES: ":class" need to be parsed as JSON array, so we need to replace single quotes with double quotes and use JSON.parse() to get the array of classes 
                if( prop.type === 7 && prop.rawName === ':class') {
                    // If not processing translation-as-whole-pointer, handle :class extraction for translation mapping
                    if( !isTranslationAsWholePointer ) {
                        // Calculate the absolute start offset of the :class expression within the entire file
                        
                        // check if anything need to be extracted from the :class expression,
                        // or any $t() calls in the :class expression
                        if (prop.exp?.content) {
                            // Trim whitespace/newlines first
                            const cleanExpr = prop.exp.content.trim();
                            const replacementResults = walkClassPropsArray(cleanExpr, parsedTranslationMapping, pageKey);
                            if (replacementResults.length > 0) {
                                const classExprStartOffset = prop.exp.loc.start.offset;
                                // If there are any replacements, add them to the collection with absolute offsets
                                replacementResults.forEach(replacementResult => {
                                    extractedStringsOffsetAndReplacementCollection.push({
                                        // absolute start and end offsets of the replacement in the file
                                        start: classExprStartOffset + replacementResult.start,
                                        end: classExprStartOffset + replacementResult.end,
                                        replacement: replacementResult.replacement
                                    });
                                });
                            }
                        }
                    }
                    return containsClassViaRegexOrAST(prop.exp?.content ?? "", 'translate-as-whole-pointer', 'AST');
                }else if( prop.name === 'class') {
                    // console.log(`Processing class expression: ${prop.value.content}`);
                    return containsClassViaRegexOrAST(prop.value?.content ?? "", 'translate-as-whole-pointer');
                }
            });
            if( hasClassPropNamedTranslateAsWholePointer ) {
                // If the node has a class or :class prop named translate-as-whole-pointer:
                // -> Process the node only if isTranslationAsWholePointer is true
                if (isTranslationAsWholePointer) {
                    // Process the whole element as a single translation string
                    const {hasTCall, result, start, end} = processTranslationAsWholePointerClass(node);
                    if (!hasTCall && result) {
                        const possibleKeyBase = result.trim();
                        if(parsedTranslationMapping[possibleKeyBase]){
                            const replacement = getTranslationAsWholePointerReplacement(node, possibleKeyBase, originalTranslationMapping, parsedTranslationMapping[possibleKeyBase], pageKey);
                            extractedStringsOffsetAndReplacementCollection.push({
                                start,
                                end,
                                replacement
                            });
                        }
                    }
                }
            }else {
                // If the node does not have a class or :class prop named translate-as-whole-pointer:
                // -> Process the node only if isTranslationAsWholePointer is false
                if( !isTranslationAsWholePointer ) {
                    if(customizedComponentsMapping?.[node.tag]){
                        // console.log(`Found customized component: ${node.tag}`);
                        // Process customized component
                        const outputOfPropsReplacements = processCustomizedComponent(node, parsedTranslationMapping, customizedComponentsMapping, pageKey);
                        extractedStringsOffsetAndReplacementCollection.push(...outputOfPropsReplacements);
                    }
                }
                // Recurse into children: deep dive into the AST
                if (node.children && node.children.length) { 
                    node.children.forEach(child => walkTemplateAstAndRecordMatch(child, extractedStringsOffsetAndReplacementCollection, originalTranslationMapping, parsedTranslationMapping, customizedComponentsMapping, isTranslationAsWholePointer, pageKey));
                }
            }
            break;
        }

        // Text Call
        case 12: {
            // Process text call nodes, deep dive into the node's content property
            walkTemplateAstAndRecordMatch(node.content, extractedStringsOffsetAndReplacementCollection, originalTranslationMapping, parsedTranslationMapping, customizedComponentsMapping, isTranslationAsWholePointer, pageKey);
            
            break;
        }

        // v-for
        case 11: {
            // Recurse into children: deep dive into the AST
            if (node.children && node.children.length) { 
                node.children.forEach(child => walkTemplateAstAndRecordMatch(child, extractedStringsOffsetAndReplacementCollection, originalTranslationMapping, parsedTranslationMapping, customizedComponentsMapping, isTranslationAsWholePointer, pageKey));
            }
            break;
        }

        // If v-if, v-else-if, v-else
        case 9: {
            // Recurse into branches: deep dive into the AST for each if branch
            if (node.branches && node.branches.length) { 
                node.branches.forEach(branch => {
                    if( !isTranslationAsWholePointer ) {
                        // Extract string literals from branch.condition
                        if (branch.condition && branch.condition.content) {
                            const replacementResults = walkVueIfCondition(branch.condition.content, parsedTranslationMapping, pageKey);
                            if (replacementResults.length > 0) {
                                const branchConditionExprStartOffset = branch.condition.loc.start.offset;
                                // If there are any replacements, add them to the collection with absolute offsets
                                replacementResults.forEach(replacementResult => {
                                    extractedStringsOffsetAndReplacementCollection.push({
                                        // absolute start and end offsets of the replacement in the file
                                        start: branchConditionExprStartOffset + replacementResult.start,
                                        end: branchConditionExprStartOffset + replacementResult.end,
                                        replacement: replacementResult.replacement
                                    });
                                });
                            }
                        }
                    }
                    // Recurse deeper into this branch
                    walkTemplateAstAndRecordMatch(branch, extractedStringsOffsetAndReplacementCollection, originalTranslationMapping, parsedTranslationMapping, customizedComponentsMapping, isTranslationAsWholePointer, pageKey)
                });
            }
            break;
        }

        // COMPOUND_EXPRESSION: eg. "hi" + name, <div> hi {{ name }}</div>
        case 8: {
            if( !isTranslationAsWholePointer ) {
                // Process COMPOUND_EXPRESSION nodes
                const {hasTCall, result:results, start, end} = processCompoundExpression(node);
                if(!hasTCall) {
                    results.forEach(res => {
                        const posiibleKey = res.trim();
                        const matchedKeyInfoInTranslationMapping = parsedTranslationMapping[posiibleKey];
                        if(matchedKeyInfoInTranslationMapping){
                            // If the possibleKey is found in the translation mapping, 
                            extractedStringsOffsetAndReplacementCollection.push({
                                // absolute start and end offsets of the replacement in the file
                                start: start,
                                end: end,
                                replacement:`{{ ${buildTCall(pageKey, matchedKeyInfoInTranslationMapping.key, matchedKeyInfoInTranslationMapping.keyPlaceholders, matchedKeyInfoInTranslationMapping.valuePlaceholders, 'template')} }} `
                            });
                        }
                        // console.log("extractedStrings add 1:", res.trim());
                        // extractedStrings.add(res.trim());
                    });
                }
            }
            break;
        }

        // INTERPOLATION
        case 5: { // INTERPOLATION
            if( !isTranslationAsWholePointer ) {
                const results = processInterpolation(node);
                results.forEach(({result, hasTCall, start, end}) => {
                    // console.log('Found INTERPOLATION: after 2', 'result:', result);
                    if (!hasTCall) {
                    // if not a $t() call:
                        // check if the content is a { name } or similar 
                        // if so -> skip it! 
                        // **NOTES: normally for {{ name }}, we translate the assigned value for name in the script, not the template
                        // if not -> extract by adding in extractedStrings
                        if(!/^\{\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\}$/.test(result)){
                        //NOTES: only possible result is a template literal, e.g. `Hello ${name}`
                            const possibleKey = result.trim();
                            const matchedKeyInfoInTranslationMapping = parsedTranslationMapping[possibleKey];
                            if(matchedKeyInfoInTranslationMapping){
                                // If the possibleKey is found in the translation mapping, 
                                extractedStringsOffsetAndReplacementCollection.push({
                                    // absolute start and end offsets of the replacement in the file
                                    start: start,
                                    end: end,
                                    replacement: buildTCall(pageKey, matchedKeyInfoInTranslationMapping.key, matchedKeyInfoInTranslationMapping.keyPlaceholders, matchedKeyInfoInTranslationMapping.valuePlaceholders, 'template')
                                });
                            }
                            // console.log("extractedStrings add 4:", result.trim());
                            // extractedStrings.add(result.trim());
                        }            
                    }
                });
            }
            break;
        }


        // TEXT node
        case 2: {
            if( !isTranslationAsWholePointer ) {
                // console.log('Found TEXT node:', node.content);
                // Process TEXT nodes
                const text = node.content.trim();
                if (text) {
                    const possibleKey = text.trim();
                    const matchedKeyInfoInTranslationMapping = parsedTranslationMapping[possibleKey];
                    if(matchedKeyInfoInTranslationMapping){
                        // If the possibleKey is found in the translation mapping, 
                        extractedStringsOffsetAndReplacementCollection.push({
                            // absolute start and end offsets of the replacement in the file
                            start: node.loc.start.offset,
                            end: node.loc.end.offset,
                            replacement: `{{ ${buildTCall(pageKey, matchedKeyInfoInTranslationMapping.key, matchedKeyInfoInTranslationMapping.keyPlaceholders, matchedKeyInfoInTranslationMapping.valuePlaceholders, 'template')} }}`
                        });
                    }
                    // console.log("extractedStrings add 5:", text);
                    // extractedStrings.add(text);
                }
            }
            break;
        }
    
    }
}

function walkClassPropsArray(cleanExpr, parsedTranslationMapping, pageKey) {
    const outputOfExtractedStringsReplacementCollection = [];
    // Parse expression string
    try{
        const prefix = 'const _cls = ';
        const code = `${prefix}${cleanExpr};`;
        const programAst = babelParser.parse(code, {
            sourceType: 'module',
            plugins: ['typescript']
        });
        const offsetShift = prefix.length;
        // const exprAst = babelParser.parseExpression(cleanExpr);
       

        // const programAst = {
        //     type: 'Program',
        //     body: [
        //     {
        //         type: 'ExpressionStatement',
        //         expression: exprAst,
        //     },
        //     ],
        //     sourceType: 'module',
        // };

        traverse(programAst, {
            StringLiteral(path) {
                // Skip object keys (these are the class names)
                if (path.parent.type === 'ObjectProperty' && path.parent.key === path.node) {
                    // console.log(`Skipping class name key: ${path.node.value}`);
                    return;
                }
        
                // Skip string literals directly in array (static class names)
                if (path.parent.type === 'ArrayExpression') {
                    // console.log(`Skipping static array string: ${path.node.value}`);
                    return;
                }

                // console.log("extractedStrings add 6:", path.node.value);
                // extractedStrings.add(path.node.value);
                const possibleKey = path.node.value.trim();
                collectReplacementInfoForValuesInTag(path, possibleKey, parsedTranslationMapping, outputOfExtractedStringsReplacementCollection, pageKey, offsetShift);
            },
            TemplateLiteral(path) {
                const quasis = path.node.quasis;
                const expressions = path.node.expressions;
            
                let reconstructed = '';
            
                for (let i = 0; i < quasis.length; i++) {
                    reconstructed += quasis[i].value.cooked;
                
                    if (i < expressions.length) {
                        const exprCode = generate(expressions[i]).code;
                        reconstructed += '${' + exprCode + '}';
                    }
                }
                // console.log("extractedStrings add 7:", arg.value);
                // extractedStrings.add(reconstructed);
                const possibleKey = reconstructed.trim();
                collectReplacementInfoForValuesInTag(path, possibleKey, parsedTranslationMapping, outputOfExtractedStringsReplacementCollection, pageKey, offsetShift);
            },
            // CallExpression(path) {
                // Check for $t(...) calls
                // const callee = path.node.callee;
                // const arg = path.node.arguments[0];

                // if(includeT){
                //     if (callee?.type === 'Identifier' && callee?.name === '$t') {
                //         if (arg && arg.type === 'StringLiteral') {
                //             // console.log("extractedStrings add 8:", arg.value);
                //             // extractedStrings.add(arg.value);
                //             extractedStrings.add(JSON.stringify(
                //                 {
                //                     result: arg.value,
                //                     hasTCall: true
                //                 }
                //             ));
                //         }
                //         // ✅ Handle TemplateLiteral in $t(), 
                //         // eg. :class = "[
                //         //      {'dummy-webinar-video-card':curTab == $t(`EducationCenter['Webinars']`) && test == $t(`EducationCenter['test val {name}']`, {name: 'test'})},
                //         //      {'dummy-educational-video-card':curTab == 'Educational Videos'}
                //         //     ]";
                //         // NOTES: different structure from other $t() CallExpression in the processJSContent function
                //         if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
                //             const raw = arg.quasis.map(q => q.value.cooked).join('');
                //             // console.log("extractedStrings add 9:", raw);
                //             // extractedStrings.add(raw);
                //             extractedStrings.add(JSON.stringify(
                //                 {
                //                     result: raw, 
                //                     hasTCall: true
                //                 }
                //             ));
                //         }
                //     }else if(callee?.property?.type === 'Identifier' && callee?.property?.name === '$t'){
                //         // NOTES: in case, we still keep this logic which is the same as the one in processJSContent function
                //         // ✅ Handle TemplateLiteral with no interpolations, eg.`tkeyTestWithWholeLiteralKKKK ${this.$t("TestPage['tTkeyTestWithWholeLiteral']")}`;
                //         if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
                //             const raw = arg.quasis.map(q => q.value.cooked).join('');
                //             // console.log("extractedStrings add 10:", raw);
                //             // extractedStrings.add(raw);
                //             extractedStrings.add(JSON.stringify(
                //                 {
                //                     result: raw, 
                //                     hasTCall: true
                //                 }
                //             ));
                //         }
                //     }
                // }
            // },
        });
        return outputOfExtractedStringsReplacementCollection;
    } catch (err) {
        console.warn(`Failed of walkClassPropsArray: ${cleanExpr}`, err);
    }
}

function walkVueIfCondition(exprStr, parsedTranslationMapping, pageKey) {
    const outputOfExtractedStringsReplacementCollection = [];
    try {
        const prefix = 'const _cls = ';
        const code = `${prefix}${exprStr};`;
        const programAst = babelParser.parse(code, {
            sourceType: 'module',
            plugins: ['typescript']
        });
        const offsetShift = prefix.length;

        // const exprAst = babelParser.parseExpression(exprStr);

        // const programAst = {
        //     type: 'Program',
        //     body: [
        //       {
        //         type: 'ExpressionStatement',
        //         expression: exprAst,
        //       },
        //     ],
        //     sourceType: 'module',
        //   };
      

        traverse(programAst, {
            StringLiteral(path) {
                // console.log("extractedStrings add 11:", path.node.value);
                // extractedStrings.add(path.node.value);
                const possibleKey = path.node.value.trim();
                collectReplacementInfoForValuesInTag(path, possibleKey, parsedTranslationMapping, outputOfExtractedStringsReplacementCollection, pageKey, offsetShift);
            },
            TemplateLiteral(path) {
                const quasis = path.node.quasis;
                const expressions = path.node.expressions;
            
                let reconstructed = '';
            
                for (let i = 0; i < quasis.length; i++) {
                reconstructed += quasis[i].value.cooked;
            
                if (i < expressions.length) {
                    const exprCode = generate(expressions[i]).code;
                    reconstructed += '${' + exprCode + '}';
                }
                }
                // console.log("extractedStrings add 12:", reconstructed);
                // extractedStrings.add(reconstructed);
                const possibleKey = reconstructed.trim();
                collectReplacementInfoForValuesInTag(path, possibleKey, parsedTranslationMapping, outputOfExtractedStringsReplacementCollection, pageKey, offsetShift);
            },
            // CallExpression(path) {
            //     // Check for $t(...) calls
            //     const callee = path.node.callee;
            //     const arg = path.node.arguments[0];

            //     if(includeT){
            //         if (callee?.type === 'Identifier' && callee?.name === '$t') {
            //             // console.log("extractedStrings add 7:", JSON.stringify(arg, null, 2));
            //             if (arg && arg.type === 'StringLiteral') {
            //                 // console.log("extractedStrings add 13:", arg.value);
            //                 // extractedStrings.add(arg.value);
            //                 extractedStrings.add(JSON.stringify(
            //                     {
            //                         result: arg.value,
            //                         hasTCall: true 
            //                     }
            //                 ));
            //             }
            //             // ✅ Handle TemplateLiteral with no interpolations, eg.`tkeyTestWithWholeLiteralKKKK ${this.$t("TestPage['tTkeyTestWithWholeLiteral']")}`;
            //             if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
            //                 const raw = arg.quasis.map(q => q.value.cooked).join('');
            //                 // console.log("extractedStrings add 14:", raw);
            //                 // extractedStrings.add(raw);
            //                 extractedStrings.add(JSON.stringify(
            //                     {
            //                         result: raw,
            //                         hasTCall: true 
            //                     }
            //                 ));
            //             }
            //         }else if(callee?.property?.type === 'Identifier' && callee?.property?.name === '$t'){
            //             // ✅ Handle TemplateLiteral with no interpolations, eg.`tkeyTestWithWholeLiteralKKKK ${this.$t("TestPage['tTkeyTestWithWholeLiteral']")}`;
            //             if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
            //                 const raw = arg.quasis.map(q => q.value.cooked).join('');
            //                 // console.log("extractedStrings add 15:", raw);
            //                 // extractedStrings.add(raw);
            //                 extractedStrings.add(JSON.stringify(
            //                     {
            //                         result: raw,
            //                         hasTCall: true 
            //                     }
            //                 ));
            //             }
            //         }
            //     }
            // },
        });
        return outputOfExtractedStringsReplacementCollection;
    } catch (err) {
        console.warn(`Failed to parse branch condition in walkVueIfBranches: ${exprStr}`, err);
    }
}

function containsClassViaRegexOrAST(exprStr, targetClass, method = 'regex') {
    // method can be 'regex' or 'AST'
    // console.log('containsClassRegexOnly input:', exprStr, 'method:', method);
    let hasClass = false;
    if(method==="AST"){
        try {
            const cleanExpr = exprStr.trim();
            const prefix = 'const _cls = ';
            const code = `${prefix}${cleanExpr};`;
            const programAst = babelParser.parse(code, {
                sourceType: 'module',
                plugins: ['typescript']
            });
            const offsetShift = prefix.length;

            // NOTES: the way below cannot cover all dynamic class value formats.
            // const exprAst = babelParser.parseExpression(cleanExpr);
    
            // const programAst = {
            //     type: 'Program',
            //     body: [
            //         {
            //             type: 'ExpressionStatement',
            //             expression: exprAst,
            //         },
            //     ],
            //     sourceType: 'module',
            // };
    
            traverse(programAst, {
                StringLiteral(path) {
                    // Check object keys
                    if (path.parent.type === 'ObjectProperty' && path.parent.key === path.node) {
                        if (path.node.value === targetClass) {
                            hasClass = true;
                        }
                    }
    
                    // Check array literals
                    if (path.parent.type === 'ArrayExpression') {
                        if (path.node.value === targetClass) {
                            hasClass = true;
                        }
                    }
                }
            });
        } catch (err) {
            console.warn(`Failed to parse expression: ${exprStr}`, err);
        }
    }else{
        // Split on whitespace to get individual classes
        const classList = exprStr.split(/\s+/);
        if (classList.includes(targetClass)) {
            hasClass = true;
        }
    }

    return hasClass;
}

function processCustomizedComponent(node, parsedTranslationMapping, customizedComponentsMapping, pageKey){
    const outputOfPropsReplacementCollection = [];
    //get the all props need to be extracted from the customized component
    const propsToExtract = customizedComponentsMapping[node.tag];
    node.props?.forEach(prop =>{
        if(prop.type === 7 && prop.rawName && propsToExtract?.has(prop.rawName.slice(1))){
        //NOTES: rawName is the name of the prop, e.g. :title, :content, etc. 
        //NOTES: need to check the part after the ":", e.g. title, content, etc.
            const propValue = prop.exp?.content;
            // console.log('Found prop with value:', propValue);
            const tKey = extractFirstTKeyFromString(propValue);
            if(!tKey && (/^`.*`\s*$/.test(propValue) || /^'.*'\s*$/.test(propValue))){
                // If the prop value is a template literal or in format of 'xxx', check if it is in translation mapping
                const possibleKey = propValue.slice(1,-1).trim();
                const matchedKeyInfoInTranslationMapping = parsedTranslationMapping[possibleKey];
                if(matchedKeyInfoInTranslationMapping) {
                    const start = prop.exp.loc.start.offset;
                    const end = prop.exp.loc.end.offset;
                    outputOfPropsReplacementCollection.push({
                        start: start,
                        end: end,
                        replacement: buildTCall(pageKey, matchedKeyInfoInTranslationMapping.key, matchedKeyInfoInTranslationMapping.keyPlaceholders, matchedKeyInfoInTranslationMapping.valuePlaceholders, 'templateTag')
                    });
                }
                // results.add(propValue.slice(1,-1));
            }
            //else: if the prop is simply a variable, e.g. title, content, etc. -> skip it! We will translate it in the script, not the template
        }else if( propsToExtract?.has(prop.name)) {
            const propValueNode = prop.value;
            if(propValueNode?.type === 2) {
                // If the prop value is a text node, replace value and prop name if has matched key in translation mapping
                const possibleKey = propValueNode.content.trim();
                const matchedKeyInfoInTranslationMapping = parsedTranslationMapping[possibleKey];
                if(matchedKeyInfoInTranslationMapping) {
                    const start = prop.value.loc.start.offset;
                    const end = prop.value.loc.end.offset;
                    outputOfPropsReplacementCollection.push({
                        start: start,
                        end: end,
                        // wrap in quotes
                        replacement: `"${buildTCall(pageKey, matchedKeyInfoInTranslationMapping.key, matchedKeyInfoInTranslationMapping.keyPlaceholders, matchedKeyInfoInTranslationMapping.valuePlaceholders, 'templateTag')}"`
                    });

                    // since it is changed to be a $t() call, we need to replace prop name. eg. title = "Hi" -> :title = "$t('Hi')"
                    const propNameStart = prop.loc.start.offset;
                    // `prop.name.length` = length of 'title' = 5
                    const propNameEnd = propNameStart + prop.name.length;
                    outputOfPropsReplacementCollection.push({
                        start: propNameStart,
                        end: propNameEnd,
                        replacement: `:${prop.name}` // add ":" to the prop name
                    });
                }

                // results.add(propValueNode.content.trim());
            }
        }
    });
    return outputOfPropsReplacementCollection;
}

function processTranslationAsWholePointerClass(node) {
// only need to check if the node type is 1;
    // concate all text nodes in the children
    // console.log('processTranslationAsWholePointerClass NODE:', node);
    var result = '';
    var hasTCall = false;
    node.children?.forEach(child => {
        // console.log('processTranslationAsWholePointerClass CHILD:', child);
        if (typeof child === 'string') return; // skip raw spacing
        if (child.type === 2) { // Text node
            if(child.content) {
                result += child.content;
            }
            // result += child.content;
        } else if (child.type === 12) { // Text call
            if ( child.content?.type === 2) {
                if(child.content.content) {
                    result += child.content.content;
                }
                // result += child.content.content;
            }else if (child.content?.type === 8) { // Compound expression
                const { hasTCall:childHasTCall, result: childResult } = processCompoundExpression(child.content, true);
                // console.log('type 12 processTranslationAsWholePointerClass type 8 childResult:', childResult);
                //NOTES: normally the childResult will be an array of length 1, when run processCompoundExpression for translation-as-whole-pointer class
                childResult.forEach(res => {
                    result += res;
                });
                // result += childResult;
                if (childHasTCall){
                    hasTCall = true;
                }
            }else if (child.content?.type === 5) { // Interpolation
                const childResults = processInterpolation(child.content, true);
                // console.log('type 12 processTranslationAsWholePointerClass type 5 childResult:', childResults);
                childResults.forEach(({hasTCall:childHasTCall, result: childResult}) => {
                    if(childResult) {
                        result += childResult;
                    }
                    // result += childResult;
                    if (childHasTCall){
                        hasTCall = true;
                    }
                });
            }
        }else if(child.type === 8) { // Compound expression
            const { hasTCall:childHasTCall, result: childResult } = processCompoundExpression(child, true);
            // console.log('type 8 processTranslationAsWholePointerClass childResult:', childResult);
            //NOTES: normally the childResult will be an array of length 1, when run processCompoundExpression for translation-as-whole-pointer class
            childResult.forEach(res => {
                result += res;
            });
            // result += childResult;
            if (childHasTCall){
                hasTCall = true;
            }
        }else if (child.type === 5) { // Interpolation
            const childResults = processInterpolation(child, true);
            // console.log('processTranslationAsWholePointerClass type 5 childResults:', childResults);
            childResults.forEach(({hasTCall:childHasTCall, result: childResult}) => {
                if(childResult) {
                    result += childResult;
                }
                // result += childResult;
                if (childHasTCall){
                    hasTCall = true;
                }
            });
        }else { // any other type
            // we can recursively process its children
            const {hasTCall:childHasTCall, result:childResult} = processTranslationAsWholePointerClass(child);
            if (childResult) {
                // Used for note the start of nest element content
                result += "<";
                result += childResult;
                // Used for notes the end of nest element content
                result += ">";
            }
            if (childHasTCall) {
                hasTCall = true;
            }
        }
    });
    return {
        hasTCall,
        result,
        start: node.loc.start.offset,
        end: node.loc.end.offset
    };
}


// type:8 -> Compound Epression eg. "hi" + name, <div> Hi {{ name }}</div>, <div> KK{{$t("HiKK { name }", {name: name})}} </div>, <div> {{button_name}} {{ name }}</div>,
function processCompoundExpression(node, isTranslationAsWholePointer = false) {
    // var result = '';
    var result = [];
    var hasTCall = false;
  
    node.children?.forEach(child => {
        if (typeof child === 'string') return; // skip raw spacing

        switch (child.type) {
            case 2: // Text node in expression
                // result += child.content.replace(/^'|'$/g, '');
                result.push(child.content.replace(/^'|'$/g, ''));
                break;
            case 5: { // Interpolation: eg. {{ name }}
                const  childResults = processInterpolation(child, isTranslationAsWholePointer, false);
                // console.log('processCompoundExpression childResults type 5:', childResults);
                childResults.forEach(({hasTCall:childHasTCall, result: childResult}) => {
                    if( isTranslationAsWholePointer ){
                    // If isTranslationAsWholePointer: means we are processing a translation-as-whole-pointer class, 
                        // so ANYWAY we need to add the result to the results array. For t calls, we will handle it later when add to extractedStringsOfTranslationAsWholePointer
                        result.push(childResult);
                    }else{
                    // If any childResult is hasTCall: we ONLY add t keys to the results array
                    // If NO childResult is hasTCall: we add all childResult to the results array
                        if( hasTCall ){
                        // NOTES: if hasTCall, means we have a $t() call in the previous parts.
                            // 1. If childHasTCall, means that childResult is a $t() call:
                            //  -> we add it to the results array, when previous parts has a $t() call.
                            if( childHasTCall ){
                                result.push(childResult);
                            }
                            // 2. else : if no childHasTCall, means that childResult is not a $t() call,
                            // -> we do not add it to the results array, when previous parts has a $t() call.
                        }else{
                        //If NOT hasTCall, means we do not have a $t() call in the previous parts.
                            // 1. If current childResult has a $t() call,
                            // -> we reset the result to only include the current childResult, and will only add other t keys in later loop.
                            if( childHasTCall ){
                                result = [childResult];
                            }else{
                            // 2. If current childResult does not have a $t() call,
                            // -> we add it to the results array, when previous parts has no $t() call.
                                result.push(childResult);
                            }
                        }

                    }
                    //update hasTCall if childHasTCall is true, for next loop
                    if (childHasTCall) {
                        hasTCall = true;
                    }
                });
                break;
            }
        
            default:
                // Unknown type — skip or handle if needed
                break;
        }
    });

    if(isTranslationAsWholePointer || !hasTCall) {
    // If isTranslationAsWholePointer or not hasTCall, we need to return the whole content as it is
        result = [result.join('')]; // join all parts together
    }

    const firstChild = node.children[0];
    const lastChild = node.children[node.children.length - 1];
    const innerStart = firstChild.loc.start.offset;
    const innerEnd = lastChild.loc.end.offset;

    return {
        hasTCall,
        result,
        start: innerStart,
        end: innerEnd
    };
}

// type: 5 -> Interpolation: eg. {{ name }},
function processInterpolation(node, isTranslationAsWholePointer = false, checkTenaryExpression = true) {
    var results = [];
    // var hasTCall = false;
    const contentNode = node.content;
    const rawContent = node.loc.source.trim();
    const innerStartOffset = contentNode.loc.start.offset;
    const innerEndOffset = contentNode.loc.end.offset;

    if (contentNode.type === 4) {
    // if not a template literal, but a simple expression like {{ name }}, or {{ $t("Hello") }}
    //eg. {{ name }} -> return as '{ name }'
        // expr: Parsed, trimmed version of what was inside {{ ... }} → no {{ }} anymore
        const expr = contentNode.content;
        
        // NOTES: under this condition, the expr is a simple expression, e.g. name, $t("Hello"), etc.
        // NOTES: so if the expr is a $t() call, it will be only one $t() call, not multiple $t() calls
        const extractedResultsByHandlingTernaryExpression = extractStringsViaHandlingTernaryExpression(expr);
        // console.log('processInterpolation expr:', expr, 'extractedResultsByHandlingTernaryExpression:', extractedResultsByHandlingTernaryExpression);
        if(isTranslationAsWholePointer){
            var hasTCall = false;
            const tKey = extractFirstTKeyFromString(expr);
            if (tKey) {
                hasTCall = true;
            }
            result = rawContent.slice(1, -1); // return the whole content as it is
            // console.log('extractedResultsByHandlingTernaryExpression 1', result);
            results.push({result, hasTCall});
        }else if(extractedResultsByHandlingTernaryExpression.length === 0 || !checkTenaryExpression) {
            // console.log('extractedResultsByHandlingTernaryExpression 2', expr);
            const tKey = extractFirstTKeyFromString(expr);
            var result = '';
            var hasTCall = false;
            // console.log('processInterpolation expr:', expr, tKey);
            // Update hasTCall based on whether tKey is found
            if (tKey) {
                hasTCall = true;
            }

            if (/^`.*`\s*$/.test(expr)) {
            // if the content is a template literal (e.g. {{`Hello ${name}`}})
                // → extract
                // console.log('processInterpolation expr:', expr, 'tKey:', tKey);
                if (tKey) {
                    // hasTCall = true;
                    result = `${tKey}`;
                } else {
                    result = `${expr.slice(1, -1)}`; // remove the backticks
                }
            }else{
            // if the content is a simple expression (e.g. {{ name }})
                // → return as '{ name }'
                // console.log('processInterpolation expr:', expr, 'tKey:', tKey);
                if (tKey) {
                    // hasTCall = true;
                    result = `${tKey}`;
                } else {
                    // replace {{ name }} with { name }, {{name}} with {name}
                    result = rawContent.slice(1, -1);
                }
            }
            results.push({result, hasTCall, start: innerStartOffset, end: innerEndOffset});
        }else{
            // If the expr is a ternary expression, e.g. {{ name ? 'Hello' : 'Hi' }}
            // or a complex expression, e.g. {{ $t("Hello {name}", {name: name}) }}
            // we will extract the strings from the ternary expression
            extractedResultsByHandlingTernaryExpression.forEach( ({content:expr, isLiteralLikeValue, relativeStart, relativeEnd}) => {
                // console.log('extractedResultsByHandlingTernaryExpression 3:', expr, 'isLiteralLikeValue:', isLiteralLikeValue);
                if(isLiteralLikeValue) {
                    const tKey = extractFirstTKeyFromString(expr);
                    var result = '';
                    var hasTCall = false;
                    // console.log('extractedResultsByHandlingTernaryExpression:', expr, tKey);
                    // Update hasTCall based on whether tKey is found
                    if (tKey) {
                        hasTCall = true;
                    }

                    if (/^`.*`\s*$/.test(expr)) {
                    // if the content is a template literal (e.g. {{`Hello ${name}`}})
                        // → already extracted as `Hello ${name}`
                        // console.log('processInterpolation expr:', expr, 'tKey:', tKey);
                        // if the expr is a $t() call, add $t() call key to the result
                        if (tKey) {
                            // hasTCall = true;
                            result = `${tKey}`;
                        } else {
                        // if the expr is not a $t() call, just remove the backticks and return
                            result = `${expr.slice(1, -1)}`; // remove the backticks
                        }
                    }else{
                    // if the content is a simple expression (e.g. {{ name }})
                        // → return as '{ name }'
                        // console.log('processInterpolation expr:', expr, 'tKey:', tKey);
                        // console.log('extractedResultsByHandlingTernaryExpression: simple expression', expr, tKey, rawContent);
                        if (tKey) {
                            // hasTCall = true;
                            result = `${tKey}`;
                        } else {
                            // replace {{ name }} with { name }, {{name}} with {name}
                            result = expr.slice(1, -1);
                        }
                    }
                    results.push({result, hasTCall, start: innerStartOffset + relativeStart, end: innerStartOffset + relativeEnd});
                }
            });
        }
        
    }
    // console.log('processInterpolation results:', node.content.content, results);
    return results;

}

function extractFirstTKeyFromString(str) {
// NOTES: This function extracts the first string parameter from the first $t() call in a string.
    // Check if the expression is a $t() call
    const match = str.match(/\$t\s*\(\s*(['"`])((?:\\\1|.)*?)\1/);
    return match ? match[2] : null;
}

function extractStringsViaHandlingTernaryExpression(expression) {
    const result = [];
    // console.log('extractStringsViaHandlingTernaryExpression expression:', expression);
    try {
        const ast = babelParser.parseExpression(expression);
        // console.log('Found ConditionalExpression:',expression, ast);
        traverse({
            type: 'File',
            program: {
            type: 'Program',
            body: [{ type: 'ExpressionStatement', expression: ast }],
            sourceType: 'module',
            }
        }, {
            ConditionalExpression(path) {
                // console.log('Found ConditionalExpression:',expression);
                const { consequent, alternate } = path.node;
                [consequent, alternate].forEach(part => {
                    // Skip raw variable identifiers (like button_name)
                    // Only extract if it's a literal-like value
                    const raw = expression.slice(part.start, part.end);
                    result.push({
                        content:raw, 
                        isLiteralLikeValue: isLiteralLikeValue(part),
                        relativeStart: part.start,
                        relativeEnd: part.end
                    });
                });
            },
            LogicalExpression(path) {
                if (path.node.operator === '??') {
                    const right = path.node.right;
                    // console.log('Found LogicalExpression with ?? operator:',expression, isLiteralLikeValue(right));

                    // Skip raw variable identifiers (like button_name)
                    // Only extract if it's a literal-like value
                    const raw = expression.slice(right.start, right.end);
                    result.push({
                        content:raw, 
                        isLiteralLikeValue: isLiteralLikeValue(right),
                        relativeStart: right.start,
                        relativeEnd: right.end
                    });
                }
            }
        });
    } catch (e) {
        return [];
    }
    return result; // Return the original expression if no ternary found
}
// ✅ Only extract if it's a literal-like value (for ternary expressions)
function isLiteralLikeValue(node) {
    
    const output = (
      node.type === 'StringLiteral' ||
      node.type === 'NumericLiteral' ||
      node.type === 'TemplateLiteral' ||
      (node.type === 'CallExpression' &&
       node.callee?.type === 'Identifier' &&
       node.callee.name === '$t')
    );
    // console.log('isLiteralLikeValue node:', output);
    return output;
}

function walkScriptContentInVueAndRecord(scriptContent, baseOffset, extractedStringsOffsetAndReplacementCollection, parsedTranslationMapping, pageKey, vueScriptMode) {
    const matchedKeysReplacementsCollection = getMatchedKeysReplacementsCollectionInScript(scriptContent, parsedTranslationMapping, pageKey);
    // console.log(`matchedKeysReplacementsCollection: ${JSON.stringify(matchedKeysReplacementsCollection, null, 2)}`);
    matchedKeysReplacementsCollection.forEach(({start:relativeStart, end:relativeEnd, replacement}) => {
        extractedStringsOffsetAndReplacementCollection.push({
            start: relativeStart + baseOffset,
            end: relativeEnd + baseOffset,
            replacement: vueScriptMode == "Options" ? `this.$${replacement}` : replacement,
        });
    });
}
function replaceTextInJSFile(filePath, parsedTranslationMapping, pageKey) {
    // 1. Read the file content 
    const scriptContent = fs.readFileSync(filePath, 'utf-8');

    // 2. Parse the script content to get the matched keys replacements collection
    const matchedKeysReplacementsCollection = getMatchedKeysReplacementsCollectionInScript(scriptContent, parsedTranslationMapping, pageKey);

    // 3. Use magicString to replace the matched keys in the script content based matchedKeysReplacementsCollection
    const magicString = new MagicString(scriptContent);
    matchedKeysReplacementsCollection.forEach(({start, end, replacement}) => {
        magicString.overwrite(start, end, replacement);
    });
    fs.writeFileSync(filePath, magicString.toString(), 'utf-8');
    console.log(`Replaced text in ${filePath} with matched keys from translation mapping for page: ${pageKey}`);
}
function getMatchedKeysReplacementsCollectionInScript(code, parsedTranslationMapping, pageKey) {
    const outputOfMatchedKeysReplacementsCollection = [];
   
    const ast = babelParser.parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx']
    });
    // fs.writeFileSync('src/locales/structure.json', JSON.stringify(ast,null, 2));

    traverse(ast, {
        StringLiteral(path) {
            const parent = path.parent;

            // Ignore imports
            if (parent.type === 'ImportDeclaration') {
                return;
            }
            if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier') {
                return;

            }

            // Skip: window.open('https://example.com') and window.open('https://example.com', '_blank')
            if (
                parent.callee?.type === 'MemberExpression' &&
                parent.callee?.object?.name === 'window' &&
                parent.callee?.property?.name === 'open'
            ) {
                return;
            }

            // Skip: importLibrary('places')
            if (
                parent.type === 'CallExpression' &&
                parent.callee.type === 'MemberExpression' &&
                parent.callee.property?.name === 'importLibrary'
            ) {
                return;
            }

            //Skip import('some-module')
            if (
                parent.type === 'CallExpression' &&
                parent.callee.type === 'Import'
            ) {
                return;
            }

            // Ignore strings in console.log(...)
            if (
                parent.type === 'CallExpression' &&
                parent.callee.type === 'MemberExpression' &&
                parent.callee.object.name === 'console' &&
                parent.callee.property.name === 'log'
            ) {
                return;
            }

            // Skip emits: ['close']
            if (
                parent.type === 'ArrayExpression' &&
                (
                    path.findParent(p => 
                        p.isObjectProperty() && p.node.key.name === 'emits'
                    )
                )
            ) {
                // console.log("Exclude emits: ['close']");
                return;
            }

            // Skip $emit() or emit() calls
            if (
                parent.type === 'CallExpression' &&
                (
                  (parent.callee.type === 'MemberExpression' &&
                    (parent.callee.property?.name === '$emit' || parent.callee.property?.name === 'emit')) || // this.emit / this.$emit
                  (parent.callee.type === 'Identifier' &&
                    (parent.callee.name === '$emit' || parent.callee.name === 'emit'))              // just emit()
                )
            ) {
                return;
            }

            // Skip $refs usage
            if(path.findParent(p => {
                const node = p.node;
                return (
                node.type === 'MemberExpression' &&
                (
                    // Matches: this.$refs['something']
                    (node.object?.type === 'MemberExpression' &&
                    node.object.object?.type === 'ThisExpression' &&
                    node.object.property?.name === '$refs') ||

                    // Matches: $refs['something']
                    (node.object?.type === 'Identifier' && node.object.name === '$refs')
                )
                );
            })){
                return;
            }

            // Skip name: 'SomeName'
            if (
                path.parent.type === 'ObjectProperty' &&
                path.parent.key &&
                ((path.parent.key.type === 'Identifier' && path.parent.key.name === 'name') ||
                (path.parent.key.type === 'StringLiteral' && path.parent.key.value === 'name'))
            ) {
                return;
            }
  
            
            // Skip mapState, mapActions usage
            if (
                path.findParent(p => 
                    p.isCallExpression() &&
                    ['mapState', 'mapActions', 'mapGetters', 'mapMutations'].includes(p.node.callee.name)
                )
            ) {
                return;
            }

            // Skip $router, this.$router(), router, useRouter(), $route, this.$route, route, useRoute()
            if (
                path.findParent(p => {
                  const node = p.node;
              
                  if (
                    node.type === 'CallExpression' &&
                    node.callee?.type === 'MemberExpression' &&
                    node.callee.object?.type === 'Identifier' &&
                    ['router', '$router', 'route', '$route'].includes(node.callee.object.name)
                  ) {
                    return true;
                  }
                  
                  // Also handle this.$router.push(), this.$route.someMethod()
                  if (
                    node.type === 'CallExpression' &&
                    node.callee?.type === 'MemberExpression' &&
                    node.callee.object?.type === 'MemberExpression' &&
                    node.callee.object.object?.type === 'ThisExpression' &&
                    (node.callee.object.property?.name === '$router' || node.callee.object.property?.name === '$route')
                  ) {
                    return true;
                  }
                  
                  // Optionally, if you still want to catch direct useRouter().push() or useRoute().someMethod() (less common)
                  if (
                    node.type === 'CallExpression' &&
                    node.callee?.type === 'MemberExpression' &&
                    node.callee.object?.type === 'CallExpression' &&
                    node.callee.object.callee?.type === 'Identifier' &&
                    ['useRouter', 'useRoute'].includes(node.callee.object.callee.name)
                  ) {
                    return true;
                  }
              
                  return false;
                })
            ) {
                return;
            }

            // check $t() call
            if (parent.callee?.property?.type === 'Identifier' && parent.callee?.property?.name === '$t') {
                return;
            }

            // Otherwise, check match and record replacement data
            // console.log("extractedStrings add 17:", path.node.value);
            // extractedStrings.add(path.node.value);
            const possibleKey = path.node.value.trim();
            const matchedKeyDataInTranslationMapping = parsedTranslationMapping[possibleKey];
            if (matchedKeyDataInTranslationMapping) {
                outputOfMatchedKeysReplacementsCollection.push({
                    start: path.node.start,
                    end: path.node.end,
                    replacement: buildTCall(pageKey, matchedKeyDataInTranslationMapping.key, matchedKeyDataInTranslationMapping.keyPlaceholders, matchedKeyDataInTranslationMapping.valuePlaceholders, 'script')
                });
            }
        },
        // CallExpression(path) {
        //     const callee = path.node.callee;
        //     const arg = path.node.arguments[0];
        //     // console.log('Found $t() call 111111:', includeT, path.node.callee.property?.name, path.node.callee.property?.type, path.node.arguments[0]);
        //     if(includeT){
        //         if (callee?.type === 'Identifier' && callee?.name === '$t') {
        //             if (arg && arg.type === 'StringLiteral') {
        //                 // console.log("extractedStrings add 18:", arg.value);
        //                 // extractedStrings.add(arg.value);
        //                 extractedStrings.add(JSON.stringify(
        //                     {
        //                         result: arg.value,
        //                         hasTCall: true 
        //                     }
        //                 ));
        //             }
        //         }else if(callee?.property?.type === 'Identifier' && callee?.property?.name === '$t'){
        //              // ✅ Handle TemplateLiteral with no interpolations, eg.`tkeyTestWithWholeLiteralKKKK ${this.$t("TestPage['tTkeyTestWithWholeLiteral']")}`;
        //             if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
        //                 const raw = arg.quasis.map(q => q.value.cooked).join('');
        //                 // console.log("extractedStrings add 19:", raw);
        //                 // extractedStrings.add(raw);
        //                 extractedStrings.add(JSON.stringify(
        //                     {
        //                         result: raw,
        //                         hasTCall: true 
        //                     }
        //                 ));
        //             }
        //         }
        //     }
            
        // },
        TemplateLiteral(path) {
            const parent = path.parent;
            // console.log('Found $t() call 111111:',code.slice(path.node.start, path.node.end), parent.type);
            // Only extract if used in contexts like return, assignment, etc.
            if (
                parent.type === 'ReturnStatement' ||
                parent.type === 'VariableDeclarator' ||
                parent.type === 'ArrowFunctionExpression' ||
                // a = `is ${varB}`
                parent.type === 'VariableDeclarator' ||
                // reassigning a variable. eg. var a = `is ${varB}`; a = `is ${varB} C`;
                parent.type === 'AssignmentExpression' ||
                // a ? "b" : "c"
                parent.type === 'ConditionalExpression' ||
                // a?.b ?? "c"
                parent.type === 'LogicalExpression' 
            ) {
                // Check if it has any expressions (i.e. uses ${...})
                if (path.node.expressions.length > 0) {
                    const { start, end } = path.node;
                    const raw = code.slice(start, end); // This preserves the original `${...}` syntax
                    const tKey = extractFirstTKeyFromString(raw);
                    if (!tKey) {
                        // If it's just a template literal without $t(), add the raw content
                        const possibleKey = raw.slice(1, -1).trim();
                        const matchedKeyDataInTranslationMapping = parsedTranslationMapping[possibleKey];
                        if (matchedKeyDataInTranslationMapping) {
                            outputOfMatchedKeysReplacementsCollection.push({
                                start: start,
                                end: end,
                                replacement: buildTCall(pageKey, matchedKeyDataInTranslationMapping.key, matchedKeyDataInTranslationMapping.keyPlaceholders, matchedKeyDataInTranslationMapping.valuePlaceholders, 'script')
                            });
                        }
                        // console.log("extractedStrings add 21:", raw.slice(1, -1)); 
                        // extractedStrings.add(raw.slice(1, -1)); // Remove the backticks
                    }
                }
            }
        }
    });
    // console.log(`getMatchedKeysReplacementsCollectionInScript: ${JSON.stringify(outputOfMatchedKeysReplacementsCollection, null, 2)}`);
    return outputOfMatchedKeysReplacementsCollection;
}

function collectReplacementInfoForValuesInTag(path, possibleKey, parsedTranslationMapping, output, pageKey, offsetShift = 0) {
    const matchedKeyDataInTranslationMapping = parsedTranslationMapping[possibleKey];
    // relative to prop.exp.content
    if (matchedKeyDataInTranslationMapping) {
        const babelRelativeStart = path.node.start;
        const babelRelativeEnd = path.node.end;
        output.push({
            start: babelRelativeStart - offsetShift,
            end: babelRelativeEnd - offsetShift,
            replacement: buildTCall(pageKey, matchedKeyDataInTranslationMapping.key, matchedKeyDataInTranslationMapping.keyPlaceholders, matchedKeyDataInTranslationMapping.valuePlaceholders, 'templateTag'),
        });
    }
}

function buildTCall(pageKey, key, keyPlaceholders, valuePlaceholders, contextType = 'template') {
    if(keyPlaceholders.length !== valuePlaceholders.length) {
        console.warn(`⚠️ Mismatched placeholders for key: ${key}. Key placeholders: ${keyPlaceholders}, Value placeholders: ${valuePlaceholders}`);
        return null;
    }
    // Build the $t() call
    if(keyPlaceholders.length === 0 && valuePlaceholders.length === 0) {
        if(contextType === 'templateTag') {
            // use single quotes for template tags replacement
            return pageKey ? `$t('${pageKey}[\\\'${key}\\\']')` : `$t('${key}')`;
        }else if(contextType === 'template') {
            return pageKey ? `$t("${pageKey}[\\\"${key}\\\"]")` : `$t("${key}")`;
        } else {
            return pageKey ? `t("${pageKey}[\\\"${key}\\\"]")` : `t("${key}")`;
        }
    }else if(keyPlaceholders.length > 0 && valuePlaceholders.length > 0) {
        const tCallParams = buildTCallParams(keyPlaceholders, valuePlaceholders);
        if(contextType === 'templateTag') {
            // use single quotes for template tags replacement
            return pageKey ? `$t('${pageKey}[\\\'${key}\\\']', { ${tCallParams} })` : `$t('${key}', { ${tCallParams} })`;
        }else if(contextType === 'template') {
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
function getTranslationAsWholePointerReplacement(node, keyBase, originalMappings, matchedKeyInfoInParsedTranslationMapping, pageKey) {
    // Process target code
    const $ = load(node.loc.source, { decodeEntities: false, xmlMode: true });

    // Find the first tag node — assumes `oldHTML` contains only one root element
    const rootNode = $.root().children().toArray().find(n => n.type === 'tag');

    if (!rootNode) {
    throw new Error('No root tag found in oldHTML');
    }

    const tagName = rootNode.name;
    const attribs = Object.entries(rootNode.attribs || {})
        .map(([k, v]) => `${k}="${v}"`)
        .join(' '); 

    // Now select that tag dynamically and Get all its inner nodes
    const rootNodes = $(`${tagName}`).contents().toArray();

    const matchedKeys = Object.keys(originalMappings).filter(key => {
        const actualKeyBase = key.split('~~')[1];
        if (!actualKeyBase) return false;
        return actualKeyBase === keyBase;
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
        const tCall = buildTCall(pageKey, key, matchedKeyInfoInParsedTranslationMapping.keyPlaceholders, matchedKeyInfoInParsedTranslationMapping.valuePlaceholders, 'template');

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
    // ✅ Wrap in the original opening and closing tag
    return `<${tagName}${attribs ? ' ' + attribs : ''}>${result}</${tagName}>`;
}

module.exports = { replace };
