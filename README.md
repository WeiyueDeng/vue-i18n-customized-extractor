# vue-i18n-customized-extractor

`vue-i18n-customized-extractor` is a CLI tool designed to streamline translation efforts in Vue.js projects. It helps developers efficiently manage translation keys by identifying text requiring translation and extracting existing keys used in the codebase. This ensures translation files are optimized, comprehensive, and up-to-date.

---

## Features

- **Translation Key Extraction**: Extract i18n keys and values from Vue.js templates, scripts, and `.js` or `.ts` files.
- **Custom Component Prop Extraction**: Extract text requiring translation from user-defined component props, configurable via a mapping file.
- **Key Usage Tracking**: Optionally extract used i18n keys to identify unused keys for cleanup and detect missing keys to ensure comprehensive translations.
- **Localization Efficiency**: Streamline the process of translating English content into other languages.
- **Translation File Generation**: Automatically generate `src/locales/en.json` and `src/locales/en-TranslateAsWholePointer.json` files after running the tool, ensuring extracted keys are organized and ready for translation.
- **Split Mode**: Split translation files for elements marked with `translate-as-whole-pointer`, aligning nested content for consistent translation.
- **Replace Mode**: Replace extracted text/keys with `$t()`/`t()` calls using a translation mapping, with improved accuracy and reduced manual revision workload.

---

### Key Depth Limitation

The tool enforces a maximum depth of two levels for `$t()` call keys. For example:

- **Recommend**: `TestPage['Hello']`
- **Not Recommend**: `TestPage['HiKKT nested { name }']['nested name']`

Keys exceeding this depth won't be divided into multiple levels but will be displayed as a single cohesive unit. For example:

- `TestPage['HiKKT nested { name }']['nested name']` will be extracted as:
    ```json
    {
        "TestPage['HiKKT nested { name }']['nested name']": "TestPage['HiKKT nested { name }']['nested name']"
    }
    ```

### Translation Key Depth Approach

The tool enforces a maximum depth of two levels for `$t()` keys, simplifying translation mapping and debugging. The first level typically represents the page or section, such as `TestPage`, reducing conflicts between different pages or sections. The second level contains specific translation keys, ensuring simplicity and ease of maintenance for the mapping for each page or section. By limiting the depth, the tool streamlines tracing and debugging of `$t()` keys, promoting organized and efficient mapping for each page or section.

---

## Installation

### Local Installation (Recommended)
```bash
npm install vue-i18n-customized-extractor
```

### Global Installation
```bash
npm install -g vue-i18n-customized-extractor
```

---

## Usage

To use the CLI tool, run it in your project directory:

### Local Installation
If the tool is installed locally within your project:
```bash
npx vue-i18n-customized-extractor [options]
```

### Global Installation
If the tool is installed globally:
```bash
vue-i18n-customized-extractor [options]
```

### Options

#### General
- `--path=<target>`  
    Target file or folder to analyze. Defaults to `./src`.

#### Extraction Mode (`--run-extractor`)
- `--exclude=<files>`  
    Comma-separated files/folders to exclude.
- `--config=<path>`  
    Path to custom config file (`.cjs`). Defaults to `vue-i18n-customized-extractor.config.cjs`
- `--keys=<key1,key2,...>`  
    Extract keys for specific components/pages.
- `--include-t`  
    Include `$t()` calls in extraction.
- `--template-only`  
    Only extract from template sections.

#### Split Mode (`--run-split`)
- `--run-split`  
    Split JSON translation files for `translate-as-whole-pointer` elements.

    > **Note:**  
    > When using `--run-split`, explicitly target all input translation files to ensure consistent processing and alignment.

##### Split Mode Example

**Input Files:**
```json
// en.json
{
    "Test <Product A> Again": "Test <Product A> Again"
}
// cn.json
{
    "Test <Product A> Again": "再次测<产品 A>"
}
```

**Command:**
```bash
vue-i18n-customized-extractor --run-split --path=./src/locales
```

**Output Files:**
```json
// en-TranslateAsWholePointer.json
{
    "0~~Test <Product A> Again": "Test ",
    "1Nested~~Test <Product A> Again": "Product A",
    "2~~Test <Product A> Again": " Again"
}
// cn-TranslateAsWholePointer.json
{
    "0~~Test <Product A> Again": "再测一次 ",
    "1Nested~~Test <Product A> Again": "产品 A",
    "2~~Test <Product A> Again": ""
}
```

