// <div> Hi {{ name }}</div> -> "Hi { name }"
// <div> {{ `Hei ${name} literal`}}</div> -> "`Hei ${name} literal`"
// <div> KK{{$t("HiKKT { name }", {name: name})}} </div> -> if includeT: "HiKKT { name }"; if not includeT: skip it
// <div> {{$t("Hello")}} </div> -> if includeT: "Hello"; if not includeT: skip it
// <div> {{$t("Hi { name }", {name: name})}} </div> -> if includeT: "Hi { name }"; if not includeT: skip it
// <div> {{ name }}</div> -> skip it
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { parse } = require('@vue/compiler-sfc');
const { compile } = require('@vue/compiler-dom');
const babelParser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const harcode_skip_string_collection = [
    //value of 'typeof' in Vue.js
    'string',
    'object',
    // common strings that don't need translation
    'MM/DD/YYYY',
    'YYYY-MM-DD',
];

function run(targetDir, options = {}) {
    const includeT = options.includeT || false;
    const excludeFiles = options.excludeFiles || [];
    const pageKeys = options.pageKeys || [];
    const configFilePath = path.resolve(process.cwd(), options.configFilePath);
    const templateOnly = options.templateOnly;
    // NOTES: If the config file is not provided, it will use the default config file path: vue-i18n-customized-extractor.config.cjs
    // NOTES: If no config file is found, it will use the default config file data: null
    var configFileData = null;
    if(fs.existsSync(configFilePath)){
        configFileData = require(configFilePath);
    }
    const customizedComponentsMapping = parseCustomizedComponentMapping(configFileData?.customizedComponentsTranslationMap, pageKeys);

    const extractedStrings = new Set();
    const extractedStringsOfTranslationAsWholePointer = new Set();
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
        if(!templateOnly){
            jsFiles = glob.sync(`${targetDir}/**/*.{js,ts}`, { ignore: ignorePatterns });
        }
    }

    console.log(`Found ${vueFiles.length} .vue files: ${vueFiles.join(', ')}`);
    console.log(`Found ${jsFiles.length} .js/.ts files: ${jsFiles.join(', ')}`);

    // Step 2: Process Vue files
    vueFiles.forEach(file => processVueFile(file, extractedStrings, extractedStringsOfTranslationAsWholePointer, includeT, customizedComponentsMapping, templateOnly));

    // Step 3: Process JS/TS files
    jsFiles.forEach(file => processJSContent(file, extractedStrings, includeT, true));

    // Step 4: Output JSON
    const outputOfExtractedStrings = {};
    Array.from(extractedStrings).sort().forEach(strObjStr => {
        const strObj = JSON.parse(strObjStr);
        const { result: str, hasTCall } = strObj;
        const strTrimmed = str.trim();
        // Check if the string is a bracket notation (e.g. TestPage['Hi {name}'])
        // **NOTES: Since each page keeps its own translation key-value mapping, 
        // **NOTES: normally if we extracted exsiting $t() calls, we can assume it will be something like: $t("TestPage['Hi {name}']")
        // **NOTES: In extractedStrings, we already extracted the string without the $t() call, so it will be like: "TestPage['Hi {name}']"
        // **NOTES: If the string is in bracket notation, we will parse it to be: eg. TestPage: { "Hi {name}": "Hi {name}" }
        const parsedResult = parseBracketNotation(strTrimmed);
        if( includeT && hasTCall) {
            if(!outputOfExtractedStrings["Existing $t() calls' keys"]){
                // If the "Existing $t() calls' keys" does not exist, create a new object
                outputOfExtractedStrings["Existing $t() calls' keys"] = {};
            }
            if (parsedResult) {
                // If the string is in bracket notation, parse it to be: 
                // eg. TestPage: { "Hi {name}": "Hi {name}" }
                const { objectName: pageKey, keyName:pageTranslateValue } = parsedResult;
                // console.log(!isUrl(pageTranslateValue));
                if(pageTranslateValue && !isUrl(pageTranslateValue) && !harcode_skip_string_collection.includes(pageTranslateValue)){
                // NOTES: doesn't check isLikelyVariableLike(pageTranslateValue) here, because if parsedResult has value, most likely it is a key extracted from a $t() call when includeT is true
                    if(!outputOfExtractedStrings["Existing $t() calls' keys"]['nestedKeys']){
                        // If the "Existing $t() calls' keys" does not exist, create a new object
                        outputOfExtractedStrings["Existing $t() calls' keys"]['nestedKeys'] = {};
                    }
                    if(!outputOfExtractedStrings["Existing $t() calls' keys"]['nestedKeys'][pageKey]){
                        // If the pageKey does not exist, create a new object
                        outputOfExtractedStrings["Existing $t() calls' keys"]['nestedKeys'][pageKey] = [];
                    }
                    outputOfExtractedStrings["Existing $t() calls' keys"]['nestedKeys'][pageKey].push(pageTranslateValue);
                }
            }else{
                // console.log(isLikelyVariableLike(strTrimmed));
                // console.log(isUrl(strTrimmed));
            // If the string is not in bracket notation, and NOT a URL -> add it to the output
                if(strTrimmed && !isUrl(strTrimmed) && !isLikelyVariableLike(strTrimmed) && !harcode_skip_string_collection.includes(strTrimmed)){
                    if(!outputOfExtractedStrings["Existing $t() calls' keys"]['flatKeys']){
                        // If the "Existing $t() calls' keys" does not exist, create a new object
                        outputOfExtractedStrings["Existing $t() calls' keys"]['flatKeys'] = [];
                    }
                    outputOfExtractedStrings["Existing $t() calls' keys"]['flatKeys'].push(strTrimmed);
                }
            }
        }else{
            if (parsedResult) {
                // If the string is in bracket notation, parse it to be: 
                // eg. TestPage: { "Hi {name}": "Hi {name}" }
                const { objectName: pageKey, keyName:pageTranslateValue } = parsedResult;
                // console.log(!isUrl(pageTranslateValue));
                if(pageTranslateValue && !isUrl(pageTranslateValue) && !harcode_skip_string_collection.includes(pageTranslateValue)){
                // NOTES: doesn't check isLikelyVariableLike(pageTranslateValue) here, because if parsedResult has value, most likely it is a key extracted from a $t() call when includeT is true
                    if(outputOfExtractedStrings[pageKey]){
                        // If the pageKey already exists, add the new key-value pair
                        // NTOES: replace(/\$\{(.*?)\}/g, (_, key) => `{${key}}`) is used to replace ${key} with {key} for consistency. ONLY value.
                        outputOfExtractedStrings[pageKey][pageTranslateValue] = transformBracketPlaceholders(pageTranslateValue.replace(/\$\{(.*?)\}/g, (_, key) => `{${key}}`));
                    }else{
                        // If the pageKey does not exist, create a new object
                        // replace(/\$\{(.*?)\}/g, (_, key) => `{${key}}`) is used to replace ${key} with {key} for consistency. ONLY value.
                        outputOfExtractedStrings[pageKey] = { [pageTranslateValue]: transformBracketPlaceholders(pageTranslateValue.replace(/\$\{(.*?)\}/g, (_, key) => `{${key}}`)) };
                    }
                }
            }else{
                // console.log(isLikelyVariableLike(strTrimmed));
                // console.log(isUrl(strTrimmed));
            // If the string is not in bracket notation, and NOT a URL -> add it to the output
                if(strTrimmed && !isUrl(strTrimmed) && !isLikelyVariableLike(strTrimmed) && !harcode_skip_string_collection.includes(strTrimmed)){
                    outputOfExtractedStrings[strTrimmed] = transformBracketPlaceholders(strTrimmed.replace(/\$\{(.*?)\}/g, (_, key) => `{${key}}`));
                }
            }
        }
    });
    if (!fs.existsSync('src/locales')) {
        fs.mkdirSync('src/locales');
    }

    fs.writeFileSync('src/locales/en.json', JSON.stringify(outputOfExtractedStrings, null, 2));

    // Step 5: Output extractedStringsOfTranslationAsWholePointer, if any
    if(extractedStringsOfTranslationAsWholePointer.size > 0) {
        const outputOfExtractedStringsOfTranslationAsWholePointer = {};
        Array.from(extractedStringsOfTranslationAsWholePointer).sort().forEach(strObj => {
            // Check if the string is a bracket notation (e.g. TestPage['Hi {name}'])
            // **NOTES: Since each page keeps its own translation key-value mapping, 
            // **NOTES: normally if we extracted exsiting $t() calls, we can assume it will be something like: $t("TestPage['Hi {name}']")
            // **NOTES: In extractedStrings, we already extracted the string without the $t() call, so it will be like: "TestPage['Hi {name}']"
            // **NOTES: If the string is in bracket notation, we will parse it to be: eg. TestPage: { "Hi {name}": "Hi {name}" }
            const {result: str, hasTCall} = strObj;
            // NOTES: since we already filter the extracted output in previous steps, we only meet hasTCall string if includeT is true
            if( hasTCall && includeT) {
                const extractedTKeys = extractAllTKeysFromString(str);
                extractedTKeys.forEach(tKey => {
                    if(!outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]){
                        outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"] = {};
                    }
                    const parsedResult = parseBracketNotation(tKey);
                    if (parsedResult) {
                        // If the string is in bracket notation, parse it to be: 
                        // eg. TestPage: { "Hi {name}": "Hi {name}" }
                        const { objectName: pageKey, keyName:pageTranslateValue } = parsedResult;
                        const pageTranslateValueTrimmed = pageTranslateValue.trim();
                        if(!outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]['nestedKeys']){
                            // If the flatKeys does not exist, create a new array
                            outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]['nestedKeys'] = {};
                        }
                        if(!outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]['nestedKeys'][pageKey]){
                            // If the pageKey does not exist, create a new array
                            outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]['nestedKeys'][pageKey] = [];
                        }
                        // Add the pageTranslateValueTrimmed to the pageKey's set
                        outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]['nestedKeys'][pageKey].push(pageTranslateValueTrimmed);
                    }else{
                        // If the string is not in bracket notation, add it to the output
                        if(!outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]['flatKeys']){
                            // If the flatKeys does not exist, create a new array
                            outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]['flatKeys'] = [];
                        }
                        outputOfExtractedStringsOfTranslationAsWholePointer["Existing $t() calls' keys for translate-as-whole-pointer"]['flatKeys'].push(tKey);
                    }
                })
            }else {
                const parsedResult = parseBracketNotation(str);
                if (parsedResult) {
                    // If the string is in bracket notation, parse it to be: 
                    // eg. TestPage: { "Hi {name}": "Hi {name}" }
                    const { objectName: pageKey, keyName:pageTranslateValue } = parsedResult;
                    const pageTranslateValueTrimmed = pageTranslateValue.trim();
                    if(outputOfExtractedStringsOfTranslationAsWholePointer[pageKey]){
                        // If the pageKey already exists, add the new key-value pair
                        outputOfExtractedStringsOfTranslationAsWholePointer[pageKey][pageTranslateValueTrimmed] = transformBracketPlaceholders(pageTranslateValueTrimmed);
                    }else{
                        // If the pageKey does not exist, create a new object
                        outputOfExtractedStringsOfTranslationAsWholePointer[pageKey] = { [pageTranslateValueTrimmed]: transformBracketPlaceholders(pageTranslateValueTrimmed) };
                    }
                }else{
                    // If the string is not in bracket notation, add it to the output
                    outputOfExtractedStringsOfTranslationAsWholePointer[str.trim()] = transformBracketPlaceholders(str.trim());
                }
            }
            
            fs.writeFileSync('src/locales/en-TranslateAsWholePointer.json', JSON.stringify(outputOfExtractedStringsOfTranslationAsWholePointer, null, 2));
        });
    }

    console.log(`✅ Extracted ${extractedStrings.size} strings → src/locales/en.json`);
    console.log(`✅ Extracted ${extractedStringsOfTranslationAsWholePointer.size} strings → src/locales/en-TranslateAsWholePointer.json`);
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

