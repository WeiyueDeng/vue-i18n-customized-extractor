const fs = require('fs');
const path = require('path');

function runSplit(targetDir){
// NOTES: This function is used to split and reorganize the json files of translate-as-whole-pointer
    // Check if the targetDir exists
    if (!fs.existsSync(targetDir)) {
        console.error(`❌ Target directory or file does not exist: ${targetDir}`);
        return;
    }

    const stat = fs.statSync(targetDir);

    let jsonFiles = [];

    // If targetDir is a file
    if (stat.isFile()) {
        if (targetDir.endsWith('.json')) {
            jsonFiles = [targetDir];
        } else {
            console.warn(`⚠️ Skipping unsupported file: ${targetDir}`);
            return;
        }
    } else if (stat.isDirectory()) {
        // If targetDir is a folder
        jsonFiles = fs.readdirSync(targetDir)
            .filter(file => file.endsWith('.json'))
            .map(file => path.join(targetDir, file));
    } else {
        console.warn(`⚠️ Unsupported target type: ${targetDir}`);
        return;
    }

    // 1. Create a map to store the split array for each key in each JSON file.
    // **NOTES: The split result array of "Please edit < address >. If any question, <contact support>" will be: 
    //   -> cosnt splitResultArray = [
    //        {content: "Please edit ", isNested: false}, 
    //        {content: " address ", isNested: true}, 
    //        {content: ". If any question, ", isNested: false}, 
    //        {content: "contact support", isNested: true}
    //      ]
    //   The format of the map is: 
    //   eg. { "Please edit < address >. If any question, <contact support>": {
    //           "en-TranslateAsWholePointer": [
    //              {content: "Please edit ", isNested: false}, 
    //              {content: " address ", isNested: true}, 
    //              {content: ". If any question, ", isNested: false}, 
    //              {content: "contact support", isNested: true}
    //           ],
    //           <fileName>: <splitResultArray>  
    //          } 
    //        }
    var splitResultArrayOfAllFiles = {};
    // filesOutput is used to store the output of each JSON file
    // **NOTES: The format will be:{
    //   "en-TranslateAsWholePointer": {
    //     "0~~Please edit < address >. If any question, <contact support>": "Please edit ",
    //     "1~~Please edit < address >. If any question, <contact support>": " address ",
    //     "2~~Please edit < address >. If any question, <contact support>": ". If any question, ",
    //     "3~~Please edit < address >. If any question, <contact support>": "contact support",
    //    },
    //  "fr-TranslateAsWholePointer": {
    //     "0~~Please edit < address >. If any question, <contact support>": "Please edit ",
    //     "1~~Please edit < address >. If any question, <contact support>": " address ",
    //     "2~~Please edit < address >. If any question, <contact support>": ". If any question, ",
    //     "3~~Please edit < address >. If any question, <contact support>": "contact support",
    //    },
    //   ...
    //}
    var filesOutput = {}; 
    var filesPointersCollection = [];
    jsonFiles.forEach(file => {
        console.log(`Processing JSON file: ${file}`);
        const fileName = path.parse(file).name; // Get the current JSON file's name
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            console.log(`✅ Successfully read data from ${file}`);
            // Perform operations on the JSON data here
            // console.log(data); // Example: log the data
            splitJsonHelper(data, fileName, splitResultArrayOfAllFiles);
            // the initial index of the pointer for each file is 0
            filesPointersCollection.push({fileName, pointerIndex: 0});
        } catch (error) {
            console.error(`❌ Failed to process ${file}:`, error.message);
        }
    });

    // 4. Process each JSON file
    reorganizeSplitResultArrayOfAllFiles(splitResultArrayOfAllFiles, filesPointersCollection, filesOutput);

    // 5. Genereate the output file for each file processed
    Object.keys(filesOutput).forEach(fileName => {
        if(filesOutput[fileName]) {
            if (!fs.existsSync('src/locales')) {
                fs.mkdirSync('src/locales');
            }
            fs.writeFileSync(`src/locales/${fileName}-TranslateAsWholePointer.json`, JSON.stringify(filesOutput[fileName], null, 2));
        }
    })
}

