var vm = require("vm");
var fs = require("fs");
var data = fs.readFileSync("./dist/JSCPP.js");
global.window = global;
global.document = {};
vm.runInThisContext(data);

var config = {
    fstream: undefined,
    stdio: {
        finishCallback: function(exitCode) {
            console.log("\nprogram exited with code " + exitCode + "\n");
        },
        promiseError: function(promise_error) {
            console.error(promise_error);
        },
        write: function(s) {
            console.log(s);
        }
    },
    stopExecutionCheck: function() {
        return false;
    },
    //maxExecutionSteps: (100 * 100) * 10, // (lines of code * loop iterations) * 10 times buffer
    maxTimeout: 3 * 60 * 1000, // 3 mins
    eventLoopSteps: 10_000,
    unsigned_overflow: "error"
};

function run(x) { 
    const msStart = Date.now();
    window.JSCPP.run(x, undefined, config); 
    const msEnd = Date.now();
    console.log("done in " + ((msEnd - msStart) / 1000).toFixed(3) + " s");
}
run("#include <iostream>\nusing namespace std;\nint main() {\ncout << \"Labas\" << endl;\n return 0;\n }\n")