function processVueFile(filePath, extractedStrings, extractedStringsOfTranslationAsWholePointer, includeT, customizedComponentsMapping, templateOnly = false) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { descriptor } = parse(content);

    // 1. Process template
    if (descriptor.template) {
        const templateAst = compile(descriptor.template.content, { hoistStatic: false }).ast;
        // fs.writeFileSync('src/locales/structure.json', JSON.stringify(templateAst,null, 2));
        walkTemplateAst(templateAst, extractedStrings, extractedStringsOfTranslationAsWholePointer, includeT, customizedComponentsMapping);
    }

    // 2. Process script
    // NOTES: If templateOnly is true, we only process the template, not the script
    if ((descriptor.script || descriptor.scriptSetup) && !templateOnly) {
        const scriptContent = descriptor.script?.content || descriptor.scriptSetup?.content;
        processJSContent(scriptContent, extractedStrings, includeT);
    }
}

function walkTemplateAst(node, extractedStrings, extractedStringsOfTranslationAsWholePointer, includeT, customizedComponentsMapping) {
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
                    // console.log(`Processing :class expression: ${prop.exp.content}`);
                    // check if anything need to be extracted from the :class expression,
                    // or any $t() calls in the :class expression
                    if (prop.exp?.content) {
                        // Trim whitespace/newlines first
                        const cleanExpr = prop.exp.content.trim();
                        walkClassPropsArray(cleanExpr, extractedStrings, includeT);
                    }
                    return containsClassViaRegexOrAST(prop.exp?.content ?? "", 'translate-as-whole-pointer', 'AST');
                }else if( prop.name === 'class') {
                    // console.log(`Processing class expression: ${prop.value.content}`);
                    return containsClassViaRegexOrAST(prop.value?.content ?? "", 'translate-as-whole-pointer');
                }
            });
            if( hasClassPropNamedTranslateAsWholePointer ) {
                // Process the whole element as a single translation string
                const {hasTCall, result} = processTranslationAsWholePointerClass(node, includeT);
                // console.log('processTranslationAsWholePointerClass result:', result, 'hasTCall:', hasTCall);
                if (((hasTCall && includeT) || !hasTCall) && result) {
                    extractedStringsOfTranslationAsWholePointer.add({result, hasTCall});
                }
            }else {
                if(customizedComponentsMapping?.[node.tag]){
                    // console.log(`Found customized component: ${node.tag}`);
                    // Process customized component
                    const results = processCustomizedComponent(node, includeT, customizedComponentsMapping);
                    results.forEach(({result, hasTCall}) => {
                        // console.log("extractedStrings add 1:", result);
                        // extractedStrings.add(result);
                        extractedStrings.add(JSON.stringify(
                            {
                                result: result.trim(),
                                hasTCall: hasTCall 
                            }
                        ));
                    });
                }
                // Recurse into children: deep dive into the AST
                if (node.children && node.children.length) { 
                    node.children.forEach(child => walkTemplateAst(child, extractedStrings, extractedStringsOfTranslationAsWholePointer, includeT, customizedComponentsMapping));
                }
            }
            break;
        }

        // Text Call
        case 12: {
            // Process text call nodes, deep dive into the node's content property
            walkTemplateAst(node.content, extractedStrings, extractedStringsOfTranslationAsWholePointer, includeT, customizedComponentsMapping);
            break;
        }

        // v-for
        case 11: {
            // Recurse into children: deep dive into the AST
            if (node.children && node.children.length) { 
                node.children.forEach(child => walkTemplateAst(child, extractedStrings, extractedStringsOfTranslationAsWholePointer, includeT, customizedComponentsMapping));
            }
            break;
        }

        // If v-if, v-else-if, v-else
        case 9: {
            // Recurse into branches: deep dive into the AST for each if branch
            if (node.branches && node.branches.length) { 
                node.branches.forEach(branch => {
                    // Extract string literals from branch.condition
                    if (branch.condition && branch.condition.content) {
                        walkVueIfCondition(branch.condition.content, extractedStrings, includeT);
                    }
                    // Recurse deeper into this branch
                    walkTemplateAst(branch, extractedStrings, extractedStringsOfTranslationAsWholePointer, includeT, customizedComponentsMapping);
                });
            }
            break;
        }

        // COMPOUND_EXPRESSION: eg. "hi" + name, <div> hi {{ name }}</div>
        case 8: {
            // Process COMPOUND_EXPRESSION nodes
            const {hasTCall, result} = processCompoundExpression(node, includeT);
            if((hasTCall && includeT) || !hasTCall) {
                result.forEach(res => {
                    // console.log("extractedStrings add 1:", res.trim());
                    // extractedStrings.add(res.trim());
                    extractedStrings.add(JSON.stringify(
                        {
                            result: res.trim(),
                            hasTCall: hasTCall // true if it contains $t() call
                        }
                    ));
                });
            }
            break;
        }

        // INTERPOLATION
        case 5: { // INTERPOLATION
            const results = processInterpolation(node, includeT);
            results.forEach(({result, hasTCall}) => {
                // console.log('Found INTERPOLATION: after 2', 'result:', result);
                if (hasTCall) {
                    if (includeT) {
                    //NOTES: under this condition, the result the key of the $t() call: eg. {{ $t("Hello {name}") }} -> "Hello {name}"
                        // console.log("extractedStrings add 3:", result.trim());
                        // extractedStrings.add(result.trim());
                        extractedStrings.add(JSON.stringify(
                            {
                                result: result.trim(),
                                hasTCall: true
                            }
                        ));
                    }
                }else{
                // if not a $t() call:
                    // check if the content is a { name } or similar 
                    // if so -> skip it! 
                    // **NOTES: normally for {{ name }}, we translate the assigned value for name in the script, not the template
                    // if not -> extract by adding in extractedStrings
                    if(!/^\{\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\}$/.test(result)){
                    //NOTES: only possible result is a template literal, e.g. `Hello ${name}`
                        // console.log("extractedStrings add 4:", result.trim());
                        // extractedStrings.add(result.trim());
                        extractedStrings.add(JSON.stringify(
                            {
                                result: result.trim(),
                                hasTCall: false
                            }
                        ));
                    }            
                }
            });
            break;
        }


        // TEXT node
        case 2: {
            // console.log('Found TEXT node:', node.content);
            // Process TEXT nodes
            const text = node.content.trim();
            if (text) {
                // console.log("extractedStrings add 5:", text);
                // extractedStrings.add(text);
                extractedStrings.add(JSON.stringify(
                    {
                        result: text,
                        hasTCall: false
                    }
                ));
            }
            break;
        }
    
    }
}