function reorganizeSplitResultArrayOfAllFiles(splitResultArrayOfAllFiles, filesPointersCollection, filesOutput) {
    // pointers for each file
    Object.keys(splitResultArrayOfAllFiles).forEach(key => {
        const splitResultArraysOfCurKeyInAllFiles = splitResultArrayOfAllFiles[key];
        // console.log("splitResultArraysOfCurKeyInAllFiles:", JSON.stringify(filesPointersCollection, null, 2));
        var maxLengthOfSplitResultArray = 0;
        var curNestedContentMaxIndex = 0;
        while(!isAnyPointerAtEnd(splitResultArraysOfCurKeyInAllFiles, filesPointersCollection)){
            // each round, we find the next nested part and record the max index of that nested part in each file.
            // then we adjust the position that nested part in each file to match the max index in its own split result array
            filesPointersCollection.forEach(file => {
                const splitResultArraysOfCurKeyInCurFile= splitResultArraysOfCurKeyInAllFiles[file.fileName];
                // console.log(`Found splitResultArraysOfCurKeyInCurFile in file: ${file.fileName}`, splitResultArraysOfCurKeyInCurFile);
                // stop the pointer if it find the next nested part or it reaches the end of its own split result array
                while(file.pointerIndex < splitResultArraysOfCurKeyInCurFile.length && !splitResultArraysOfCurKeyInCurFile[file.pointerIndex].isNested){
                    file.pointerIndex++;
                }
                if(file.pointerIndex < splitResultArraysOfCurKeyInCurFile.length){
                // If we found a nested part, we can update the curNestedMaxIndex
                    curNestedContentMaxIndex = Math.max(curNestedContentMaxIndex, file.pointerIndex);
                    // console.log(`Found nested part in file: ${file.fileName} at index: ${file.pointerIndex}`, "max index so far:", curNestedContentMaxIndex);
                }else{
                // If the pointer reaches the end of its own split result array, we can stop it, and record the max length of all split result arrays
                    maxLengthOfSplitResultArray = Math.max(maxLengthOfSplitResultArray, file.pointerIndex);
                }
            });
            if(!maxLengthOfSplitResultArray){
            //If there is no max length of split result array, it means we have not reached the end of any file's split result array
                filesPointersCollection.forEach(file => {
                    // console.log(`Current pointer index in file: ${file.fileName} is: ${file.pointerIndex}`, `curNestedContentMaxIndex: ${curNestedContentMaxIndex}`);
                    var diffIndex = curNestedContentMaxIndex - file.pointerIndex;
                    //adjust the nested part in each file to match the max index in its own split result array by adding empty strings as elements before the nested part based on diffIndex
                    while(diffIndex > 0){
                        // console.log(`add emptry string to file: ${file.fileName} at index: ${file.pointerIndex}`, splitResultArraysOfCurKeyInAllFiles[file.fileName]);
                        splitResultArraysOfCurKeyInAllFiles[file.fileName].splice(file.pointerIndex, 0, {content: "", isNested: false});
                        diffIndex--;
                    }
                //    console.log(`Adjusted nested part in file: ${file.fileName} to index: ${file.pointerIndex-1 < 0 ? 0:file.pointerIndex-1}`, "splitResultArraysOfCurKeyInCurFile:", splitResultArraysOfCurKeyInAllFiles[file.fileName]);
                });
                // After adjusting the current nested part in each file, we update all files' pointer to be the curNestedMaxIndex+1 to start the next round
                filesPointersCollection.forEach(file => {
                    file.pointerIndex = curNestedContentMaxIndex + 1;
                });
                // console.log(`Updated all files' pointer to be the curNestedContentMaxIndex + 1: ${curNestedContentMaxIndex + 1}`, "filesPointersCollection:",JSON.stringify(filesPointersCollection, null, 2));
            }else{
            // If we have reached the end of all files' split result arrays:
            // we can update all split result arrays of the current key to match the max length of split result array 
            // by adding empty strings as elements at the end of the corresponding split result array based on diffLength
                filesPointersCollection.forEach(file => {
                    var diffLength = maxLengthOfSplitResultArray - file.pointerIndex;
                    while(diffLength > 0){
                        splitResultArraysOfCurKeyInAllFiles[file.fileName].push({content: "", isNested: false});
                        diffLength--;
                    }
                });
                break;
            }
        }
        if(!maxLengthOfSplitResultArray){
        // double check if we have reached the end of all files' split result arrays in the above while loop
        // !maxLengthOfSplitResultArray means we have not reached the end of any file's split result array:
        // NOTES: means at least one of the file's pointer reach the end of its own split result array after "file.pointerIndex = curNestedContentMaxIndex + 1;"
            // so we need to FIRST manually go through the files to get the max length of split result array
            filesPointersCollection.forEach(file => {
                const splitResultArraysOfCurKeyInCurFile = splitResultArraysOfCurKeyInAllFiles[file.fileName];
                maxLengthOfSplitResultArray = Math.max(maxLengthOfSplitResultArray, splitResultArraysOfCurKeyInCurFile.length);
            });
            // and add empty strings as elements at the end of the corresponding split result array based on diffLength
            filesPointersCollection.forEach(file => {
                const splitResultArraysOfCurKeyInCurFile = splitResultArraysOfCurKeyInAllFiles[file.fileName];
                var diffLength = maxLengthOfSplitResultArray - splitResultArraysOfCurKeyInCurFile.length;
                while(diffLength > 0){
                    splitResultArraysOfCurKeyInCurFile.push({content: "", isNested: false});
                    diffLength--;
                }
            });
        }
        //reset all pointers to 0 for the next key
        filesPointersCollection.forEach(file => {
            file.pointerIndex = 0;
        });
    });
    // console.log("splitResultArrayOfAllFiles after reorganizing:\n", JSON.stringify(splitResultArrayOfAllFiles,null, 2));
    // parse output for each key by fileName
    Object.keys(splitResultArrayOfAllFiles).forEach(key => {
        const splitResultArraysOfCurKeyInAllFiles = splitResultArrayOfAllFiles[key];
        Object.keys(splitResultArraysOfCurKeyInAllFiles).forEach(fileName => {
            if(!filesOutput[fileName]){
                // If the fileName does not exist in filesOutput, create a new object
                filesOutput[fileName] = {};
            }
            const splitResultArraysOfCurKeyInCurFile = splitResultArraysOfCurKeyInAllFiles[fileName];
            splitResultArraysOfCurKeyInCurFile.forEach((item, index) => {
                // Create a key for the item based on its index and the key
                const keyForItem = `${index}${item.isNested?'Nested':''}~~${key}`;
                // Add the item to the filesOutput for the current fileName
                filesOutput[fileName][keyForItem] = item.content;
            });
        });
    });
}
function isAnyPointerAtEnd(splitResultArraysOfCurKeyInAllFiles, filesPointersCollection){
    var output = filesPointersCollection.some(({fileName, pointerIndex})=> {
        return pointerIndex >= splitResultArraysOfCurKeyInAllFiles[fileName].length;
    });
    return output;
}