#### AST Replace Mode (`--run-ast-replace`) **(Recommended)**

> **Recommended:**  
> AST Replace Mode is an optimized and more accurate version of Replace Mode. It leverages the same logic and customization as the extraction process, using Abstract Syntax Tree (AST) analysis to precisely identify and replace translatable content. This ensures replacements are context-aware, minimize false positives, and align perfectly with what was extracted—especially in complex templates or with custom components.

- `--run-ast-replace`  
    Use AST-based replacement for higher accuracy, following extraction logic and custom mappings.
- `--translation-mapping-path=<path>`  
    Path to translation mapping JSON file.
- `--translation-page-key=<key>`  
    Top-level page key for generated `$t()`/`t()` calls.
- `--is-translation-as-whole-pointer`  
    Use split mapping for `translate-as-whole-pointer` elements.
- `--vue-script-mode=<Options|Composition>`  
    Indicates which type of script section is used in Vue files. Determines whether `this.$t()` (Options API) or `t()` (Composition API) calls are inserted. Defaults to `Options`. If not `Options`, will be considered as `Composition`.  
    > **Note:**  
    > If you use `Composition`, you must manually import `t` from your i18n instance in your script to enable usage of `t()`.
- `--exclude=<files>`  
    Comma-separated files/folders to exclude.
- `--template-only`  
    Only replace in template sections.
- `--config=<path>`  
    Path to custom config file (`.cjs`). Defaults to `vue-i18n-customized-extractor.config.cjs`
- `--keys=<key1,key2,...>`  
    Extract keys for specific components/pages.

> **Important:**  
> For the most accurate and consistent replacement, use the same `--config` path and `--keys` options as you did during extraction. AST Replace Mode relies on extraction logic and custom mappings, so reusing the exact configuration and keys ensures replacements align perfectly with what was extracted.

##### AST Replace Mode Example

**Command:**
```bash
vue-i18n-customized-extractor --run-ast-replace --translation-mapping-path=src/locales/en.json --path=./src --translation-page-key=TestPage --keys=TestPage
```

**Result:**
- All extracted text and keys, as determined by the extraction logic and custom mappings, will be accurately replaced with `$t()` calls in your codebase.
- This mode ensures replacements are context-aware and avoids unintended changes, especially in dynamic or nested structures.

##### AST Replace Mode Usage Examples

**1. Basic Replacement in Template (Nested Key)**

_Before:_
```html
<div>Hello</div>
```
_After:_
```html
<div>{{$t("TestPage[\"Hello\"]")}}</div>
```

**2. Replacement with Interpolation (Nested Key)**

_Before:_
```html
<div>Hello, {{ user.name }}</div>
```
_After:_
```html
<div>{{ $t("TestPage[\"Hello, { name }\"]", { name: user.name }) }}</div>
```

**3. Custom Component Prop Replacement (Nested Key)**

_Before:_
```html
<ResponsiveButton display_name="Submit" />
```
_After:_
```html
<ResponsiveButton :display_name="$t('TestPage[\'Submit\']')" />
```
> **Note:**  
> Normally, translation keys use double quotes (e.g., `$t("TestPage[\"Submit\"]")`) and escaped double quotes for nested keys. However, when used as an attribute or prop inside a tag, double quotes are not allowed, so AST Replace Mode automatically uses single quotes for the key (e.g., `$t('TestPage[\'Submit\']')`).  
> Because of this, nested keys cannot contain any single or double quotes under this condition. If your key includes such characters and you cannot edit the content, you must manually adjust your source code structure to avoid syntax issues.

**4. Nested Content with `translate-as-whole-pointer` (Nested Key)**

_Before:_
```html
<div class="translate-as-whole-pointer">Test <div>bold</div></div>
```
_After:_
```html
<div class="translate-as-whole-pointer">{{$t("TestPage[\"0~~Test <bold>\"]")}}<div>{{$t("TestPage[\"1Nested~~Test <bold>\"]")}}</div></div>
```

**5. Script Section Replacement (Nested Key)**