function walkClassPropsArray(cleanExpr, extractedStrings, includeT) {
    // Parse expression string
    try{
        const code = `const _cls = ${cleanExpr};`;
        const programAst = babelParser.parse(code, {
            sourceType: 'module',
            plugins: ['typescript']
        });
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
        
                // console.log(`Found string literal in condition: ${path.node.value}`);
                // console.log("extractedStrings add 6:", path.node.value);
                // extractedStrings.add(path.node.value);
                extractedStrings.add(JSON.stringify(
                    {
                        result: path.node.value,
                        hasTCall: false // No $t() call in :class expressions
                    }
                ));
                
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
                extractedStrings.add(JSON.stringify(
                    {
                        result: reconstructed,
                        hasTCall: false 
                    }
                ));
            },
            CallExpression(path) {
                // Check for $t(...) calls
                const callee = path.node.callee;
                const arg = path.node.arguments[0];

                if(includeT){
                    if (callee?.type === 'Identifier' && callee?.name === '$t') {
                        if (arg && arg.type === 'StringLiteral') {
                            // console.log("extractedStrings add 8:", arg.value);
                            // extractedStrings.add(arg.value);
                            extractedStrings.add(JSON.stringify(
                                {
                                    result: arg.value,
                                    hasTCall: true
                                }
                            ));
                        }
                        // ✅ Handle TemplateLiteral in $t(), 
                        // eg. :class = "[
                        //      {'dummy-webinar-video-card':curTab == $t(`EducationCenter['Webinars']`) && test == $t(`EducationCenter['test val {name}']`, {name: 'test'})},
                        //      {'dummy-educational-video-card':curTab == 'Educational Videos'}
                        //     ]";
                        // NOTES: different structure from other $t() CallExpression in the processJSContent function
                        if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
                            const raw = arg.quasis.map(q => q.value.cooked).join('');
                            // console.log("extractedStrings add 9:", raw);
                            // extractedStrings.add(raw);
                            extractedStrings.add(JSON.stringify(
                                {
                                    result: raw, 
                                    hasTCall: true
                                }
                            ));
                        }
                    }else if(callee?.property?.type === 'Identifier' && callee?.property?.name === '$t'){
                        // NOTES: in case, we still keep this logic which is the same as the one in processJSContent function
                        // ✅ Handle TemplateLiteral with no interpolations, eg.`tkeyTestWithWholeLiteralKKKK ${this.$t("TestPage['tTkeyTestWithWholeLiteral']")}`;
                        if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
                            const raw = arg.quasis.map(q => q.value.cooked).join('');
                            // console.log("extractedStrings add 10:", raw);
                            // extractedStrings.add(raw);
                            extractedStrings.add(JSON.stringify(
                                {
                                    result: raw, 
                                    hasTCall: true
                                }
                            ));
                        }
                    }
                }
            },
        });
    } catch (err) {
        console.warn(`Failed of walkClassPropsArray: ${cleanExpr}`, err);
    }
}

