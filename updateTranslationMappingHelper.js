const fs = require('fs');

function deduplicateKeys(targetFilePath, sourceFilePath) {
    // targetFilePath: the file path of the target file which will be compared against the source file and deduplicated
    // sourceFilePath: the file path of the source file which will be used as the source of truth for deduplication

    if (!fs.existsSync(targetFilePath)) {
        console.warn(`Target path ${targetFilePath} does not exist.`);
        return;
    }
    if (!fs.existsSync(sourceFilePath)) {
        console.warn(`Source path ${sourceFilePath} does not exist.`);
        return;
    }
    
    // 1. get the content of the targetFilePath and the sourceFilePath.
    // NOTES: Both path should be JSON files or folders containing JSON files.
    // NOTES: If both folders, we match the JSON files sharing the same name under the target folder and the source folder.
    // If not both in '.json' format, or not found, console.warn and return.
    const targetFiles = [];
    const sourceFiles = [];
    const targetStat = fs.statSync(targetFilePath);
    const sourceStat = fs.statSync(sourceFilePath);
    if (targetStat.isFile() && sourceStat.isFile()) {
        if (targetFilePath.endsWith('.json') && sourceFilePath.endsWith('.json')) {
            targetFiles.push(targetFilePath);
            sourceFiles.push(sourceFilePath);
        } else {
            console.warn(`Target file ${targetFilePath} or source file ${sourceFilePath} is not a JSON file.`);
            return;
        }
    } else if (targetStat.isDirectory() && sourceStat.isDirectory()) {
        // If both are directories, we read all JSON files in targetDirectory, and find the corresponding JSON files (with same name) in sourceDirectory.
        const targetFilesInDir = fs.readdirSync(targetFilePath).filter(file => file.endsWith('.json'));
        targetFilesInDir.forEach(file => {
            const targetFileFullPath = `${targetFilePath}/${file}`;
            const sourceFileFullPath = `${sourceFilePath}/${file}`;
            if (fs.existsSync(sourceFileFullPath)) {
                targetFiles.push(targetFileFullPath);
                sourceFiles.push(sourceFileFullPath);
            } else {
                console.warn(`Source file ${sourceFileFullPath} not found for target file ${targetFileFullPath}.`);
            }
        });
    } else {
        console.warn(`Target path ${targetFilePath} and source path ${sourceFilePath} should both be JSON files or both be directories.`);
        return;
    }

    if (targetFiles.length === 0 || sourceFiles.length === 0 || targetFiles.length !== sourceFiles.length) {
        console.warn(`No valid JSON files found in target path ${targetFilePath} or source path ${sourceFilePath}.`);
        return;
    }
    // 2. Read the content of the target files and source files.
    const targetContents = targetFiles.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    const sourceContents = sourceFiles.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    // 3. Deduplicate the keys in the target contents based on the source contents.
    targetContents.forEach((targetContent, index) => {
        const sourceContent = sourceContents[index];
        if (typeof targetContent !== 'object' || typeof sourceContent !== 'object') {
            console.warn(`Target content or source content is not an object for file ${targetFiles[index]}.`);
            return;
        }
        // check whether the keys in the target content exist in the source content.
        Object.keys(targetContent).forEach(key => {
            if (sourceContent.hasOwnProperty(key)) {
                delete targetContent[key];
                console.log(`Key "${key}" in target file ${targetFiles[index]} has been deduplicated.`);
            }
        });
    });
    // 4. Write the deduplicated target contents back to the target files.
    targetFiles.forEach((file, index) => {
        fs.writeFileSync(file, JSON.stringify(targetContents[index], null, 2), 'utf8');
        console.log(`Deduplicated content written to ${file}.`);
    }
    );
    console.log('Deduplication completed.');
    // 5. Return the deduplicated target contents.
    return targetContents;
}

function mergeJSONFiles(targetFilePath, sourceFilePath) {
    // targetFilePath: the file path of the target file which will be merged into the source file
    // sourceFilePath: the file path of the source file which will be merged with the target file

    if (!fs.existsSync(targetFilePath)) {
        console.warn(`Target path ${targetFilePath} does not exist.`);
        return;
    }
    if (!fs.existsSync(sourceFilePath)) {
        console.warn(`Source path ${sourceFilePath} does not exist.`);
        return;
    }

    const targetContent = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'));
    const sourceContent = JSON.parse(fs.readFileSync(sourceFilePath, 'utf8'));

    // Merge targetContent into sourceContent
    Object.keys(targetContent).forEach(key => {
        if (!sourceContent.hasOwnProperty(key) ) {
            if (typeof targetContent[key] === 'string') {
                sourceContent[key] = targetContent[key];
                console.log(`Key "${key}" from target file has been added to source file.`);
            }else {
                console.warn(`Key "${key}" in target file is not a string. Skipping.`);
            }
        } else {
            console.warn(`Key "${key}" already exists in source file. Skipping.`);
        }
    });

    fs.writeFileSync(sourceFilePath, JSON.stringify(sourceContent, null, 2), 'utf8');
    console.log(`Merged content written to ${sourceFilePath}.`);
}

function merge(targetFilePath, sourceFilePath){
    if (!fs.existsSync(targetFilePath)) {
        console.warn(`Target path ${targetFilePath} does not exist.`);
        return;
    }
    if (!fs.existsSync(sourceFilePath)) {
        console.warn(`Source path ${sourceFilePath} does not exist.`);
        return;
    }

    const targetStat = fs.statSync(targetFilePath);
    const sourceStat = fs.statSync(sourceFilePath);

    if (targetStat.isFile() && sourceStat.isFile()) {
        mergeJSONFiles(targetFilePath, sourceFilePath);
    } else if (targetStat.isDirectory() && sourceStat.isDirectory()) {
        const targetFilesInDir = fs.readdirSync(targetFilePath).filter(file => file.endsWith('.json'));
        targetFilesInDir.forEach(file => {
            const targetFileFullPath = `${targetFilePath}/${file}`;
            const sourceFileFullPath = `${sourceFilePath}/${file}`;
            if (fs.existsSync(sourceFileFullPath)) {
                mergeJSONFiles(targetFileFullPath, sourceFileFullPath);
            } else {
                const targetContent = JSON.parse(fs.readFileSync(targetFileFullPath, 'utf8'));
                fs.writeFileSync(sourceFileFullPath, JSON.stringify(targetContent, null, 2), 'utf8');
                console.warn(`Source file ${sourceFileFullPath} not found for target file ${targetFileFullPath}.`);
            }
        });
    } else {
        console.warn(`Incompatible types: ${targetFilePath} is a ${targetStat.isFile() ? 'file' : 'directory'}, ${sourceFilePath} is a ${sourceStat.isFile() ? 'file' : 'directory'}.`);
    }
}

module.exports = {
    deduplicateKeys,
    merge
};