_Before:_
```js
const message = "Welcome to the app";
```
_After:_
```js
const message = $t("TestPage[\"Welcome to the app\"]");
```
*No change, as the string is already using a nested key.*

**6. Conditional Expressions (Nested Key)**

_Before:_
```html
<div>{{name ? "interpolation 1" : "interpolation 2"}}</div>
```
_After:_
```html
<div>{{name ? $t("TestPage['interpolation 1']") : $t("TestPage[\"interpolation 2\"]")}}</div>
```

---

#### Deduplicate Mode (`--run-deduplicate-key`)

- `--run-deduplicate-key`  
    Remove keys from the target file(s) that already exist in the source file(s).
- `--target-file-path=<path>`  
    Path to the target JSON file or folder.
- `--source-file-path=<path>`  
    Path to the source JSON file or folder.

---

#### Merge Mode (`--run-merge-key`)

- `--run-merge-key`  
    Merge keys from the target file(s) into the source file(s), adding only new keys.
- `--target-file-path=<path>`  
    Path to the target JSON file or folder.
- `--source-file-path=<path>`  
    Path to the source JSON file or folder.

    > **Note:**  
    > Deduplicate and merge modes are designed to help you keep your translation mapping files up-to-date and free of duplicates.
    >
    > - **File and Folder Support:**  
    >   Both `--target-file-path` and `--source-file-path` accept either JSON file paths or folder paths.  
    >   - If both are JSON files, the tool will add keys from the target file into the source file.  
    >   - If a key already exists in the source file, its original value is preserved and the duplicate from the target file is skipped.
    >   - If both are folders, the tool processes all direct `.json` files in the target folder and looks for files with the same name in the source folder.  
    >   - For each matching file pair, keys from the target file are merged into the source file as described above.
    >   - If a corresponding file does not exist in the source folder, the tool creates a new file in the source folder using the content from the target file.
    >
    > This ensures your translation mappings remain current, preserves existing translations, and prevents duplication.

---

#### Help
- `--help`  
    Show help and usage instructions.

---

**Tip:**  
Use only options relevant to your mode (`--run-extractor`, `--run-split`,`--run-replace`, `--run-deduplicate-key`, or `--run-merge-key`).

#### Key Features

- **Flexible Input Handling**: Supports both individual JSON files and entire folders. When a folder is specified, all `.json` files within it are processed together, ensuring batch consistency.
- **Consistent Content Splitting**: Automatically splits strings containing angle brackets (`<...>`) into distinct segments, separating nested content (inside brackets) from regular text (outside brackets). The splitting algorithm ensures that all translation files for the same key have the same number of segments and positions, even if some segments are empty, maintaining strict alignment across languages.
- **Alignment and Padding**: Adds empty string segments as needed to guarantee that all translation files remain aligned for each key, preventing mismatches and simplifying downstream usage.
- **Systematic Output Generation**: Produces new JSON files for each processed input, saved in the `src/locales` directory with the `-TranslateAsWholePointer.json` suffix. This organization makes it easy to integrate the output into your localization workflow.
- **Robust Error Handling**: Skips unsupported files and provides clear error messages for missing or invalid input, ensuring a smooth and predictable process.
- **Replace Mode Accuracy**: Replacement logic is now tightly coupled with extraction logic, greatly reducing mistaken replacements and manual revision workload.

---

### Examples

1. Extract i18n keys from the `src` directory:
    ```bash
    vue-i18n-customized-extractor --path=./src
    ```

2. Extract i18n keys from `src/components` and include `$t()` calls:
    ```bash
    vue-i18n-customized-extractor --path=./src --include-t
    ```

3. Extract together with keys for specific components under `TestPage` and `OrderPage`:
    ```bash
    vue-i18n-customized-extractor --path=./src --include-t --keys=TestPage,OrderPage
    ```

4. Split translation files for whole pointer elements:
    ```bash
    vue-i18n-customized-extractor --run-split --path=./src/locales
    ```

5. Replace extracted text with `$t()` calls using mapping:
    ```bash
    vue-i18n-customized-extractor --run-replace --translation-mapping-path=src/locales/en.json --path=./src
    ```

After running the tool, the extracted keys are saved into two files:
- `src/locales/en.json`: Contains regular translation keys.
- `src/locales/en-TranslateAsWholePointer.json`: Contains keys extracted from elements marked with `translate-as-whole-pointer`.