function walkVueIfCondition(exprStr, extractedStrings, includeT) {
    try {
        const code = `const _cls = ${exprStr};`;
        const programAst = babelParser.parse(code, {
            sourceType: 'module',
            plugins: ['typescript']
        });
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
                extractedStrings.add(JSON.stringify(
                    {
                        result: path.node.value,
                        hasTCall: false 
                    }
                ));
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
                extractedStrings.add(JSON.stringify(
                    {
                        result: reconstructed,
                        hasTCall: false 
                    }
                ));
            },
            CallExpression(path) {
                // Check for $t(...) calls
                const callee = path.node.callee;
                const arg = path.node.arguments[0];

                if(includeT){
                    if (callee?.type === 'Identifier' && callee?.name === '$t') {
                        // console.log("extractedStrings add 7:", JSON.stringify(arg, null, 2));
                        if (arg && arg.type === 'StringLiteral') {
                            // console.log("extractedStrings add 13:", arg.value);
                            // extractedStrings.add(arg.value);
                            extractedStrings.add(JSON.stringify(
                                {
                                    result: arg.value,
                                    hasTCall: true 
                                }
                            ));
                        }
                        // ✅ Handle TemplateLiteral with no interpolations, eg.`tkeyTestWithWholeLiteralKKKK ${this.$t("TestPage['tTkeyTestWithWholeLiteral']")}`;
                        if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
                            const raw = arg.quasis.map(q => q.value.cooked).join('');
                            // console.log("extractedStrings add 14:", raw);
                            // extractedStrings.add(raw);
                            extractedStrings.add(JSON.stringify(
                                {
                                    result: raw,
                                    hasTCall: true 
                                }
                            ));
                        }
                    }else if(callee?.property?.type === 'Identifier' && callee?.property?.name === '$t'){
                        // ✅ Handle TemplateLiteral with no interpolations, eg.`tkeyTestWithWholeLiteralKKKK ${this.$t("TestPage['tTkeyTestWithWholeLiteral']")}`;
                        if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
                            const raw = arg.quasis.map(q => q.value.cooked).join('');
                            // console.log("extractedStrings add 15:", raw);
                            // extractedStrings.add(raw);
                            extractedStrings.add(JSON.stringify(
                                {
                                    result: raw,
                                    hasTCall: true 
                                }
                            ));
                        }
                    }
                }
            },
        });
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
            const code = `const _cls = ${cleanExpr};`;
            const programAst = babelParser.parse(code, {
                sourceType: 'module',
                plugins: ['typescript']
            });

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

