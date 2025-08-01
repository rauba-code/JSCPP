import { LLParser, NonTerm } from './typecheck';
import * as typecheck from './typecheck'

function makeStringArr(type: string | string[]): string[] {
    if (typeof type === "string") {
        return type.split(" ");
    }
    return type;
}

function makeString(type: string | string[]): string {
    if (typeof type === "string") {
        return type;
    }
    return type.join(' ');
}

export function abstractFunctionReturnSig(sig: string[]): string[] {
    let level = 0;
    let returnStarts = -1;
    let returnEnds = -1;
    for (let i = 0; i < sig.length; i++) {
        if (sig[i] === "FUNCTION") {
            if (level === 0) {
                returnStarts = i + 1;
            }
            level++;
        } else if (sig[i] === "(" && level === 1) {
            returnEnds = i;
        } else if (sig[i] === ")") {
            level--;
        }
    }
    return sig.slice(0, returnStarts).concat("Return", ...sig.slice(returnEnds));
}

export interface FunctionMatchResult extends typecheck.ParseFunctionMatchResult {
    fnid: number,
    valueActions: ("CLONE" | "BORROW" | "CAST")[],
    castActions: { index: number, cast: typecheck.CastAction }[],
}

export class TypeDB {
    parser: LLParser;
    scope: NonTerm;
    strict_order: boolean;
    functions: {
        [identifier: string]: {
            overloads: {
                type: string[],
                fnid: number,
                /** see FunctionSig for more description */
                templateTypes: number[],
            }[],
            cache: {
                [signature: string]: FunctionMatchResult | null
            },
            exactCache: {
                [signature: string]: number // fnid
            }
        }
    };

    constructor(parser: LLParser, scope: NonTerm = "Type", strict_order = true) {
        this.parser = parser;
        this.scope = scope;
        this.strict_order = strict_order;
        this.functions = {}
    };

    matchSubset(subtype: string | string[], supertype: string | string[], allow_lvalue_substitution = false): boolean {
        return typecheck.parseSubset(this.parser, makeStringArr(subtype), makeStringArr(supertype), this.scope, this.strict_order, allow_lvalue_substitution);
    };

    matchFunction(subtype: string | string[], supertype: string | string[], templateTypes: string[][], ictable: typecheck.ImplicitConversionTable): typecheck.ParseFunctionMatchResult | null {
        return typecheck.parseFunctionMatch(this.parser, makeStringArr(subtype), makeStringArr(supertype), ictable, templateTypes, this.strict_order);
    };

    addFunctionOverload(identifier: string, function_type: string | string[], templateTypes: number[], function_id: number, onError: (x: string) => void): void {
        const sa = abstractFunctionReturnSig(makeStringArr(function_type));
        const inline = sa.join(" ");
        if (!(identifier in this.functions)) {
            this.functions[identifier] = { overloads: [{ type: sa, fnid: function_id, templateTypes }], cache: {}, exactCache: { [inline]: function_id } };
        } else {
            this.functions[identifier].overloads.push({ type: sa, fnid: function_id, templateTypes });
            // clean the cache for this function
            this.functions[identifier].cache = {};
            // keep exactCache
            if (inline in this.functions[identifier].exactCache) {
                onError(`Redeclaration of a function '${identifier}'`);
            }
            this.functions[identifier].exactCache[inline] = function_id;
        }
    };

    matchSingleFunction(identifier: string, onError: (x: string) => never): number {
        const fnobj = this.functions[identifier];
        if (fnobj === undefined) {
            return -1;
        }
        if (fnobj.overloads.length > 1) {
            onError(`Overloaded function ${identifier} has multiple candidates`);
        }
        return fnobj.overloads[0].fnid;
    };

    matchFunctionByParams(identifier: string, params: (string | string[])[], templateTypes: (string | string[])[], ictable: typecheck.ImplicitConversionTable, onError: (x: string) => void): FunctionMatchResult | null {
        if (!(identifier in this.functions)) {
            return null;
        }
        const targetParams: string[] = params.flatMap((x) => {
            const sa: string[] = makeStringArr(x);
            if (sa.length > 0 && sa[0].startsWith(typecheck.wildcardDeclarator)) {
                onError("Calling a function with parameters of wildcard type is unsupported");
            }
            return sa;
        });
        const target: string[] = ["FUNCTION", "Return", "("].concat(...targetParams).concat(")");
        return this.matchOverload(identifier, target, templateTypes.map(makeStringArr), ictable, onError);
    };

    /** Used for matching function definitions and implementations;
     * Returns the associated function id on a match, -1 otherwise.
     */
    matchExactOverload(identifier: string, target: string): number {
        const fnobj = this.functions[identifier];
        if (fnobj === undefined) {
            return -1;
        }
        const targetInline = makeString(target);
        if (targetInline in fnobj.exactCache) {
            return fnobj.exactCache[targetInline];
        }
        return -1;
    };

    matchOverload(identifier: string, target: string[], templateTypes: string[][], ictable: typecheck.ImplicitConversionTable, onError: (x: string) => void): FunctionMatchResult | null {
        const fnobj = this.functions[identifier];
        if (fnobj === undefined) {
            return null;
        }
        const targetInline = makeString(target);
        if (targetInline in fnobj.cache) {
            return fnobj.cache[targetInline];
        }
        let bestCandidate: FunctionMatchResult | null = null;
        let candidateIndices: number[] = [];
        for (let i = 0; i < fnobj.overloads.length; i++) {
            if (templateTypes.length > fnobj.overloads[i].templateTypes.length) {
                continue;
            }
            let match = this.matchFunction(target, fnobj.overloads[i].type, templateTypes, ictable);
            if (match !== null) {
                if (bestCandidate !== null) {
                    if (bestCandidate.castActions.length > match.castActions.length) {
                        candidateIndices = [ i ];
                        bestCandidate = match as FunctionMatchResult;
                        bestCandidate.fnid = fnobj.overloads[i].fnid;
                    } else if (bestCandidate.castActions.length === match.castActions.length) {
                        candidateIndices.push(i);
                    }
                } else {
                    bestCandidate = match as FunctionMatchResult;
                    bestCandidate.fnid = fnobj.overloads[i].fnid;
                }
            }
        }
        if (candidateIndices.length > 1) {
            onError(`Call of overloaded function \'${identifier}\' matches more than one candidate:\n${candidateIndices.map((iv, ii) => (ii + 1).toString() + ") " + fnobj.overloads[iv].type.join(" ")).join("\n")}`);
            return null;
        }
        fnobj.cache[targetInline] = bestCandidate;
        return bestCandidate;
    };

    parse(type: string | string[]): boolean {
        return typecheck.parse(this.parser, makeStringArr(type), this.scope, this.strict_order);
    };
}