function splitJsonHelper(data, fileName, splitResultArrayOfAllFiles) {
    if(!data) return;

    // Iterate over each key in the data object 
    Object.keys(data).forEach(key => {
        const value = data[key];
        // Only process and add value to output, if the value is a string
        if (typeof value === 'string') {
            // find all contents inside angle brackets (eg. < ... >)
            const matchedContentsInsideAngleBracketsOfValue = [...value.matchAll(/<([^>]+)>/g)].map(match => match[1]);
            // Only process the value if it has any contents inside angle brackets
            if (matchedContentsInsideAngleBracketsOfValue.length > 0) {
                // get the split result array of the value, divided by angle brackets
                const splitResultArray = splitByAngleBrackets(value);
                // add the split result array to the splitResultArrayOfAllFiles with key as the outer key and fileName as the key of the inner object
                if(!splitResultArrayOfAllFiles[key]){
                    // If the key does not exist in the splitResultArrayOfAllFiles, create a new object
                    splitResultArrayOfAllFiles[key] = {};
                }
                splitResultArrayOfAllFiles[key][fileName] = splitResultArray;
            }
            // //else: skip if the value is a string without angle brackets
        } 
        // else: if the value is not a string, we can skip it
    });
}
function splitByAngleBrackets(value) {
    var result = [];
    var regex = /<([^>]+)>/g;
    var lastIndex = 0;
    var match;
    
    while ((match = regex.exec(value)) !== null) {
        if (match.index > lastIndex) {
            result.push({
                content: value.slice(lastIndex, match.index),
                isNested: false // This part is not inside angle brackets
            });
        }
        //**NOTES: match[1] is the content inside the angle brackets
        result.push({
            content:match[1],
            isNested: true // This part is inside angle brackets
        });
        lastIndex = match.index + match[0].length;
    }
    
    if (lastIndex < value.length) {
        result.push({
            content: value.slice(lastIndex),
            isNested: false // This part is not inside angle brackets
        });
    }
        
    //else: skip if the value is a string without angle brackets
    return result;
}

module.exports = {
    runSplit
};