function processCustomizedComponent(node, includeT, customizedComponentsMapping){
    const results = [];
    //get the all props need to be extracted from the customized component
    const propsToExtract = customizedComponentsMapping[node.tag];
    node.props?.forEach(prop =>{
        if(prop.type === 7 && prop.rawName && propsToExtract?.has(prop.rawName.slice(1))){
        //NOTES: rawName is the name of the prop, e.g. :title, :content, etc. 
        //NOTES: need to check the part after the ":", e.g. title, content, etc.
            const propValue = prop.exp?.content;
            // console.log('Found prop with value:', propValue);
            const tKey = extractFirstTKeyFromString(propValue);
            if(tKey) {
                // If the prop value is a $t() call, add it to the results
                if(includeT) {
                    results.push({
                        result: tKey,
                        hasTCall: true 
                    });
                    // results.add(tKey);
                }
            }else if(/^`.*`\s*$/.test(propValue) || /^'.*'\s*$/.test(propValue)){
                // If the prop value is a template literal or in format of 'xxx', add it directly
                results.push({
                    result: propValue.slice(1,-1),
                    hasTCall: false, 
                });
                // results.add(propValue.slice(1,-1));
            }
            //else: if the prop is simply a variable, e.g. title, content, etc. -> skip it! We will translate it in the script, not the template
        }else if( propsToExtract?.has(prop.name)) {
            const propValueNode = prop.value;
            if(propValueNode?.type === 2) {
                // If the prop value is a text node, add it directly
                results.push({
                    result: propValueNode.content.trim(),
                    hasTCall: false,
                });
                // results.add(propValueNode.content.trim());
            }
            // ********* The following conditions won't happed *********************
            // else if(propValueNode?.type === 5) {
            //     // If the prop value is an interpolation, process it
            //     const results = processInterpolation(propValueNode, includeT);
            //     results.forEach(({result, hasTCall}) => {
            //         if( ((hasTCall && includeT) || !hasTCall) && result) {
            //             results.push({
            //                 result: result.trim(),
            //                 hasTCall: hasTCall 
            //             });
            //             // results.add(result.trim());
            //         }
            //     });
            // }else if(propValueNode?.type === 8) {
            //     // If the prop value is a compound expression, process it
            //     const { hasTCall, result } = processCompoundExpression(propValueNode, includeT);
            //     if((hasTCall && includeT) || !hasTCall) {
            //         result.forEach(res => {
            //             results.push({
            //                 result: res.trim(),
            //                 hasTCall: hasTCall 
            //             });
            //             // results.add(res.trim());
            //         });
            //     }
            // }
        }
    });
    return results;
}

