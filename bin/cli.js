#!/usr/bin/env node
// NOTES: The above line should be at the top of /bin/cli.js. It means: This is a Node.js script — please run it with Node.

const extractorHelper = require('../extractorHelper.js');
const splitHelper = require('../splitHelper.js');
const replaceHelper = require('../replaceHelper.js');
const astReplaceHelper = require('../astReplaceHelper.js');

// Read targetDir from CLI args
const args = process.argv.slice(2);
const targetDir = args.findIndex(arg => arg.startsWith('--path='));
const excludeFiles = args.findIndex(arg => arg.startsWith('--exclude='))
const templateOnly = args.includes('--template-only');

// for extractor mode
const runExtractor = args.includes('--run-extractor');
const includeT = args.includes('--include-t');
const pageKeys = args.findIndex(arg => arg.startsWith('--keys=')); // also for runASTReplace mode
const configFilePath = args.findIndex(arg => arg.startsWith('--config='));

// for runSplit mode
const runSplit = args.includes('--run-split');

// for runReplace mode and runASTReplace mode
const runReplace = args.includes('--run-replace');
const runASTReplace = args.includes('--run-ast-replace');
const translationPageKey = args.findIndex(arg => arg.startsWith('--translation-page-key='));
const translationMappingPath = args.findIndex(arg => arg.startsWith('--translation-mapping-path='));
const isTranslationAsWholePointer = args.includes('--is-translation-as-whole-pointer');

// For runReplace Mode Only
const greedy = args.includes('--greedy');

// For runASTReplace Mode Only
const vueScriptMode = args.findIndex(arg => arg.startsWith('--vue-script-mode='));

if (args.includes('--help')) {
    console.log(`
vue-i18n-customized-extractor

A CLI tool to extract, split, and replace i18n keys and text in Vue.js projects.

USAGE:
  vue-i18n-customized-extractor [options]

OPTIONS:

General
  --path=<target>                Target file or folder to analyze. Defaults to ./src.

Extraction Mode (--run-extractor)
  --run-extractor                Extract i18n keys and text from source files.
  --exclude=<files>              Comma-separated files/folders to exclude.
  --config=<path>                Path to custom config file (.cjs). Defaults to vue-i18n-customized-extractor.config.cjs.
  --keys=<key1,key2,...>         Extract keys for specific components/pages.
  --include-t                    Include $t() calls in extraction.
  --template-only                Only extract from template sections.

Split Mode (--run-split)
  --run-split                    Split JSON translation files for translate-as-whole-pointer elements.
                                 When using --run-split, explicitly target all input translation files to ensure consistent processing and alignment.

Replace Mode (--run-replace)
  --run-replace                  Replace extracted text/keys with $t()/t() calls using a translation mapping.
  --translation-mapping-path=<path>  Path to translation mapping JSON file.
  --translation-page-key=<key>   Top-level page key for generated $t()/t() calls.
  --is-translation-as-whole-pointer  Use split mapping for translate-as-whole-pointer elements.
  --greedy                       Use greedy matching when replacing keys.
  --exclude=<files>              Comma-separated files/folders to exclude.
  --template-only                Only replace in template sections.

AST Replace Mode (--run-ast-replace) [Recommended]
  --run-ast-replace              Use AST-based replacement for higher accuracy, following extraction logic and custom mappings.
  --translation-mapping-path=<path>  Path to translation mapping JSON file.
  --translation-page-key=<key>   Top-level page key for generated $t()/t() calls.
  --is-translation-as-whole-pointer  Use split mapping for translate-as-whole-pointer elements.
  --exclude=<files>              Comma-separated files/folders to exclude.
  --template-only                Only replace in template sections.
  --config=<path>                Path to custom config file (.cjs).
  --keys=<key1,key2,...>         Extract keys for specific components/pages.

Help
  --help                         Show help and usage instructions.

EXAMPLES:

  Extract i18n keys from the src directory:
    vue-i18n-customized-extractor --path=./src

  Extract i18n keys and include $t() calls:
    vue-i18n-customized-extractor --path=./src --include-t

  Split translation files for whole pointer elements:
    vue-i18n-customized-extractor --run-split --path=./src/locales

  Replace extracted text with $t() calls using mapping:
    vue-i18n-customized-extractor --run-replace --translation-mapping-path=src/locales/en.json --path=./src

  Use AST-based replacement for higher accuracy:
    vue-i18n-customized-extractor --run-ast-replace --translation-mapping-path=src/locales/en.json --path=./src --translation-page-key=TestPage --keys=TestPage

For more details and advanced usage, see the README or visit the project repository.
    `);
    process.exit(0);
}