---

## Configuration

Create a configuration file (`vue-i18n-customized-extractor.config.cjs`) for customized component mappings:

### Configuration File Structure

The configuration file (`vue-i18n-customized-extractor.config.cjs`) must include a fixed field name `customizedComponentsTranslationMap`. This field defines the mapping of custom components to their translatable props. Below is an example configuration:

```javascript
module.exports = {
    // Mapping of custom components to their translatable props
    customizedComponentsTranslationMap: {
        ResponsiveButton: ['display_name'],
        SimplifiedNotification: ['title', 'content'],
        HelloWorldPage: {
            ResponsiveButton: ['display_name']
        },
    }
};
```

### Key Mapping Example

- `TestPage` may include `SimplifiedNotification: ['title']`.
- `OrderPage` may include `SimplifiedNotification: ['content']` and `ResponsiveButton: ['display_name']`.

When multiple keys are specified, the tool consolidates mappings for streamlined management:

```javascript
{
    SimplifiedNotification: ['title', 'content'],
    ResponsiveButton: ['display_name']
}
```

If no keys are specified, the tool parses the entire mapping under `customizedComponentsTranslationMap`, ensuring all translatable props are extracted.

---

## Element Extraction

Elements marked with `translate-as-whole-pointer` are extracted as a single cohesive unit, ensuring all text and translation keys within the element are captured accurately.

### Regular Examples

1. **Static Text**:
    ```html
    <div>Welcome to the app</div>
    ```
    **Result**: `"Welcome to the app": "Welcome to the app"`

2. **Dynamic Content**:
    ```html
    <div>Hello, {{ user.name }}</div>
    ```
    **Result**: `"Hello, { user.name }": "Hello, { user.name }"`

3. **Translation Function `$t()`**:
    ```html
    <div>{{$t('welcome_message')}}</div>
    ```
    **Result**:  
    ```json
    {
        "Existing $t() calls' keys": {
            "flatKeys": [
                "welcome_message"
            ]
        }
    }
    ```  
    *Note: This will only be extracted when using the `--include-t` option. Without this option, `$t()` calls will be skipped.*

4. **Dynamic Content with Interpolation**:
    ```html
    <div>Hi {{ name }}</div>
    ```
    **Result**: `"Hi { name }": "Hi { name }"`

5. **Template Literal Interpolation**:
    ```html
    <div>{{ `Hei ${name} literal` }}</div>
    ```
    **Result**: `"Hei ${name} literal": "Hei {name} literal"`

6. **Translation Function with Interpolation**:
    ```html
    <div>{{$t("TestPage['HiKKT { name }']", {name: name})}}</div>
    ```
    **Result**:  
    ```json
    {
        "Existing $t() calls' keys": {
            "nestedKeys": {
                "TestPage": [
                    "HiKKT { name }"
                ]
            }
        }
    }
    ```  
    *Note: This will only be extracted when using the `--include-t` option. Without this option, `$t()` calls will be skipped.*

7. **Translation Function with Static Key**:
    ```html
    <div>{{$t('Hello')}}</div>
    ```
    **Result**:  
    ```json
    {
        "Existing $t() calls' keys": {
            "flatKeys": [
                "Hello"
            ]
        }
    }
    ```  
    *Note: This will only be extracted when using the `--include-t` option. Without this option, `$t()` calls will be skipped.*

8. **Translation Function with Dynamic Key**:
    ```html
    <div>{{$t('Hit { name }', {name: name})}}</div>
    ```
    **Result**:  
    ```json
    {
        "Existing $t() calls' keys": {
            "flatKeys": [
                "Hit { name }"
            ]
        }
    }
    ```  
    *Note: This will only be extracted when using the `--include-t` option. Without this option, `$t()` calls will be skipped.*

9. **Conditional Interpolation**:
    ```html
    <div>{{name ? "interpolation 1" : "interpolation 2"}}</div>
    ```
    **Result**: `"interpolation 1": "interpolation 1", "interpolation 2": "interpolation 2"`