function processTranslationAsWholePointerClass(node, includeT) {
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
                const { hasTCall:childHasTCall, result: childResult } = processCompoundExpression(child.content, includeT, true);
                // console.log('type 12 processTranslationAsWholePointerClass type 8 childResult:', childResult);
                //NOTES: normally the childResult will be an array of length 1, when run processCompoundExpression for translation-as-whole-pointer class
                if((childHasTCall && includeT) || !childHasTCall) {
                    childResult.forEach(res => {
                        result += res;
                    });
                }
                // result += childResult;
                if (childHasTCall){
                    hasTCall = true;
                }
            }else if (child.content?.type === 5) { // Interpolation
                const childResults = processInterpolation(child.content, includeT, true);
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
            const { hasTCall:childHasTCall, result: childResult } = processCompoundExpression(child, includeT, true);
            // console.log('type 8 processTranslationAsWholePointerClass childResult:', childResult);
            //NOTES: normally the childResult will be an array of length 1, when run processCompoundExpression for translation-as-whole-pointer class
            if((childHasTCall && includeT) || !childHasTCall) {
                childResult.forEach(res => {
                    result += res;
                });
            }
            // result += childResult;
            if (childHasTCall){
                hasTCall = true;
            }
        }else if (child.type === 5) { // Interpolation
            const childResults = processInterpolation(child, includeT, true);
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
            const {hasTCall:childHasTCall, result:childResult} = processTranslationAsWholePointerClass(child, includeT);
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
        result
    };
}


