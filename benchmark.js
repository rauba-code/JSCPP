import { runInThisContext } from "vm";
import { readFileSync, readdirSync } from "fs";
import { extname } from 'path';
import { XMLParser } from "fast-xml-parser";
var JSCPPData = readFileSync("./dist/JSCPP.js");
global.window = global;
global.document = {};
runInThisContext(JSCPPData);

const xmlParser = new XMLParser({
    ignoreAttributes: false
});

function parseFromXML(filePath, fileName) {

    const xml_content = readFileSync(filePath + fileName, "utf-8");
    const parsedObject = xmlParser.parse(xml_content);

    return {
        fileName,
        ...parsedObject
    };
};

function objectToTest(object) {
    function parseConsoleInput(parsed) {
        return {
            input: parsed.input["#text"],
            output: parsed.output["#text"]
        };
    };

    function parseFileInput(parsed) {
        if (!parsed)
            return ({});

        return {
            input_filename: parsed.input?.["@_filename"],
            output_filename: parsed.output?.["@_filename"],
            input: parsed.input?.["#text"],
            output: parsed.output?.["#text"]
        };
    };

    function mergeScenarios(obj1, obj2) {
        const result = { ...obj1 };
        for (const key in obj2) {
            if (obj2[key] != null)
                result[key] = obj2[key];
        }
        return result;
    };

    const fileName = object.fileName.replace(".xml", "");

    return {
        name: fileName,
        test: {
            after: [],
            cases: [object.tests.test].flat().map((test) => ({
                testID: test["@_id"],
                fileName,
                code: object.code,
                scenarios: mergeScenarios(parseConsoleInput(test.console), parseFileInput(test.files))
            }))
        }
    };
};

const testFolder = './integration-tests/';

const files = readdirSync(testFolder);
const xmlFiles = files.filter((file) => extname(file) === '.xml');

const tests = xmlFiles.map((xmlFile) => objectToTest(parseFromXML(testFolder, xmlFile)));

function createFstream(input_filename, output_filename, input, verbose) {
    const testFiles = {
        [input_filename]: { value: input },
        [output_filename]: { value: "" }
    };

    const openFiles = {};

    return {
        open(context, fileName) {
            const openFileNode = testFiles[fileName] || ({ [fileName]: { value: "" } });
            if (verbose) { console.log(`  [file::open(${fileName})]`); }
            openFiles[fileName] = {
                name: fileName,
                _open: openFileNode != null,
                is_open() {
                    return this._open;
                },
                read() {
                    if (!this.is_open())
                        return;
                    if (verbose) { console.log(`  [file::read] ${JSON.stringify(openFileNode.value)}`) }

                    return openFileNode.value;
                },
                clear() {
                    if (verbose) { console.log("  [file::clear]") }
                    openFileNode.value = "";
                },
                write(data) {
                    if (!this.is_open())
                        return;
                    if (verbose) { console.log(`  [file::write] ${JSON.stringify(data)}`) }

                    openFileNode.value += data;
                },
                close() {
                    this._open = false;
                    if (verbose) { console.log("  [file::close]") }
                }
            };

            return openFiles[fileName];
        },

        getExpectedOutput() {
            outputBuffer = testFiles[output_filename].value;
        }
    };
};


async function run(code, input, config) {
    await window.JSCPP.run(code, () => Promise.resolve(input), config);
}

for (let attempt = 0; attempt < 50; attempt++) {
    for (const test of tests) {
        for (const testCase of test.test.cases) {
            const { input, input_filename, output_filename } = testCase.scenarios;
            console.log(`input = ${JSON.stringify(input)}`);
            let line = "";
            const config = {
                msStart: Date.now(),
                fstream: createFstream(input_filename ?? "_NULL_IN", output_filename ?? "_NULL_OUT", input, false),
                stdio: {
                    finishCallback: function(exitCode) {
                        console.log("\nprogram exited with code " + exitCode);
                        const msEnd = Date.now();
                        console.log(`[BENCH] ${JSON.stringify(test.name)};${JSON.stringify(testCase.testID)};${attempt};${msEnd-config.msStart}`)
                        console.log("done in " + ((msEnd - config.msStart) / 1000).toFixed(3) + " s\n");
                    },
                    promiseError: function(promise_error) {
                        //console.error(promise_error);
                        throw new Error(promise_error);
                    },
                    write: function(s) {
                        if (s.includes("\n")) {
                            const lines = s.split("\n");
                            lines[0] = line + lines[0];
                            lines.forEach((ln) => console.log(`  [stdout] ${ln}`));
                        }
                        line += s;
                    }
                },
                stopExecutionCheck: function() {
                    return false;
                },
                maxTimeout: 3 * 60 * 1000, // 3 mins
                eventLoopSteps: 10_000,
                unsigned_overflow: "error"
            };
            await run(testCase.code, input, config)
        };
    }
}

//run("#include <iostream>\nusing namespace std;\nint main() {\ncout << \"Labas\" << endl;\n return 0;\n }\n")