10. **Conditional Translation Function**:
    ```html
    <div>{{name ? $t("TestPage['interpolation 1 tkey']") : $t("TestPage['interpolation 2 tkey']")}}</div>
    ```
    **Result**:  
    ```json
    {
        "Existing $t() calls' keys": {
            "nestedKeys": {
                "TestPage": [
                    "interpolation 1 tkey",
                    "interpolation 2 tkey"
                ]
            }
        }
    }
    ```  
    *Note: This will only be extracted when using the `--include-t` option. Without this option, `$t()` calls will be skipped.*

11. **Logical Expression with Static Text**:
    ```html
    <div>{{test_array?.['1'] ?? "Logical Expr 1"}}</div>
    ```
    **Result**: `"Logical Expr 1": "Logical Expr 1"`

12. **Logical Expression with Template Literal**:
    ```html
    <div>{{test_array?.['1'] ?? `Logical Expr 1 ${name} literal`}}</div>
    ```
    **Result**: `"Logical Expr 1 { name } literal": "Logical Expr 1 { name } literal"`

13. **Logical Expression with Translation Function**:
    ```html
    <div>{{test_array?.['1'] ?? $t("TestPage['Logical Expr ${name} t keys']")}}</div>
    ```
    **Result**:  
    ```json
    {
        "Existing $t() calls' keys": {
            "nestedKeys": {
                "TestPage": [
                    "Logical Expr { name } t keys"
                ]
            }
        }
    }
    ```  
    *Note: `$t()` calls will only be extracted when using the `--include-t` option. Without this option, `$t()` calls will be skipped.*

14. **Conditional Rendering with Static Text**:
    ```html
    <div class="tab-content-wrapper" v-if="curTab == 'Webinars'||curTab=='Educational Videos'">Static text</div>
    ```
    **Result**:  
    ```json
    {
        "Webinars": "Webinars",
        "Educational Videos": "Educational Videos",
        "Static text": "Static text"
    }
    ```

15. **Dynamic Class Binding with Conditional Rendering**:
    ```html
    <div v-for="dummy_card in tab_data_dummy_divs_num" :key="dummy_card" :class="['dummy-div', {'dummy-webinar-video-card': curTab == 'Webinars'}, {'dummy-educational-video-card': curTab == 'Educational Videos'}]">Static text</div>
    ```
    **Result**:  
    ```json
    {
        "Webinars": "Webinars",
        "Educational Videos": "Educational Videos",
        "Static text": "Static text"
    }
    ```

---

### Nested Examples

1. **Static Text with Nested Elements**:
    ```html
    <div class="translate-as-whole-pointer">test <span>bold</span></div>
    ```
    **Result**: `"test <bold>": "test <bold>"`

2. **Dynamic Content with Nested Elements**:
    ```html
    <div class="translate-as-whole-pointer">123 {{ name }} <span> bold </span></div>
    ```
    **Result**: `"123 { name } < bold >": "123 { name } < bold >"`

3. **Translation Function `$t()` with Nested Elements**:
    ```html
    <div class="translate-as-whole-pointer">{{$t('TestPage[key1]')}} <span>{{$t('TestPage[key2]')}}</span></div>
    <div class="translate-as-whole-pointer">{{$t('key1Flat')}} <span>{{$t('key2Flat')}}</span></div>
    ```
    **Result**:  
    ```json
    {
        "flatKeys": [
            "key1Flat",
            "key2Flat"
        ],
        "nestedKeys": {
            "TestPage": [
                "key1",
                "key2"
            ]
        }
    }
    ```
    *Note: These keys will be grouped under "Existing $t() calls' keys for translate-as-whole-pointer" in `en-TranslateAsWholePointer.json`.*

---

## Supported Cases

### Parsing and Extraction
- Extract translation keys from Vue templates, scripts, and `.js` or `.ts` files.
- Extract text from user-defined component props.
- Detect unused and missing keys for cleanup and comprehensive translations.
- Split translation files for nested content.
- Replace extracted text with `$t()` calls using mapping, with improved accuracy.

### Result Expectations
- **Comprehensive Key Coverage**: Complete overview of active and missing keys.
- **Optimized Translation Files**: Translation files are kept up-to-date and free of unused keys.
- **Consistent and Accurate Replacement**: Replacement logic is now fully aligned with extraction logic, leveraging AST-based analysis to ensure replacements are accurate and require minimal manual revision.

---

## Contribution

Feel free to contribute by submitting issues or pull requests to improve the tool.

---

## License

This project is licensed under the MIT License.