// type:8 -> Compound Epression eg. "hi" + name, <div> Hi {{ name }}</div>, <div> KK{{$t("HiKK { name }", {name: name})}} </div>, <div> {{button_name}} {{ name }}</div>,
function processCompoundExpression(node, includeT, isTranslationAsWholePointer = false) {
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
                const  childResults = processInterpolation(child, includeT, isTranslationAsWholePointer, false);
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

    return {
        hasTCall,
        result
    };
}

// type: 5 -> Interpolation: eg. {{ name }},
function processInterpolation(node, includeT, isTranslationAsWholePointer = false, checkTenaryExpression = true) {
    var results = [];
    // var hasTCall = false;
    const contentNode = node.content;
    const rawContent = node.loc.source.trim();
    // console.log("processInterpolation rawContent:", rawContent, 'isTranslationAsWholePointer:', isTranslationAsWholePointer, 'checkTenaryExpression:', checkTenaryExpression);

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
                    if (includeT) {
                        result = `${tKey}`;
                    }
                } else {
                    result = `${expr.slice(1, -1)}`; // remove the backticks
                }
            }else{
            // if the content is a simple expression (e.g. {{ name }})
                // → return as '{ name }'
                // console.log('processInterpolation expr:', expr, 'tKey:', tKey);
                if (tKey) {
                    // hasTCall = true;
                    if (includeT) {
                        result = `${tKey}`;
                    }
                } else {
                    // replace {{ name }} with { name }, {{name}} with {name}
                    result = rawContent.slice(1, -1);
                }
            }
            results.push({result, hasTCall});
        }else{

            // If the expr is a ternary expression, e.g. {{ name ? 'Hello' : 'Hi' }}
            // or a complex expression, e.g. {{ $t("Hello {name}", {name: name}) }}
            // we will extract the strings from the ternary expression
            extractedResultsByHandlingTernaryExpression.forEach( ({content:expr, isLiteralLikeValue}) => {
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
                            if (includeT) {
                                result = `${tKey}`;
                            }
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
                            if (includeT) {
                                result = `${tKey}`;
                            }
                        } else {
                            // replace {{ name }} with { name }, {{name}} with {name}
                            result = expr.slice(1, -1);
                        }
                    }
                    results.push({result, hasTCall});
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

function extractAllTKeysFromString(str) {
    const regex = /\$t\s*\(\s*(['"`])((?:\\.|[^\\])*?)\1/g;
    const matches = [];
    let match;
    while ((match = regex.exec(str)) !== null) {
      matches.push(match[2]);
    }
    return matches;
}

function parseBracketNotation(str) {
    const match = str.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\[\s*['"]([^'"]+)['"]\s*\]$/);
    if (match) {
      const objectName = match[1];
      const keyName = match[2];
      return { objectName, keyName };
    }
    return null; // not matching pattern
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
                        isLiteralLikeValue: isLiteralLikeValue(part)
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
                        isLiteralLikeValue: isLiteralLikeValue(right)
                    });
                }
            }
        });
    } catch (e) {
        return [];
    }
    return result; // Return the original expression if no ternary found
}
// ✅ Only extract if it's a literal-like value
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