if (runSplit) {
    console.log("1");
    if(targetDir !== -1){
        console.log('Running in split mode... Help to split and reorganize the json files of translate-as-whole-pointer');
        splitHelper.runSplit(
            args[targetDir].split('=')[1]
        );
    }else{
        console.log("No target directory specified for split mode. Please use --path=<directory> to specify the target directory or file.");
        process.exit(0);
    }
}else if (runReplace) {
    if(targetDir !== -1 && translationMappingPath !== -1){
        console.log('Running in replace mode... Help to replace extracted keys with $t() calls');
        replaceHelper.replaceExtractedKeysInFilesWithTCall(
            args[targetDir].split('=')[1],
            args[translationMappingPath].split('=')[1],
            {
                excludeFiles: excludeFiles !== -1 ? args[excludeFiles].split('=')[1].split(',') : [],
                translationPageKey: translationPageKey!==-1 ? args[translationPageKey].split('=')[1] : null,
                isTranslationAsWholePointer,
                templateOnly,
                greedy,
            }

        );
    }else{
        console.log("No target directory or target translation mapping path specified for replace mode. Please use --path=<directory> to specify the target directory or file, and --translation-mapping-path=<path> to specify the translation mapping path.");
        process.exit(0);
    }
}else if (runASTReplace) {
    if(targetDir !== -1 && translationMappingPath !== -1){
        console.log('Running in AST replace mode... Help to replace extracted keys with $t() calls');
        astReplaceHelper.replace(
            args[targetDir].split('=')[1],
            args[translationMappingPath].split('=')[1],
            {
                excludeFiles: excludeFiles !== -1 ? args[excludeFiles].split('=')[1].split(',') : [],
                translationPageKey: translationPageKey!==-1 ? args[translationPageKey].split('=')[1] : null,
                configFilePath: configFilePath !== -1 ? args[configFilePath].split('=')[1] : 'vue-i18n-customized-extractor.config.cjs',
                pageKeys: pageKeys !== -1 ? args[pageKeys].split('=')[1].split(',') : [],
                isTranslationAsWholePointer,
                templateOnly,
                vueScriptMode: vueScriptMode !== -1 ? args[vueScriptMode].split('=')[1] : "Options",
            }

        );
    }else{
        console.log("No target directory or target translation mapping path specified for replace mode. Please use --path=<directory> to specify the target directory or file, and --translation-mapping-path=<path> to specify the translation mapping path.");
        process.exit(0);
    }
}else if (runExtractor) {
    console.log(`Extracting from: ${targetDir}`);
    console.log(`Include $t()? ${includeT}`);
    console.log(`Extracting from: ${process.cwd()}`);
    extractorHelper.run(
        targetDir !== -1 ? args[targetDir].split('=')[1] : './src', 
        { 
            includeT,
            excludeFiles: excludeFiles !== -1 ? args[excludeFiles].split('=')[1].split(',') : [],
            pageKeys: pageKeys !== -1 ? args[pageKeys].split('=')[1].split(',') : [],
            configFilePath: configFilePath !== -1 ? args[configFilePath].split('=')[1] : 'vue-i18n-customized-extractor.config.cjs',
            templateOnly,
        }
    );
}else {
    console.log("⚠️ No valid mode specified. Please use --run-extractor, --run-split, or --run-replace.");
    process.exit(0);
}