function isLikelyVariableLike(str) {
    // Trim to ignore whitespace issues
    const trimmed = str.trim();

    // if a single word eg. 'Hello', no spaces or punctuation
    if (/\s|["'`.,;:]/.test(trimmed)) return false;

    // ❗ New check: if all lowercase letters only, not variable-like
    if (/^[a-z]+$/.test(trimmed)) return false;

    // ❗ New check: Exclude simple ALL_CAPS without underscores (e.g., "NEW")
    if (/^[A-Z]+$/.test(trimmed)) return false;

    // Match patterns that are clearly variable-like
    const output =(
        /^[A-Z0-9_]+$/.test(trimmed) ||         // ALL_CAPS or ENUMS
        /^[a-z_$][a-zA-Z0-9_$]*$/.test(trimmed) // camelCase, snake_case, $refs, _temp, var123
    );
    // console.log('isLikelyVariableLike str:', str, 'output:', output);
    return output;
}

function processJSContent(code, extractedStrings, includeT, needToReadFileData = false) {
    if(needToReadFileData){
        // Read the file content if needed
        code = fs.readFileSync(code, 'utf-8');
    }

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
            
            // DON'T skip 'name' in ObjectProperty
            // // Skip name: 'SomeName'
            // if (
            //     path.parent.type === 'ObjectProperty' &&
            //     path.parent.key &&
            //     ((path.parent.key.type === 'Identifier' && path.parent.key.name === 'name') ||
            //     (path.parent.key.type === 'StringLiteral' && path.parent.key.value === 'name'))
            // ) {
            //     return;
            // }
  
            
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
                // extract if includeT is true
                if(includeT){
                    // console.log("extractedStrings add 16:", path.node.value);
                    // extractedStrings.add(path.node.value);
                    extractedStrings.add(JSON.stringify(
                        {
                            result: path.node.value,
                            hasTCall: true 
                        }
                    ));
                }
                //Skip: $t() call if includeT is false
                //return it anyway, if it is a $t() call to avoid following operations to add the strings again
                // and ensure the following add operations only add non-$t() strings
                return;
            }

            // Otherwise, extract it
            // console.log("extractedStrings add 17:", path.node.value);
            // extractedStrings.add(path.node.value);
            extractedStrings.add(JSON.stringify(
                {
                    result: path.node.value,
                    hasTCall: false 
                }
            ));

        },
        CallExpression(path) {
            const callee = path.node.callee;
            const arg = path.node.arguments[0];
            // console.log('Found $t() call 111111:', includeT, path.node.callee.property?.name, path.node.callee.property?.type, path.node.arguments[0]);
            if(includeT){
                if (callee?.type === 'Identifier' && callee?.name === '$t') {
                    if (arg && arg.type === 'StringLiteral') {
                        // console.log("extractedStrings add 18:", arg.value);
                        // extractedStrings.add(arg.value);
                        extractedStrings.add(JSON.stringify(
                            {
                                result: arg.value,
                                hasTCall: true 
                            }
                        ));
                    }
                }else if(callee?.property?.type === 'Identifier' && callee?.property?.name === '$t'){
                     // ✅ Handle TemplateLiteral with no interpolations, eg.`tkeyTestWithWholeLiteralKKKK ${this.$t("TestPage['tTkeyTestWithWholeLiteral']")}`;
                    if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
                        const raw = arg.quasis.map(q => q.value.cooked).join('');
                        // console.log("extractedStrings add 19:", raw);
                        // extractedStrings.add(raw);
                        extractedStrings.add(JSON.stringify(
                            {
                                result: raw,
                                hasTCall: true 
                            }
                        ));
                    }
                }
            }
            
        },
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
                    if (tKey) {
                        // If the TemplateLiteral contains a $t() call, add it to the extracted strings
                        if(includeT) {
                            // console.log("extractedStrings add 20:", tKey);
                            // extractedStrings.add(tKey);
                            extractedStrings.add(JSON.stringify(
                                {
                                    result: tKey,
                                    hasTCall: true 
                                }
                            ));
                        }
                    } else {
                        // If it's just a template literal without $t(), add the raw content
                        // Remove the backticks
                        // console.log("extractedStrings add 21:", raw.slice(1, -1)); 
                        // extractedStrings.add(raw.slice(1, -1)); // Remove the backticks
                        extractedStrings.add(JSON.stringify(
                            {
                                result: raw.slice(1, -1),
                                hasTCall: false 
                            }
                        ));
                    }
                }
            }
        }
    });
}

function isUrl(str) {
    if (typeof str !== 'string') return false;
  
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
}
function transformBracketPlaceholders(input) {
    return input.replace(/\{([^}]+)\}/g, (match, content) => {
        // Remove any leading/trailing spaces inside the placeholder
        const trimmedContent = content.trim();
    
        let lastPart = trimmedContent;
    
        // Case 1: dot notation
        if (/^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)+$/.test(trimmedContent)) {
          const parts = trimmedContent.split(".");
          lastPart = parts[parts.length - 1];
        }
    
        // Case 2: bracket notation
        else if (/^[a-zA-Z_$][\w$]*(\['[a-zA-Z_$][\w$]*'\])+$/g.test(trimmedContent)) {
          const matches = [...trimmedContent.matchAll(/\['([a-zA-Z_$][\w$]*)'\]/g)];
          if (matches.length > 0) {
            lastPart = matches[matches.length - 1][1];
          }
        }
    
        return `{${lastPart}}`;
    });
}

module.exports = { run };
