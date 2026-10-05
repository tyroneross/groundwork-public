#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// engine/src/cli.ts
import * as fs4 from "node:fs";
import * as os from "node:os";
import * as path4 from "node:path";
import * as crypto4 from "node:crypto";
import { fileURLToPath } from "node:url";

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path5, errorMaps, issueData } = params;
  const fullPath = [...path5, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path5, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path5;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// engine/src/owned-files.ts
var PRIVATE_SEGMENTS = /* @__PURE__ */ new Set([".git", ".ssh", ".aws", ".gnupg", ".env", "secrets", "credentials"]);
var PRIVATE_NAME = /^(?:credentials(?:\.[^.]+)?|secrets?(?:\.[^.]+)?|id_(?:rsa|dsa|ecdsa|ed25519))$/i;
function isSafeOwnedFile(value) {
  if (value.includes("\0") || value.startsWith("/") || value.startsWith("~") || value.startsWith("\\\\")) return false;
  if (value.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || /%(?![0-9A-Fa-f]{2})/.test(value)) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  const segments = decoded.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return false;
  return segments.every((part) => {
    const lower = part.toLowerCase();
    return !PRIVATE_SEGMENTS.has(lower) && !(lower.startsWith(".env.") && lower !== ".env.example") && !PRIVATE_NAME.test(part);
  });
}
var OwnedFileSchema = external_exports.string().min(1).refine(
  isSafeOwnedFile,
  "Owned files must be traversal-free, non-private repository-relative POSIX file paths."
);
var OwnedFilesSchema = external_exports.array(OwnedFileSchema).min(1).superRefine((values, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  values.forEach((value, index) => {
    if (seen.has(value)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: [index], message: `Duplicate owned file: ${value}` });
    seen.add(value);
  });
});
var DeclaredNewFileSchema = external_exports.object({
  path: OwnedFileSchema,
  because: external_exports.string().min(1)
}).strict();

// engine/src/architecture.ts
var IdSchema = external_exports.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var NonEmptyStringSchema = external_exports.string().min(1);
function uniqueStringArraySchema() {
  return external_exports.array(NonEmptyStringSchema).superRefine((values, ctx) => {
    const seen = /* @__PURE__ */ new Set();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate value: ${value}`
        });
      }
      seen.add(value);
    });
  });
}
var ProvenanceSchema = external_exports.enum(["observed", "decided", "assumed", "derived"]);
var QualifiedRefKindSchema = external_exports.enum([
  "component",
  "contract",
  "feature",
  "screen",
  "element",
  "requirement",
  "flow",
  "task"
]);
var QualifiedRefSchema = external_exports.object({
  specId: IdSchema,
  kind: QualifiedRefKindSchema,
  id: IdSchema
}).strict();
var ScreenStateRefSchema = external_exports.object({
  screenId: IdSchema,
  state: NonEmptyStringSchema
}).strict();
var UniqueQualifiedRefsSchema = external_exports.array(QualifiedRefSchema).min(1).superRefine((refs, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  refs.forEach((ref2, index) => {
    const identity = qualifiedRefIdentity(ref2);
    if (seen.has(identity)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [index],
        message: `Duplicate qualified reference: ${identity}`
      });
    }
    seen.add(identity);
  });
});
var PortDirectionSchema = external_exports.enum(["input", "output", "bidirectional"]);
var PortSchema = external_exports.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  type: NonEmptyStringSchema,
  direction: PortDirectionSchema,
  required: external_exports.boolean().default(true)
}).strict();
var ComponentKindSchema = external_exports.enum([
  "ui",
  "service",
  "data",
  "integration",
  "agent",
  "library",
  "platform"
]);
var ComponentSchema = external_exports.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  kind: ComponentKindSchema,
  featureIds: uniqueStringArraySchema(),
  owner: NonEmptyStringSchema,
  /** Optional runtime/data ownership boundary; `owner` remains the accountable team. */
  ownership: external_exports.array(NonEmptyStringSchema).optional(),
  description: external_exports.string().optional(),
  provenance: ProvenanceSchema.optional(),
  ownedFiles: OwnedFilesSchema.optional()
}).strict();
var ContractSchema = external_exports.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  provider: QualifiedRefSchema,
  consumers: UniqueQualifiedRefsSchema,
  ports: external_exports.array(PortSchema).min(1),
  transport: NonEmptyStringSchema,
  failureModes: external_exports.array(NonEmptyStringSchema).min(1),
  securityNotes: external_exports.array(NonEmptyStringSchema).min(1),
  /** Named writes this boundary may perform; prose stays available for legacy contracts. */
  writeBoundaryNotes: external_exports.array(NonEmptyStringSchema).optional(),
  provenance: ProvenanceSchema.optional(),
  ownedFiles: OwnedFilesSchema.optional()
}).strict();
var RelationshipDirectionSchema = external_exports.enum([
  "unidirectional",
  "bidirectional",
  "event"
]);
var RelationshipCriticalitySchema = external_exports.enum(["hard", "soft", "informational"]);
var RelationshipSchema = external_exports.object({
  id: IdSchema,
  from: QualifiedRefSchema,
  to: QualifiedRefSchema,
  direction: RelationshipDirectionSchema,
  contractRef: QualifiedRefSchema.optional(),
  criticality: RelationshipCriticalitySchema,
  optional: external_exports.boolean(),
  rationale: NonEmptyStringSchema,
  provenance: ProvenanceSchema.optional()
}).strict();
var ExchangeSchema = external_exports.object({
  id: IdSchema,
  order: external_exports.number().int().min(1),
  from: QualifiedRefSchema,
  to: QualifiedRefSchema,
  contractRef: QualifiedRefSchema,
  inputRefs: external_exports.array(QualifiedRefSchema),
  outputRefs: external_exports.array(QualifiedRefSchema),
  stateRefs: external_exports.array(ScreenStateRefSchema).default([]),
  failurePaths: external_exports.array(NonEmptyStringSchema).min(1),
  effects: external_exports.array(NonEmptyStringSchema).optional(),
  writes: external_exports.array(NonEmptyStringSchema).optional()
}).strict();
var FlowSchema = external_exports.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  trigger: NonEmptyStringSchema,
  exchanges: external_exports.array(ExchangeSchema).min(1),
  provenance: ProvenanceSchema.optional()
}).strict();
var SpecDependencyLocationSchema = external_exports.discriminatedUnion("kind", [
  external_exports.object({
    kind: external_exports.literal("local"),
    path: NonEmptyStringSchema
  }).strict(),
  external_exports.object({
    kind: external_exports.literal("uri"),
    uri: external_exports.string().url()
  }).strict()
]);
var SpecDependencyRelationshipSchema = external_exports.enum([
  "uses",
  "extends",
  "implements",
  "companion"
]);
var SpecDependencySchema = external_exports.object({
  id: IdSchema,
  specId: IdSchema,
  location: SpecDependencyLocationSchema,
  schemaVersion: external_exports.number().int().min(1),
  revision: NonEmptyStringSchema,
  digest: external_exports.string().regex(/^sha256:[a-f0-9]{64}$/),
  relationship: SpecDependencyRelationshipSchema,
  optional: external_exports.boolean().default(false)
}).strict();
var ArchitectureSchema = external_exports.object({
  components: external_exports.array(ComponentSchema),
  contracts: external_exports.array(ContractSchema),
  relationships: external_exports.array(RelationshipSchema),
  flows: external_exports.array(FlowSchema),
  specDependencies: external_exports.array(SpecDependencySchema)
}).strict();
function qualifiedRefIdentity(ref2) {
  return `${ref2.specId}:${ref2.kind}:${ref2.id}`;
}
function pathIdentity(path5) {
  return path5.map((part) => typeof part === "number" ? String(part).padStart(10, "0") : part).join(".");
}
function compareIssues(left, right) {
  return pathIdentity(left.path).localeCompare(pathIdentity(right.path)) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
}
function copyRef(ref2) {
  return { specId: ref2.specId, kind: ref2.kind, id: ref2.id };
}
function validateArchitecture(architecture, context) {
  const issues = [];
  const knownIdentities = /* @__PURE__ */ new Map();
  const addIssue = (issue) => issues.push(issue);
  const registerIdentity = (ref2, path5) => {
    const identity = qualifiedRefIdentity(ref2);
    const firstPath = knownIdentities.get(identity);
    if (firstPath) {
      addIssue({
        code: "duplicate_qualified_identity",
        path: path5,
        message: `Duplicate qualified identity ${identity}; first declared at ${pathIdentity(firstPath)}`
      });
      return;
    }
    knownIdentities.set(identity, path5);
  };
  const flagDuplicateIds = (values, basePath) => {
    const seen = /* @__PURE__ */ new Map();
    values.forEach((value, index) => {
      const firstIndex = seen.get(value.id);
      if (firstIndex !== void 0) {
        addIssue({
          code: "duplicate_id",
          path: [basePath, index, "id"],
          message: `Duplicate ${basePath} ID ${value.id}; first declared at ${basePath}.${firstIndex}.id`
        });
      } else {
        seen.set(value.id, index);
      }
    });
  };
  flagDuplicateIds(architecture.components, "components");
  flagDuplicateIds(architecture.contracts, "contracts");
  flagDuplicateIds(architecture.relationships, "relationships");
  flagDuplicateIds(architecture.flows, "flows");
  flagDuplicateIds(architecture.specDependencies, "specDependencies");
  const ports = architecture.contracts.flatMap(
    (contract, contractIndex) => contract.ports.map((port, portIndex) => ({ ...port, path: ["contracts", contractIndex, "ports", portIndex, "id"] }))
  );
  const seenPortIds = /* @__PURE__ */ new Map();
  ports.forEach((port) => {
    const firstPath = seenPortIds.get(port.id);
    if (firstPath) {
      addIssue({
        code: "duplicate_id",
        path: port.path,
        message: `Duplicate port ID ${port.id}; first declared at ${pathIdentity(firstPath)}`
      });
    } else {
      seenPortIds.set(port.id, port.path);
    }
  });
  const exchanges = architecture.flows.flatMap(
    (flow, flowIndex) => flow.exchanges.map((exchange, exchangeIndex) => ({
      exchange,
      flowIndex,
      exchangeIndex,
      path: ["flows", flowIndex, "exchanges", exchangeIndex]
    }))
  );
  const seenExchangeIds = /* @__PURE__ */ new Map();
  exchanges.forEach(({ exchange, path: path5 }) => {
    const idPath = [...path5, "id"];
    const firstPath = seenExchangeIds.get(exchange.id);
    if (firstPath) {
      addIssue({
        code: "duplicate_id",
        path: idPath,
        message: `Duplicate exchange ID ${exchange.id}; first declared at ${pathIdentity(firstPath)}`
      });
    } else {
      seenExchangeIds.set(exchange.id, idPath);
    }
  });
  architecture.flows.forEach((flow, flowIndex) => {
    const seenOrders = /* @__PURE__ */ new Map();
    flow.exchanges.forEach((exchange, exchangeIndex) => {
      const firstIndex = seenOrders.get(exchange.order);
      if (firstIndex !== void 0) {
        addIssue({
          code: "duplicate_order",
          path: ["flows", flowIndex, "exchanges", exchangeIndex, "order"],
          message: `Duplicate exchange order ${exchange.order}; first declared at flows.${flowIndex}.exchanges.${firstIndex}.order`
        });
      } else {
        seenOrders.set(exchange.order, exchangeIndex);
      }
    });
  });
  architecture.components.forEach((component, index) => {
    registerIdentity(
      { specId: context.specId, kind: "component", id: component.id },
      ["components", index, "id"]
    );
  });
  architecture.contracts.forEach((contract, index) => {
    registerIdentity(
      { specId: context.specId, kind: "contract", id: contract.id },
      ["contracts", index, "id"]
    );
  });
  architecture.flows.forEach((flow, index) => {
    registerIdentity(
      { specId: context.specId, kind: "flow", id: flow.id },
      ["flows", index, "id"]
    );
  });
  context.localRefs.forEach((ref2, index) => registerIdentity(ref2, ["$localRefs", index]));
  context.resolvedRefs?.forEach((ref2, index) => registerIdentity(ref2, ["$resolvedRefs", index]));
  const dependencySpecIds = /* @__PURE__ */ new Map();
  architecture.specDependencies.forEach((dependency, index) => {
    const firstIndex = dependencySpecIds.get(dependency.specId);
    if (firstIndex !== void 0) {
      addIssue({
        code: "duplicate_qualified_identity",
        path: ["specDependencies", index, "specId"],
        message: `Duplicate Spec dependency target ${dependency.specId}; first declared at specDependencies.${firstIndex}.specId`
      });
    } else {
      dependencySpecIds.set(dependency.specId, index);
    }
  });
  const checkRef = (ref2, path5, expectedKind) => {
    if (expectedKind && ref2.kind !== expectedKind) {
      addIssue({
        code: "invalid_reference_kind",
        path: [...path5, "kind"],
        message: `Expected ${expectedKind} reference at ${pathIdentity(path5)}, received ${ref2.kind}`
      });
    }
    const identity = qualifiedRefIdentity(ref2);
    if (ref2.specId === context.specId) {
      if (!knownIdentities.has(identity)) {
        addIssue({
          code: "dangling_local_reference",
          path: path5,
          message: `Unknown local reference: ${identity}`
        });
      }
    } else if (!dependencySpecIds.has(ref2.specId)) {
      addIssue({
        code: "undeclared_spec_dependency",
        path: [...path5, "specId"],
        message: `Remote reference ${identity} has no declared Spec dependency for ${ref2.specId}`
      });
    }
  };
  architecture.components.forEach((component, componentIndex) => {
    component.featureIds.forEach((featureId, featureIndex) => {
      checkRef(
        { specId: context.specId, kind: "feature", id: featureId },
        ["components", componentIndex, "featureIds", featureIndex],
        "feature"
      );
    });
  });
  architecture.contracts.forEach((contract, contractIndex) => {
    checkRef(contract.provider, ["contracts", contractIndex, "provider"], "component");
    contract.consumers.forEach((consumer, consumerIndex) => {
      checkRef(consumer, ["contracts", contractIndex, "consumers", consumerIndex], "component");
    });
  });
  architecture.relationships.forEach((relationship, relationshipIndex) => {
    checkRef(relationship.from, ["relationships", relationshipIndex, "from"], "component");
    checkRef(relationship.to, ["relationships", relationshipIndex, "to"], "component");
    if (relationship.contractRef) {
      checkRef(relationship.contractRef, ["relationships", relationshipIndex, "contractRef"], "contract");
    }
  });
  architecture.flows.forEach((flow, flowIndex) => {
    flow.exchanges.forEach((exchange, exchangeIndex) => {
      const basePath = ["flows", flowIndex, "exchanges", exchangeIndex];
      checkRef(exchange.from, [...basePath, "from"], "component");
      checkRef(exchange.to, [...basePath, "to"], "component");
      checkRef(exchange.contractRef, [...basePath, "contractRef"], "contract");
      exchange.inputRefs.forEach((ref2, refIndex) => {
        checkRef(ref2, [...basePath, "inputRefs", refIndex]);
      });
      exchange.outputRefs.forEach((ref2, refIndex) => {
        checkRef(ref2, [...basePath, "outputRefs", refIndex]);
      });
    });
  });
  const hardCycle = findHardDependencyCycle(architecture.relationships);
  if (hardCycle) {
    addIssue({
      code: "hard_dependency_cycle",
      path: ["relationships", hardCycle.closingRelationshipIndex],
      message: `Hard dependency cycle: ${hardCycle.refs.map(qualifiedRefIdentity).join(" -> ")}`,
      referencePath: hardCycle.refs.map(copyRef)
    });
  }
  return issues.sort(compareIssues);
}
function findHardDependencyCycle(relationships) {
  const refsByIdentity = /* @__PURE__ */ new Map();
  const adjacency = /* @__PURE__ */ new Map();
  const addEdge = (from, to, relationshipIndex) => {
    if (from.kind !== "component" || to.kind !== "component") return;
    const fromIdentity = qualifiedRefIdentity(from);
    const toIdentity = qualifiedRefIdentity(to);
    refsByIdentity.set(fromIdentity, from);
    refsByIdentity.set(toIdentity, to);
    const edges = adjacency.get(fromIdentity) ?? [];
    edges.push({ to: toIdentity, relationshipIndex });
    adjacency.set(fromIdentity, edges);
  };
  relationships.forEach((relationship, relationshipIndex) => {
    if (relationship.criticality !== "hard") return;
    addEdge(relationship.from, relationship.to, relationshipIndex);
    if (relationship.direction === "bidirectional") {
      addEdge(relationship.to, relationship.from, relationshipIndex);
    }
  });
  adjacency.forEach((edges) => {
    edges.sort((left, right) => left.to.localeCompare(right.to) || left.relationshipIndex - right.relationshipIndex);
  });
  const state = /* @__PURE__ */ new Map();
  const stack = [];
  const visit = (identity) => {
    state.set(identity, "visiting");
    stack.push(identity);
    for (const edge of adjacency.get(identity) ?? []) {
      if (state.get(edge.to) === "visiting") {
        const cycleStart = stack.indexOf(edge.to);
        const cycleIdentities = [...stack.slice(cycleStart), edge.to];
        return {
          refs: cycleIdentities.map((entry) => copyRef(refsByIdentity.get(entry))),
          closingRelationshipIndex: edge.relationshipIndex
        };
      }
      if (state.get(edge.to) !== "visited") {
        const cycle = visit(edge.to);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(identity, "visited");
    return void 0;
  };
  const identities = [...refsByIdentity.keys()].sort();
  for (const identity of identities) {
    if (!state.has(identity)) {
      const cycle = visit(identity);
      if (cycle) return cycle;
    }
  }
  return void 0;
}

// engine/src/platform-topology.ts
var TopologyIdSchema = external_exports.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var PlatformSchema = external_exports.enum([
  "web",
  "vite-spa",
  "ios",
  "macos",
  "watchos",
  "tvos",
  "visionos",
  "android",
  "claude-plugin",
  "agent-system",
  "api",
  "service",
  "other"
]);
var PlatformSurfaceRoleSchema = external_exports.enum([
  "primary",
  "companion",
  "admin",
  "extension",
  "service"
]);
var PlatformSurfaceProvenanceSchema = external_exports.enum([
  "observed",
  "decided",
  "assumed",
  "derived"
]);
function addDuplicateStringIssues(values, ctx, field) {
  const seen = /* @__PURE__ */ new Set();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [field, index],
        message: `Duplicate ${field} value: ${value}`
      });
    }
    seen.add(value);
  });
}
var PlatformSurfaceSchema = external_exports.object({
  id: TopologyIdSchema,
  platform: PlatformSchema,
  role: PlatformSurfaceRoleSchema,
  name: external_exports.string().min(1),
  interactionModes: external_exports.array(external_exports.string().min(1)),
  featureIds: external_exports.array(TopologyIdSchema),
  provenance: PlatformSurfaceProvenanceSchema.optional()
}).strict().superRefine((surface, ctx) => {
  addDuplicateStringIssues(surface.interactionModes, ctx, "interactionModes");
  addDuplicateStringIssues(surface.featureIds, ctx, "featureIds");
});
var PlatformSurfacesSchema = external_exports.array(PlatformSurfaceSchema).min(1).superRefine((surfaces, ctx) => {
  const seenIds = /* @__PURE__ */ new Set();
  let primaryCount = 0;
  surfaces.forEach((surface, index) => {
    if (surface.role === "primary") primaryCount += 1;
    if (seenIds.has(surface.id)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [index, "id"],
        message: `Duplicate platform surface id: ${surface.id}`
      });
    }
    seenIds.add(surface.id);
  });
  if (primaryCount !== 1) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `Platform topology must contain exactly one primary surface; received ${primaryCount}.`
    });
  }
});
var PlatformTopologySchema = external_exports.object({
  platformTarget: PlatformSchema,
  platformSurfaces: PlatformSurfacesSchema
}).strict().superRefine((topology, ctx) => {
  const primary = topology.platformSurfaces.find((surface) => surface.role === "primary");
  if (primary && topology.platformTarget !== primary.platform) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["platformTarget"],
      message: `platformTarget must match primary platform ${primary.platform}.`
    });
  }
});
var LegacyPlatformChoiceSchema = external_exports.enum([
  "platform-web",
  "platform-ios",
  "platform-macos",
  "platform-multi"
]);

// engine/src/spec.ts
var IdSchema2 = external_exports.string().min(1);
var Priority = external_exports.enum(["P0", "P1", "P2", "P3"]).optional();
var Severity = external_exports.enum(["block", "warn", "info"]);
var Reversibility = external_exports.enum(["high", "medium", "low"]);
var EarsCriterionSchema = external_exports.object({
  id: IdSchema2,
  ears: external_exports.string()
  // "WHEN <trigger>, THE SYSTEM SHALL <response>."
});
var NfrSchema = external_exports.object({
  /** Test levels + what each proves, e.g. "unit for reducers, e2e for checkout". */
  testStrategy: external_exports.string().optional(),
  edgeCases: external_exports.array(external_exports.string()).default([]),
  errorHandling: external_exports.array(external_exports.string()).default([]),
  validation: external_exports.array(external_exports.string()).default([]),
  security: external_exports.array(external_exports.string()).default([]),
  accessibility: external_exports.array(external_exports.string()).default([])
});
var NeedSchema = external_exports.object({
  id: IdSchema2,
  title: external_exports.string(),
  description: external_exports.string().optional(),
  priority: Priority,
  source: external_exports.string().optional(),
  // intake question id or "inferred"
  // Groundwork: EARS-shaped acceptance criteria for this requirement.
  ears: external_exports.array(EarsCriterionSchema).optional(),
  // Groundwork: the pillar(s) this requirement serves. Empty means "not yet
  // traced to a pillar" — the trace builder reports that as a coverage gap
  // only when the Spec actually declares pillars.
  pillarIds: external_exports.array(IdSchema2).default([])
});
var FeatureSchema = external_exports.object({
  id: IdSchema2,
  title: external_exports.string(),
  description: external_exports.string().optional(),
  surface: external_exports.enum(["unspecified", "ui", "api", "tool", "command", "event", "headless"]).default("unspecified"),
  priority: Priority,
  needIds: external_exports.array(IdSchema2).default([]),
  acceptanceCriteria: external_exports.array(external_exports.string()).default([]),
  // Groundwork: EARS-shaped acceptance criteria for this feature.
  ears: external_exports.array(EarsCriterionSchema).optional(),
  // Groundwork: per-feature NFR override. When present its non-empty fields
  // land in this feature's task definition-of-done; when absent the feature
  // inherits the spec-level `nfr` posture.
  nfr: NfrSchema.optional(),
  ownedFiles: OwnedFilesSchema.optional()
});
var PersonaSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  trigger: external_exports.string().optional(),
  exclusions: external_exports.array(external_exports.string()).default([]),
  // "Who they are NOT"
  jobs: external_exports.array(external_exports.string()).default([])
});
var ScenarioSchema = external_exports.object({
  id: IdSchema2,
  personaId: IdSchema2.optional(),
  context: external_exports.string(),
  goal: external_exports.string(),
  successSignal: external_exports.string().optional()
});
var ElementDataInSchema = external_exports.object({
  source: external_exports.enum(["user-entry", "search", "computed", "fetched", "none"]),
  expectedType: external_exports.string().optional(),
  note: external_exports.string().optional()
});
var ElementDataOutSchema = external_exports.object({
  shows: external_exports.string().optional(),
  expectedType: external_exports.string().optional(),
  note: external_exports.string().optional()
});
var ScreenElementSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  role: external_exports.string().optional(),
  // Pointer-grade: what data this element needs / displays, not an
  // authoritative persistence or data-flow spec.
  dataIn: ElementDataInSchema.optional(),
  dataOut: ElementDataOutSchema.optional()
});
var ScreenSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  purpose: external_exports.string(),
  featureIds: external_exports.array(IdSchema2).default([]),
  primaryAction: external_exports.string().optional(),
  states: external_exports.array(external_exports.string()).default([]),
  // Groundwork: per-screen design-card fields the DESIGN.md 6-field card needs
  // (purpose/elements/data/states/interactions/rationale). Both optional so
  // screens authored before they landed still validate.
  // UI elements on the screen; `role` is a free-form affordance hint.
  elements: external_exports.array(ScreenElementSchema).optional(),
  // Data the screen reads/writes; `source` is a free-form origin hint
  // (e.g. a dataPoint id, an API path, "local", …).
  data: external_exports.array(external_exports.object({
    field: external_exports.string(),
    source: external_exports.string().optional()
  })).optional(),
  ownedFiles: OwnedFilesSchema.optional()
});
var UXFlowSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  steps: external_exports.array(external_exports.string()).default([]),
  screenIds: external_exports.array(IdSchema2).default([])
});
var DataPointSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  type: external_exports.string(),
  // free-form: "string", "uuid", "decimal(12,2)", etc.
  description: external_exports.string().optional(),
  pii: external_exports.boolean().default(false),
  // Required when pii=true. Linter treats missing handlingNote as a non-waivable
  // block. Schema does NOT enforce here; the linter is the surface that explains
  // the policy.
  handlingNote: external_exports.string().optional()
});
var DataModelFieldSchema = external_exports.object({
  name: external_exports.string(),
  type: external_exports.string().optional(),
  note: external_exports.string().optional()
});
var DataModelEntitySchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  description: external_exports.string().optional(),
  fields: external_exports.array(DataModelFieldSchema).default([]),
  readByFeatureIds: external_exports.array(IdSchema2).optional(),
  writtenByFeatureIds: external_exports.array(IdSchema2).optional(),
  // Free-form pointers into screen elements (e.g. "screen-today:Current streak
  // counter") rather than a strict IdSchema, since screen elements don't carry
  // their own stable id.
  elementRefs: external_exports.array(external_exports.string()).optional(),
  ownedFiles: external_exports.array(OwnedFileSchema).default([])
});
var SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
];
var SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|private[-_ ]?key|secret|credential|authorization)\b\s*(?:=|:|\bis\b)`,
  "i"
);
function containsCredentialBearingUrl(value) {
  const candidates = value.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g) ?? [];
  return candidates.some((candidate) => {
    const cleaned = candidate.replace(/[),.;!?]+$/, "");
    try {
      const url = new URL(cleaned);
      if (url.username || url.password) return true;
      return [...url.searchParams.keys()].some((key) => /(?:token|secret|password|passwd|api[-_]?key|credential|signature|access[-_]?key)/i.test(key));
    } catch {
      return false;
    }
  });
}
function externalManualActionSecretReason(value) {
  if (containsCredentialBearingUrl(value)) return "credential-bearing URL";
  if (SECRET_ASSIGNMENT_PATTERN.test(value)) return "credential assignment";
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return "secret-shaped value";
  return void 0;
}
var ExternalManualActionSchema = external_exports.object({
  id: IdSchema2,
  surface: external_exports.string().min(1),
  action: external_exports.string().min(1),
  // A name such as STRIPE_SECRET_KEY or "HealthKit read permission" — never
  // the credential/permission value itself.
  requiredValue: external_exports.string().min(1),
  appDestination: external_exports.string().min(1),
  verification: external_exports.string().min(1)
}).strict().superRefine((action, ctx) => {
  for (const field of ["id", "surface", "action", "requiredValue", "appDestination", "verification"]) {
    const reason = externalManualActionSecretReason(action[field]);
    if (reason) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [field],
        message: `External manual actions may name required values or permissions, but must not contain actual secrets (${reason}).`
      });
    }
  }
});
function validateExternalManualActionForPublication(value) {
  return ExternalManualActionSchema.parse(value);
}
var IntegrationSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  purpose: external_exports.string(),
  authMode: external_exports.string().optional(),
  docsUrl: external_exports.string().url().optional(),
  featureIds: external_exports.array(IdSchema2).default([]),
  ownedFiles: external_exports.array(OwnedFileSchema).default([]),
  requiredEnv: external_exports.array(external_exports.string()).default([]),
  codeSetup: external_exports.array(external_exports.string().min(1)).default([]),
  unclassifiedSetup: external_exports.array(external_exports.string().min(1)).default([]),
  externalManualActions: external_exports.array(ExternalManualActionSchema).default([]),
  verification: external_exports.array(external_exports.string().min(1)).min(1, "Every integration must declare at least one provider verification step.")
}).strict();
var APIContractSchema = external_exports.object({
  id: IdSchema2,
  method: external_exports.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: external_exports.string(),
  description: external_exports.string().optional(),
  requestSchema: external_exports.string().optional(),
  responseSchema: external_exports.string().optional(),
  featureIds: external_exports.array(IdSchema2).default([]),
  ownedFiles: external_exports.array(OwnedFileSchema).default([])
});
var TestSchema = external_exports.object({
  id: IdSchema2,
  description: external_exports.string(),
  dependsOnTestIds: external_exports.array(IdSchema2).default([]),
  needIds: external_exports.array(IdSchema2).default([]),
  featureIds: external_exports.array(IdSchema2).default([]),
  screenIds: external_exports.array(IdSchema2).default([]),
  // Optional pointer-grade coverage for an authored state on a screen.
  stateRefs: external_exports.array(ScreenStateRefSchema).default([]),
  integrationIds: external_exports.array(IdSchema2).default([]),
  platformSurfaceIds: external_exports.array(IdSchema2).default([]),
  ownedFiles: external_exports.array(OwnedFileSchema).default([]),
  kind: external_exports.enum(["acceptance", "smoke", "unit", "manual"]).default("acceptance"),
  // Free-form framework name. Linter pattern-matches per platformTarget:
  //   web|vite-spa  → /vitest|jest|playwright/i
  //   ios|macos     → /xctest|swift testing/i
  //   claude-plugin → /plugin-builder|manifest-validator|skill-validator|hook-validator|command-validator/i
  // Empty string → linter blocker (waivable).
  testFramework: external_exports.string().default(""),
  // Exact repository command when known. A production-ready handoff must not
  // substitute an unresolved scheme, destination, package, or script name.
  command: external_exports.string().min(1).optional(),
  // Optional validator references — used primarily by claude-plugin platform target where each
  // command/skill/hook artifact must point at a validator (manifest-validator, skill-validator, etc.).
  validatorRefs: external_exports.array(external_exports.string()).default([])
});
var DecisionRigiditySchema = external_exports.enum(["locked", "leaning", "open", "experimental", "superseded"]);
var ContractScopeSchema = external_exports.object({
  kind: external_exports.enum(["product", "screen", "element", "component", "behavior", "architecture"]),
  refs: external_exports.array(IdSchema2).min(1)
}).strict();
var JsonValueSchema = external_exports.lazy(() => external_exports.union([
  external_exports.string(),
  external_exports.number(),
  external_exports.boolean(),
  external_exports.null(),
  external_exports.array(JsonValueSchema),
  external_exports.record(external_exports.string(), JsonValueSchema)
]));
var PredicateSchema = external_exports.object({
  subjectRef: IdSchema2,
  propertyPath: external_exports.string().min(1),
  operator: external_exports.enum(["eq", "neq", "in", "not-in", "exists", "not-exists", "gte", "lte", "contains", "excludes"]),
  value: JsonValueSchema.optional()
}).strict();
var EffectSchema = external_exports.object({
  kind: external_exports.enum(["state-change", "create", "update", "delete", "schedule", "notify", "navigate", "none"]),
  targetRef: IdSchema2,
  propertyPath: external_exports.string().min(1).optional(),
  value: JsonValueSchema.optional()
}).strict();
var WriteSchema = external_exports.object({
  storeRef: IdSchema2,
  entity: external_exports.string().min(1),
  fields: external_exports.array(external_exports.string().min(1)).default([]),
  mode: external_exports.enum(["create", "update", "delete"])
}).strict();
var UserFeedbackSchema = external_exports.object({
  channel: external_exports.enum(["inline", "toast", "modal", "notification", "none"]),
  timing: external_exports.enum(["immediate", "deferred"]),
  message: external_exports.string().min(1).optional()
}).strict();
var FailureRecoverySchema = external_exports.object({
  failureCondition: PredicateSchema,
  strategy: external_exports.enum(["retry", "rollback", "resume", "manual", "none"]),
  toStateId: IdSchema2.optional(),
  guidance: external_exports.string().min(1)
}).strict();
var ConfirmationSchema = external_exports.object({
  required: external_exports.boolean(),
  when: PredicateSchema.optional(),
  message: external_exports.string().min(1).optional()
}).strict();
var BehaviorActionSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string().min(1),
  fromStateIds: external_exports.array(IdSchema2).default([]),
  toStateId: IdSchema2.optional(),
  effects: external_exports.array(EffectSchema).default([]),
  writes: external_exports.array(WriteSchema).default([]),
  prohibitedWrites: external_exports.array(WriteSchema).default([]),
  feedback: UserFeedbackSchema.optional(),
  failure: FailureRecoverySchema.optional(),
  recovery: FailureRecoverySchema.optional(),
  confirmation: ConfirmationSchema.optional()
}).strict();
var BehaviorStateSchema = external_exports.object({ id: IdSchema2, name: external_exports.string().min(1), visibleRefs: external_exports.array(IdSchema2).default([]) }).strict();
var BehaviorTransitionSchema = external_exports.object({ fromStateId: IdSchema2, actionId: IdSchema2, toStateId: IdSchema2 }).strict();
var InformationFlowSchema = external_exports.object({
  sourceRef: IdSchema2,
  targetRef: IdSchema2,
  data: external_exports.string().min(1),
  transform: external_exports.string().min(1).optional(),
  classification: external_exports.enum(["public", "local-private", "sensitive"]),
  persistence: external_exports.enum(["none", "session", "durable"])
}).strict();
var VerificationSchema = external_exports.object({
  id: IdSchema2,
  kind: external_exports.enum(["schema", "assertion", "hash", "snapshot", "ibr", "manual"]),
  targetRefs: external_exports.array(IdSchema2).default([]),
  method: external_exports.string().min(1),
  passCriteria: external_exports.array(PredicateSchema).default([])
}).strict();
var BehaviorContractSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string().min(1),
  scope: ContractScopeSchema,
  trigger: external_exports.string().min(1),
  preconditions: external_exports.array(PredicateSchema).default([]),
  states: external_exports.array(BehaviorStateSchema).default([]),
  actions: external_exports.array(BehaviorActionSchema).default([]),
  transitions: external_exports.array(BehaviorTransitionSchema).default([]),
  invariants: external_exports.array(external_exports.string().min(1)).default([]),
  informationFlow: external_exports.array(InformationFlowSchema).default([]),
  verificationRefs: external_exports.array(IdSchema2).default([])
}).strict();
var BaselineArtifactSchema = external_exports.object({
  id: IdSchema2,
  path: external_exports.string().min(1),
  type: external_exports.string().min(1),
  digest: external_exports.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();
var BaselinePrecedenceSchema = external_exports.object({ rank: external_exports.number().int().min(1), artifactId: IdSchema2 }).strict();
var DesignConstraintSchema = external_exports.object({
  id: IdSchema2,
  kind: external_exports.enum(["exact", "relational", "behavioral", "architectural"]),
  scope: ContractScopeSchema,
  targetRef: IdSchema2,
  propertyPath: external_exports.string().min(1),
  operator: PredicateSchema.shape.operator,
  value: JsonValueSchema.optional(),
  unit: external_exports.string().min(1).optional(),
  tolerance: external_exports.number().min(0).optional(),
  sourceArtifactId: IdSchema2.optional(),
  verificationRefs: external_exports.array(IdSchema2).default([])
}).strict();
var DesignDeltaSchema = external_exports.object({
  id: IdSchema2,
  baselineId: IdSchema2.optional(),
  targetRefs: external_exports.array(IdSchema2).min(1),
  operation: external_exports.enum(["add", "remove", "replace", "reorder", "preserve"]),
  before: JsonValueSchema.optional(),
  after: JsonValueSchema.optional(),
  direction: external_exports.string().min(1),
  verificationRefs: external_exports.array(IdSchema2).default([])
}).strict();
var DesignContractSchema = external_exports.object({
  intent: external_exports.object({
    type: external_exports.literal("conformance"),
    evidenceRefs: external_exports.array(IdSchema2).min(1),
    acceptanceTestRef: IdSchema2,
    verificationRefs: external_exports.array(IdSchema2).min(1)
  }).strict().optional(),
  baseline: external_exports.object({
    disposition: external_exports.enum(["observed", "declared", "not-applicable"]),
    id: IdSchema2.optional(),
    version: external_exports.string().min(1).optional(),
    status: DecisionRigiditySchema.optional(),
    scope: ContractScopeSchema.optional(),
    supersedes: IdSchema2.optional(),
    environment: external_exports.record(external_exports.string(), JsonValueSchema).default({}),
    artifacts: external_exports.array(BaselineArtifactSchema).default([]),
    precedence: external_exports.array(BaselinePrecedenceSchema).default([])
  }).strict(),
  constraints: external_exports.array(DesignConstraintSchema).default([]),
  direction: external_exports.object({ summary: external_exports.string().min(1), intentRefs: external_exports.array(IdSchema2).default([]), mustPreserve: external_exports.array(external_exports.string().min(1)).default([]), mayVary: external_exports.array(external_exports.string().min(1)).default([]) }).strict(),
  deltas: external_exports.array(DesignDeltaSchema).default([]),
  verification: external_exports.array(VerificationSchema).default([])
}).strict();
var ADRSchema = external_exports.object({
  id: IdSchema2,
  title: external_exports.string(),
  context: external_exports.string(),
  decision: external_exports.string(),
  consequences: external_exports.string().optional(),
  reversibility: Reversibility,
  // Cites tradeoff weights and stance "because" clauses.
  cites: external_exports.array(external_exports.string()).default([]),
  rigidity: DecisionRigiditySchema.optional(),
  scope: ContractScopeSchema.optional(),
  constraintRefs: external_exports.array(IdSchema2).optional(),
  mustPreserve: external_exports.array(external_exports.string().min(1)).optional(),
  mayVary: external_exports.array(external_exports.string().min(1)).optional(),
  changePolicy: external_exports.string().min(1).optional(),
  supersededBy: IdSchema2.optional()
});
var AssumptionSchema = external_exports.object({
  id: IdSchema2,
  text: external_exports.string(),
  confidence: external_exports.enum(["high", "medium", "low"]).default("medium")
});
var RiskSchema = external_exports.object({
  id: IdSchema2,
  text: external_exports.string(),
  likelihood: external_exports.enum(["high", "medium", "low"]).default("medium"),
  impact: external_exports.enum(["high", "medium", "low"]).default("medium"),
  mitigation: external_exports.string().optional()
});
var AgentArchitecturePatternSchema = external_exports.enum([
  "single-agent",
  "sequential",
  "router",
  "orchestrator-worker",
  "evaluator-optimizer",
  "interactive",
  "multi-agent",
  "hybrid"
]);
var AgentAutonomyLevelSchema = external_exports.enum([
  "draft-only",
  "human-in-loop",
  "supervised",
  "autonomous"
]);
var AgentBuilderScaleSchema = external_exports.enum(["skill", "plugin", "agent", "human"]);
var AgentToolPermissionTierSchema = external_exports.enum(["T0", "T1", "T2", "T3", "T4", "T5"]);
var AgentToolContractSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  purpose: external_exports.string(),
  permissionTier: AgentToolPermissionTierSchema.default("T1"),
  allowedActions: external_exports.array(external_exports.string()).default([]),
  forbiddenActions: external_exports.array(external_exports.string()).default([]),
  dataAccess: external_exports.string().optional(),
  sideEffects: external_exports.array(external_exports.string()).default([]),
  requiresHumanApproval: external_exports.boolean().default(false),
  auditLog: external_exports.string().optional(),
  rollbackPlan: external_exports.string().optional(),
  failureMode: external_exports.string().optional()
});
var AgentModelRouteSchema = external_exports.object({
  id: IdSchema2,
  purpose: external_exports.string(),
  provider: external_exports.string().optional(),
  modelTier: external_exports.string().optional(),
  promptContract: external_exports.string().optional()
});
var AgentGuardrailSchema = external_exports.object({
  id: IdSchema2,
  appliesTo: external_exports.array(external_exports.string()).default([]),
  trigger: external_exports.string(),
  check: external_exports.string(),
  action: external_exports.string(),
  severity: Severity.default("warn"),
  escalation: external_exports.string().optional()
});
var AgentEvaluationSchema = external_exports.object({
  id: IdSchema2,
  name: external_exports.string(),
  metric: external_exports.string(),
  coverageRefs: external_exports.array(IdSchema2).default([]),
  blocking: external_exports.boolean().default(false)
});
var AgentResearchProtocolSchema = external_exports.object({
  sourcePolicy: external_exports.string().optional(),
  evidenceStandard: external_exports.string().optional(),
  confidencePolicy: external_exports.string().optional(),
  citationRequired: external_exports.boolean().default(false),
  evidenceRefs: external_exports.array(external_exports.string()).default([]),
  openQuestions: external_exports.array(external_exports.string()).default([])
});
var AgentUiProtocolSchema = external_exports.object({
  archetype: external_exports.enum([
    "ai-agent-chat",
    "editor-workbench",
    "data-research-tool",
    "saas-dashboard",
    "internal-admin",
    "content-publication",
    "commerce-checkout"
  ]).optional(),
  designMode: external_exports.string().optional(),
  userResearchQuestions: external_exports.array(external_exports.string()).default([]),
  highRiskFailures: external_exports.array(external_exports.string()).default([])
});
var AgentSystemSchema = external_exports.object({
  mission: external_exports.string().optional(),
  systemBoundary: external_exports.object({
    inScope: external_exports.array(external_exports.string()).default([]),
    outOfScope: external_exports.array(external_exports.string()).default([])
  }).default({ inScope: [], outOfScope: [] }),
  builderScale: AgentBuilderScaleSchema.optional(),
  architecturePattern: AgentArchitecturePatternSchema.optional(),
  autonomyLevel: AgentAutonomyLevelSchema.optional(),
  stateOwner: external_exports.string().optional(),
  stopCondition: external_exports.string().optional(),
  modelRoutes: external_exports.array(AgentModelRouteSchema).default([]),
  toolContracts: external_exports.array(AgentToolContractSchema).default([]),
  memoryPolicy: external_exports.string().optional(),
  researchProtocol: AgentResearchProtocolSchema.optional(),
  uiProtocol: AgentUiProtocolSchema.optional(),
  guardrails: external_exports.array(AgentGuardrailSchema).default([]),
  evaluations: external_exports.array(AgentEvaluationSchema).default([]),
  humanCheckpoints: external_exports.array(external_exports.string()).default([]),
  traceabilityRefs: external_exports.array(external_exports.string()).default([])
});
var StanceBecauseClauseSchema = external_exports.object({
  id: IdSchema2,
  category: external_exports.enum(["privacy_data", "complexity", "cost", "category"]),
  stance: external_exports.string(),
  // "we will not store any user audio on our servers"
  because: external_exports.string()
  // "because this is healthcare-adjacent and trust is the moat"
});
var PivotLogEntrySchema = external_exports.object({
  id: IdSchema2,
  at: external_exports.string(),
  // ISO date
  summary: external_exports.string(),
  reason: external_exports.string().optional(),
  affects: external_exports.array(external_exports.string()).default([])
  // ids of needs/features the pivot touches
});
var TRADEOFF_AXES = [
  "speed_to_alpha",
  "scalability",
  "ux_polish",
  "maintainability",
  "cost",
  "security"
];
var TradeoffWeightsSchema = external_exports.object({
  speed_to_alpha: external_exports.number().int().min(0).max(100),
  scalability: external_exports.number().int().min(0).max(100),
  ux_polish: external_exports.number().int().min(0).max(100),
  maintainability: external_exports.number().int().min(0).max(100),
  cost: external_exports.number().int().min(0).max(100),
  security: external_exports.number().int().min(0).max(100),
  unacceptable_tradeoff: external_exports.enum(TRADEOFF_AXES)
}).refine(
  (w) => w.speed_to_alpha + w.scalability + w.ux_polish + w.maintainability + w.cost + w.security === 100,
  {
    message: "Tradeoff weights must sum to exactly 100 across the six axes.",
    path: ["__sum"]
  }
);
var ProductStateSchema = external_exports.object({
  version: external_exports.number().int().default(1),
  stanceBecauseClauses: external_exports.array(StanceBecauseClauseSchema).default([]),
  pivotLog: external_exports.array(PivotLogEntrySchema).default([]),
  tradeoffWeights: TradeoffWeightsSchema.optional(),
  workingMemory: external_exports.record(external_exports.string(), external_exports.any()).default({}),
  agentProfile: AgentSystemSchema.optional()
});
var NonGoalSchema = external_exports.object({
  id: IdSchema2,
  text: external_exports.string(),
  // Required by PRD-Builder: every non-goal carries a "because" clause.
  // Linter blocks empty `because` (waivable with reason).
  because: external_exports.string().default("")
});
var OpenQuestionKind = external_exports.enum(["text", "choice"]);
var OpenQuestionSchema = external_exports.object({
  topicId: external_exports.string().min(1),
  prompt: external_exports.string().min(1).max(500),
  stageId: external_exports.string().optional(),
  stageNumber: external_exports.number().int().optional(),
  answerKind: OpenQuestionKind.default("text"),
  answerChips: external_exports.array(external_exports.string().min(1).max(120)).max(8).optional(),
  feedsField: external_exports.string().optional(),
  answeredValue: external_exports.string().max(500).optional(),
  answeredAt: external_exports.string().optional()
});
var PlatformTargetSchema = external_exports.enum([
  "web",
  "vite-spa",
  "ios",
  "macos",
  "claude-plugin",
  "agent-system"
]);
var DesignIntentSchema = external_exports.enum(["iterate-ui", "design-app", "unspecified"]);
var ServiceLevelSchema = external_exports.object({
  metric: external_exports.string(),
  target: external_exports.string()
});
var ObservabilitySchema = external_exports.object({
  slis: external_exports.array(ServiceLevelSchema).default([]),
  slos: external_exports.array(ServiceLevelSchema).default([])
});
var BoundariesSchema = external_exports.object({
  always: external_exports.array(external_exports.string()).default([]),
  askFirst: external_exports.array(external_exports.string()).default([]),
  never: external_exports.array(external_exports.string()).default([])
});
var GoalSchema = external_exports.object({
  id: IdSchema2,
  statement: external_exports.string(),
  // Optional success metric paired with this goal.
  metric: external_exports.string().optional()
});
var SuccessMetricSchema = external_exports.object({
  id: IdSchema2,
  metric: external_exports.string(),
  target: external_exports.string()
});
var VoiceExampleSchema = external_exports.object({
  /** Where this copy appears, e.g. "empty state — no saved runs yet". */
  context: external_exports.string().min(1),
  /** The literal string to ship. */
  copy: external_exports.string().min(1)
});
var VoiceProfileSchema = external_exports.object({
  principles: external_exports.array(external_exports.string()).default([]),
  doWords: external_exports.array(external_exports.string()).default([]),
  dontWords: external_exports.array(external_exports.string()).default([]),
  examples: external_exports.array(VoiceExampleSchema).default([])
});
var PillarSchema = external_exports.object({
  id: IdSchema2,
  /** 1 = highest. Unique across the pillar list (enforced in superRefine). */
  rank: external_exports.number().int().min(1),
  statement: external_exports.string().min(1)
});
var AcceptanceTestSchema = external_exports.object({
  id: IdSchema2.default("acceptance-prime"),
  /** "A first-time user records a run and sees their streak update." */
  statement: external_exports.string().min(1),
  /** What an observer literally watches happen — no inference, no logs-only. */
  observable: external_exports.string().min(1),
  /** The clock bound, e.g. "within 3 minutes of first launch, no docs read". */
  timeBox: external_exports.string().min(1),
  steps: external_exports.array(external_exports.string()).default([]),
  pillarIds: external_exports.array(IdSchema2).default([])
});
var PhaseAcceptanceSchema = external_exports.object({
  phase: external_exports.string().min(1),
  scope: external_exports.string().min(1),
  /** Runnable: a command, not a wish. */
  acceptance: external_exports.string().min(1)
});
var HardConstraintSchema = external_exports.object({
  id: IdSchema2,
  /** Non-negotiable technical or product bound, e.g. "no server-side audio". */
  constraint: external_exports.string().min(1),
  because: external_exports.string().optional()
});
var PerformanceBudgetEntrySchema = external_exports.object({
  id: IdSchema2,
  metric: external_exports.string().min(1),
  /** The number and its percentile, e.g. "< 1.5s p95". */
  budget: external_exports.string().min(1),
  /** How the budget is measured — ideally a command. */
  measuredBy: external_exports.string().optional()
});
var ArchitecturalInvariantSchema = external_exports.object({
  id: IdSchema2,
  rule: external_exports.string().min(1),
  /** Executable: shell command, grep, or test id that fails when violated. */
  check: external_exports.string().min(1),
  pillarIds: external_exports.array(IdSchema2).default([])
});
var SpecCodeSyncSchema = external_exports.object({
  policy: external_exports.enum(["spec-first", "code-first", "bidirectional"]).default("spec-first"),
  specPath: external_exports.string().default("spec.json"),
  /** Command that regenerates the projections after a Spec edit. */
  regenerateCommand: external_exports.string().optional(),
  /** Changes that oblige a Spec update before the work is considered done. */
  triggers: external_exports.array(external_exports.string()).default([])
});
var ReadingContractSchema = external_exports.object({
  /** Model tier the set is written for, e.g. "frontier". */
  tier: external_exports.string().min(1).default("frontier"),
  /** What the reader is doing with it, e.g. "codegen", "review", "estimation". */
  context: external_exports.string().min(1).default("codegen"),
  /** Extra standing instructions rendered under the no-compression rule. */
  notes: external_exports.array(external_exports.string().min(1)).default([])
});
var EvidenceStatusSchema = external_exports.enum(["observed", "decided", "assumed"]);
var EvidenceRecordSchema = external_exports.object({
  id: IdSchema2,
  status: EvidenceStatusSchema,
  statement: external_exports.string().min(1),
  sourceRefs: external_exports.array(external_exports.string().min(1)).default([])
});
var RepoLayoutSchema = external_exports.object({
  /** Where the data model lives, e.g. "prisma/schema.prisma" or "src/db/schema.ts". */
  dataModel: external_exports.string().optional(),
  /**
   * Template for API route files. Must contain the literal token `{path}`,
   * e.g. "app/api/{path}/route.ts". When present without `{path}`, the
   * emitter appends the path segment rather than dropping it.
   */
  apiFilePattern: external_exports.string().optional(),
  integrationsDir: external_exports.string().optional(),
  featuresDir: external_exports.string().optional(),
  screensDir: external_exports.string().optional(),
  testsDir: external_exports.string().optional(),
  /** File suffix for generated test files, e.g. ".test.ts" or ".test.tsx". */
  testFileSuffix: external_exports.string().optional()
});
var BootstrapCommandsSchema = external_exports.object({
  install: external_exports.string().min(1),
  typecheck: external_exports.string().min(1),
  test: external_exports.string().min(1),
  build: external_exports.string().min(1)
}).strict();
var ProjectBootstrapSchema = external_exports.object({
  ownedFiles: external_exports.array(OwnedFileSchema).min(1),
  commands: BootstrapCommandsSchema
}).strict();
var ProjectContextSchema = external_exports.object({
  startingPoint: external_exports.enum([
    "unspecified",
    "initial-idea",
    "existing-definition",
    "existing-app"
  ]).default("unspecified"),
  sourceRepo: external_exports.string().optional(),
  sourceUrl: external_exports.string().url().optional(),
  sourceArtifacts: external_exports.array(external_exports.string().min(1)).default([]),
  inspectedAt: external_exports.string().optional(),
  evidence: external_exports.array(EvidenceRecordSchema).default([]),
  // Groundwork: observed repo layout (see RepoLayoutSchema doc comment).
  // Optional/additive so existing specs keep validating unchanged.
  repoLayout: RepoLayoutSchema.optional(),
  declaredNewFiles: external_exports.array(DeclaredNewFileSchema).min(1).optional(),
  bootstrap: ProjectBootstrapSchema.optional()
});
var ResponsiveTargetsSchema = external_exports.object({
  minimum: external_exports.string().optional(),
  maximum: external_exports.string().optional(),
  deviceClasses: external_exports.array(external_exports.string().min(1)).default([])
});
var UiPreferencesSchema = external_exports.object({
  informationDensity: external_exports.string().optional(),
  brandAdjectives: external_exports.array(external_exports.string().min(1)).default([]),
  accessibilityFloor: external_exports.array(external_exports.string().min(1)).default([]),
  responsiveTargets: ResponsiveTargetsSchema.optional(),
  mustKeep: external_exports.array(external_exports.string().min(1)).default([]),
  mustAvoid: external_exports.array(external_exports.string().min(1)).default([]),
  mayEvolve: external_exports.array(external_exports.string().min(1)).default([]),
  visualReferences: external_exports.array(external_exports.string().min(1)).default([])
});
var GovernanceSchema = external_exports.object({
  constraints: external_exports.array(external_exports.string().min(1)).default([]),
  decisions: external_exports.array(IdSchema2).default([]),
  owners: external_exports.array(external_exports.string().min(1)).default([])
}).strict();
var ChangeRecordSchema = external_exports.object({
  id: IdSchema2,
  target: QualifiedRefSchema,
  summary: external_exports.string().min(1),
  provenance: ProvenanceSchema,
  evidenceRefs: external_exports.array(IdSchema2).default([])
}).strict();
var ChangeSetSchema = external_exports.object({
  id: IdSchema2,
  current: external_exports.array(ChangeRecordSchema).default([]),
  proposed: external_exports.array(ChangeRecordSchema).default([]),
  verified: external_exports.array(ChangeRecordSchema).default([])
}).strict();
var SpecObjectSchema = external_exports.object({
  schemaVersion: external_exports.literal(3),
  id: IdSchema2,
  productName: external_exports.string(),
  productDescription: external_exports.string(),
  // Drives platform-specific lint rules. Defaults to 'web' so specs created
  // before the field existed continue to validate.
  platformTarget: PlatformTargetSchema.default("web"),
  platformSurfaces: PlatformSurfacesSchema,
  // Groundwork: design-intent depth switch (see DesignIntentSchema doc
  // comment). Placed at top level (not nested under projectContext) because
  // downstream flow docs read it as a cross-cutting mode switch, not
  // project-inspection metadata.
  designIntent: DesignIntentSchema.default("unspecified"),
  personas: external_exports.array(PersonaSchema).default([]),
  scenarios: external_exports.array(ScenarioSchema).default([]),
  needs: external_exports.array(NeedSchema).default([]),
  features: external_exports.array(FeatureSchema).default([]),
  uxFlows: external_exports.array(UXFlowSchema).default([]),
  screens: external_exports.array(ScreenSchema).default([]),
  dataPoints: external_exports.array(DataPointSchema).default([]),
  // Groundwork: pointer-grade entity layer (see DataModelEntitySchema doc
  // comment). Optional/additive.
  dataModel: external_exports.array(DataModelEntitySchema).default([]),
  integrations: external_exports.array(IntegrationSchema).default([]),
  apiContracts: external_exports.array(APIContractSchema).default([]),
  /** Optional behavior-first contract. Empty preserves every existing Spec v3 input. */
  behaviorContracts: external_exports.array(BehaviorContractSchema).optional(),
  tests: external_exports.array(TestSchema).default([]),
  adrs: external_exports.array(ADRSchema).default([]),
  assumptions: external_exports.array(AssumptionSchema).default([]),
  risks: external_exports.array(RiskSchema).default([]),
  nonGoals: external_exports.array(NonGoalSchema).default([]),
  agentSystem: AgentSystemSchema.optional(),
  // ── Groundwork extensions (all optional; existing specs stay valid) ──
  goals: external_exports.array(GoalSchema).optional(),
  successMetrics: external_exports.array(SuccessMetricSchema).optional(),
  observability: ObservabilitySchema.optional(),
  boundaries: BoundariesSchema.optional(),
  voiceProfile: VoiceProfileSchema.optional(),
  // ── Self-resolving-output extensions (all optional; see each schema's
  // doc comment for why the field exists and how absence renders) ──
  pillars: external_exports.array(PillarSchema).optional(),
  governingSentence: external_exports.string().optional(),
  acceptanceTest: AcceptanceTestSchema.optional(),
  phaseAcceptance: external_exports.array(PhaseAcceptanceSchema).optional(),
  hardConstraints: external_exports.array(HardConstraintSchema).optional(),
  performanceBudget: external_exports.array(PerformanceBudgetEntrySchema).optional(),
  architecturalInvariants: external_exports.array(ArchitecturalInvariantSchema).optional(),
  nfr: NfrSchema.optional(),
  specCodeSync: SpecCodeSyncSchema.optional(),
  readingContract: ReadingContractSchema.optional(),
  projectContext: ProjectContextSchema.default({ startingPoint: "unspecified" }),
  uiPreferences: UiPreferencesSchema.default({}),
  designContract: DesignContractSchema.optional(),
  architecture: ArchitectureSchema,
  governance: GovernanceSchema,
  changeSet: ChangeSetSchema
});
var ValidatedSpecObjectSchema = SpecObjectSchema.superRefine((spec, ctx) => {
  const declaredNew = spec.projectContext.declaredNewFiles ?? [];
  const declaredPaths = /* @__PURE__ */ new Set();
  declaredNew.forEach((entry, index) => {
    if (declaredPaths.has(entry.path)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["projectContext", "declaredNewFiles", index, "path"], message: `Duplicate declared-new file: ${entry.path}` });
    declaredPaths.add(entry.path);
  });
  const ownedPaths = /* @__PURE__ */ new Set([
    ...spec.projectContext.bootstrap?.ownedFiles ?? [],
    ...spec.features.flatMap((item) => item.ownedFiles ?? []),
    ...spec.screens.flatMap((item) => item.ownedFiles ?? []),
    ...spec.integrations.flatMap((item) => item.ownedFiles),
    ...spec.apiContracts.flatMap((item) => item.ownedFiles),
    ...spec.tests.flatMap((item) => item.ownedFiles),
    ...spec.dataModel.flatMap((item) => item.ownedFiles),
    ...spec.architecture.components.flatMap((item) => item.ownedFiles ?? []),
    ...spec.architecture.contracts.flatMap((item) => item.ownedFiles ?? [])
  ]);
  declaredNew.forEach((entry, index) => {
    if (!ownedPaths.has(entry.path)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["projectContext", "declaredNewFiles", index, "path"], message: `Declared-new file is not owned by any entity: ${entry.path}` });
  });
  const ids = {
    persona: new Set(spec.personas.map((item) => item.id)),
    need: new Set(spec.needs.map((item) => item.id)),
    feature: new Set(spec.features.map((item) => item.id)),
    screen: new Set(spec.screens.map((item) => item.id)),
    integration: new Set(spec.integrations.map((item) => item.id)),
    pillar: new Set((spec.pillars ?? []).map((item) => item.id)),
    test: new Set(spec.tests.map((item) => item.id)),
    platformSurface: new Set(spec.platformSurfaces.map((item) => item.id)),
    adr: new Set(spec.adrs.map((item) => item.id)),
    behavior: new Set((spec.behaviorContracts ?? []).map((item) => item.id))
  };
  const check = (values, valid, path5, kind) => {
    values.forEach((value, index) => {
      if (!valid.has(value)) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: [...path5, index],
          message: `Unknown ${kind} reference: ${value}`
        });
      }
    });
  };
  const screenStates = new Map(spec.screens.map((screen) => [screen.id, new Set(screen.states)]));
  const checkStateRefs = (refs, path5) => {
    refs.forEach((ref2, index) => {
      const states = screenStates.get(ref2.screenId);
      if (!states) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: [...path5, index, "screenId"],
          message: `Unknown screen reference: ${ref2.screenId}`
        });
      } else if (!states.has(ref2.state)) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: [...path5, index, "state"],
          message: `Unknown state ${ref2.state} on screen ${ref2.screenId}`
        });
      }
    });
  };
  spec.scenarios.forEach((item, index) => {
    if (item.personaId) check([item.personaId], ids.persona, ["scenarios", index, "personaId"], "persona");
  });
  spec.features.forEach((item, index) => check(item.needIds, ids.need, ["features", index, "needIds"], "need"));
  spec.screens.forEach((item, index) => check(item.featureIds, ids.feature, ["screens", index, "featureIds"], "feature"));
  spec.uxFlows.forEach((item, index) => check(item.screenIds, ids.screen, ["uxFlows", index, "screenIds"], "screen"));
  spec.integrations.forEach((item, index) => check(item.featureIds, ids.feature, ["integrations", index, "featureIds"], "feature"));
  spec.apiContracts.forEach((item, index) => check(item.featureIds, ids.feature, ["apiContracts", index, "featureIds"], "feature"));
  spec.tests.forEach((item, index) => {
    check(item.dependsOnTestIds, ids.test, ["tests", index, "dependsOnTestIds"], "test");
    item.dependsOnTestIds.forEach((testId, dependencyIndex) => {
      if (testId === item.id) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["tests", index, "dependsOnTestIds", dependencyIndex],
          message: `Test ${item.id} cannot depend on itself.`
        });
      }
    });
    check(item.needIds, ids.need, ["tests", index, "needIds"], "need");
    check(item.featureIds, ids.feature, ["tests", index, "featureIds"], "feature");
    check(item.screenIds, ids.screen, ["tests", index, "screenIds"], "screen");
    checkStateRefs(item.stateRefs, ["tests", index, "stateRefs"]);
    check(item.integrationIds, ids.integration, ["tests", index, "integrationIds"], "integration");
    check(item.platformSurfaceIds, ids.platformSurface, ["tests", index, "platformSurfaceIds"], "platform surface");
  });
  spec.dataModel.forEach((item, index) => {
    if (item.readByFeatureIds) check(item.readByFeatureIds, ids.feature, ["dataModel", index, "readByFeatureIds"], "feature");
    if (item.writtenByFeatureIds) check(item.writtenByFeatureIds, ids.feature, ["dataModel", index, "writtenByFeatureIds"], "feature");
  });
  spec.needs.forEach((item, index) => check(item.pillarIds, ids.pillar, ["needs", index, "pillarIds"], "pillar"));
  (spec.architecturalInvariants ?? []).forEach(
    (item, index) => check(item.pillarIds, ids.pillar, ["architecturalInvariants", index, "pillarIds"], "pillar")
  );
  if (spec.acceptanceTest) {
    check(spec.acceptanceTest.pillarIds, ids.pillar, ["acceptanceTest", "pillarIds"], "pillar");
  }
  const seenRanks = /* @__PURE__ */ new Map();
  (spec.pillars ?? []).forEach((pillar, index) => {
    const prior = seenRanks.get(pillar.rank);
    if (prior) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["pillars", index, "rank"],
        message: `Duplicate pillar rank ${pillar.rank} (already used by ${prior}). Ranks must be unique.`
      });
    } else {
      seenRanks.set(pillar.rank, pillar.id);
    }
  });
  spec.platformSurfaces.forEach((surface, surfaceIndex) => {
    check(surface.featureIds, ids.feature, ["platformSurfaces", surfaceIndex, "featureIds"], "feature");
  });
  check(spec.governance.decisions, ids.adr, ["governance", "decisions"], "ADR");
  const elementIds = new Set(spec.screens.flatMap((screen) => (screen.elements ?? []).map((element) => element.id)));
  const componentIds = new Set(spec.architecture.components.map((item) => item.id));
  const behaviorStateIds = new Set((spec.behaviorContracts ?? []).flatMap((contract) => contract.states.map((state) => state.id)));
  const behaviorActionIds = new Set((spec.behaviorContracts ?? []).flatMap((contract) => contract.actions.map((action) => action.id)));
  const referenceIds = /* @__PURE__ */ new Set([
    spec.id,
    ...ids.persona,
    ...ids.need,
    ...ids.feature,
    ...ids.screen,
    ...ids.integration,
    ...ids.test,
    ...ids.adr,
    ...ids.behavior,
    ...elementIds,
    ...componentIds,
    ...behaviorStateIds,
    ...behaviorActionIds,
    ...spec.dataModel.map((item) => item.id),
    ...spec.architecture.contracts.map((item) => item.id),
    ...spec.architecture.flows.map((item) => item.id)
  ]);
  const idsByScopeKind = {
    product: /* @__PURE__ */ new Set([spec.id]),
    screen: ids.screen,
    element: elementIds,
    component: componentIds,
    behavior: ids.behavior,
    architecture: componentIds
  };
  const validateScope = (scope, path5, label) => {
    check(scope.refs, idsByScopeKind[scope.kind], [...path5, "refs"], `${label} ${scope.kind}`);
  };
  const scopesIntersect = (left, right) => left.kind === "product" || right.kind === "product" ? left.kind === right.kind && left.refs.some((ref2) => right.refs.includes(ref2)) : left.kind === right.kind && left.refs.some((ref2) => right.refs.includes(ref2));
  const decisionByIdAlways = new Map(spec.adrs.map((adr) => [adr.id, adr]));
  spec.adrs.forEach((adr, index) => {
    if (adr.rigidity === "superseded") {
      if (!adr.supersededBy || adr.supersededBy === adr.id || !decisionByIdAlways.has(adr.supersededBy)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "A superseded ADR requires an existing non-self supersededBy ADR." });
    } else if (adr.supersededBy) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "Only a superseded ADR may declare supersededBy." });
    if (adr.scope) validateScope(adr.scope, ["adrs", index, "scope"], "ADR scope");
    if (adr.rigidity === "locked" && !spec.designContract) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "constraintRefs"], message: "A locked ADR requires a designContract with an enforceable scoped constraint." });
    const seen = /* @__PURE__ */ new Set([adr.id]);
    let next = adr.supersededBy;
    while (next) {
      if (seen.has(next)) {
        ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "ADR supersession graph contains a cycle." });
        break;
      }
      seen.add(next);
      next = decisionByIdAlways.get(next)?.supersededBy;
    }
  });
  const design2 = spec.designContract;
  if (design2) {
    const rejectDuplicateIds = (items, path5, label) => {
      const seen = /* @__PURE__ */ new Set();
      items.forEach((item, index) => {
        if (seen.has(item.id)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: [...path5, index, "id"], message: `Duplicate ${label} id: ${item.id}` });
        seen.add(item.id);
      });
    };
    rejectDuplicateIds(design2.baseline.artifacts, ["designContract", "baseline", "artifacts"], "baseline artifact");
    rejectDuplicateIds(spec.projectContext.evidence, ["projectContext", "evidence"], "evidence");
    rejectDuplicateIds(design2.verification, ["designContract", "verification"], "verification");
    rejectDuplicateIds(design2.constraints, ["designContract", "constraints"], "constraint");
    const verificationIds = new Set(design2.verification.map((item) => item.id));
    const constraintIds = new Set(design2.constraints.map((item) => item.id));
    const artifactIds = new Set(design2.baseline.artifacts.map((item) => item.id));
    const checkKnown = (values, valid, path5, label) => check(values, valid, path5, label);
    design2.verification.forEach((item, index) => {
      checkKnown(item.targetRefs, referenceIds, ["designContract", "verification", index, "targetRefs"], "verification target");
      item.passCriteria.forEach((predicate, predicateIndex) => checkKnown([predicate.subjectRef], referenceIds, ["designContract", "verification", index, "passCriteria", predicateIndex, "subjectRef"], "predicate subject"));
    });
    design2.constraints.forEach((item, index) => {
      validateScope(item.scope, ["designContract", "constraints", index, "scope"], "constraint scope");
      checkKnown([item.targetRef], referenceIds, ["designContract", "constraints", index, "targetRef"], "constraint target");
      checkKnown(item.verificationRefs, verificationIds, ["designContract", "constraints", index, "verificationRefs"], "verification");
      if (item.kind === "exact" && (!item.sourceArtifactId || !item.verificationRefs.length)) {
        ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "constraints", index], message: "Exact constraints require sourceArtifactId and verificationRefs." });
      }
      if (item.sourceArtifactId) checkKnown([item.sourceArtifactId], artifactIds, ["designContract", "constraints", index, "sourceArtifactId"], "baseline artifact");
      const compatible = item.kind === "architectural" ? ["architecture", "component", "product"].includes(item.scope.kind) : item.kind === "behavioral" ? ["behavior", "screen", "element", "product"].includes(item.scope.kind) : true;
      if (!compatible) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "constraints", index, "kind"], message: `${item.kind} constraint is incompatible with ${item.scope.kind} scope.` });
    });
    const baseline = design2.baseline;
    const conformance = design2.intent?.type === "conformance";
    const requiresBaseline = baseline.disposition === "observed" || baseline.disposition === "declared";
    if (requiresBaseline && (!baseline.id || !baseline.artifacts.length || !baseline.precedence.length)) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "baseline"], message: "Observed or declared baselines require id, artifacts, and precedence." });
    }
    if (requiresBaseline && !conformance && !design2.deltas.length) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "deltas"], message: "A change design contract requires at least one linked delta." });
    }
    if (conformance) {
      if (!requiresBaseline) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "baseline", "disposition"], message: "A conformance design contract requires an observed or declared baseline." });
      if (design2.deltas.length) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "deltas"], message: "A conformance design contract forbids proposed deltas." });
      if (spec.changeSet.proposed.length) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["changeSet", "proposed"], message: "A conformance design contract requires an empty proposed change set." });
      if (!design2.constraints.length) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "constraints"], message: "A conformance design contract requires evidence-backed constraints." });
      if (!design2.verification.length) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "verification"], message: "A conformance design contract requires verification with acceptance predicates." });
      const evidenceById = new Map(spec.projectContext.evidence.map((item) => [item.id, item]));
      const evidenceRefs = design2.intent.evidenceRefs;
      if (new Set(evidenceRefs).size !== evidenceRefs.length) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "intent", "evidenceRefs"], message: "Conformance evidenceRefs must be unique." });
      evidenceRefs.forEach((ref2, index) => {
        const evidence = evidenceById.get(ref2);
        const allowedStatuses = baseline.disposition === "observed" ? ["observed"] : ["observed", "decided"];
        if (!evidence) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "intent", "evidenceRefs", index], message: `Unknown conformance evidence reference: ${ref2}` });
        else if (!evidence.sourceRefs.length || !allowedStatuses.includes(evidence.status)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "intent", "evidenceRefs", index], message: `Conformance evidence ${ref2} must be source-backed with status ${allowedStatuses.join(" or ")}.` });
      });
      if (!spec.acceptanceTest || design2.intent.acceptanceTestRef !== spec.acceptanceTest.id || !spec.acceptanceTest.steps.some((step) => step.trim().length > 0)) {
        ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "intent", "acceptanceTestRef"], message: "Conformance requires the canonical acceptanceTest with at least one executable step." });
      }
      const verificationRefs = design2.intent.verificationRefs;
      if (new Set(verificationRefs).size !== verificationRefs.length) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "intent", "verificationRefs"], message: "Conformance verificationRefs must be unique." });
      const verificationById = new Map(design2.verification.map((item) => [item.id, item]));
      verificationRefs.forEach((ref2, index) => {
        const verification = verificationById.get(ref2);
        if (!verification) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "intent", "verificationRefs", index], message: `Unknown conformance verification reference: ${ref2}` });
        else if (!verification.targetRefs.length || !verification.passCriteria.length) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "intent", "verificationRefs", index], message: `Conformance verification ${ref2} requires targetRefs and acceptance predicates.` });
      });
      design2.constraints.forEach((item, index) => {
        if (!item.sourceArtifactId || !item.verificationRefs.length) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "constraints", index], message: "Conformance constraints require sourceArtifactId and verificationRefs." });
        if (!item.verificationRefs.some((ref2) => verificationRefs.includes(ref2))) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "constraints", index, "verificationRefs"], message: "Conformance constraints must cite a substantive intent verification." });
      });
    }
    if (baseline.disposition === "not-applicable" && (baseline.id || baseline.artifacts.length || baseline.precedence.length)) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "baseline"], message: "A not-applicable baseline cannot declare identity, artifacts, or precedence." });
    }
    if (baseline.scope) validateScope(baseline.scope, ["designContract", "baseline", "scope"], "baseline scope");
    const artifactPaths = /* @__PURE__ */ new Map();
    baseline.artifacts.forEach((artifact, index) => {
      const segments = artifact.path.split(/[\\/]+/);
      if (/[*?[\]{}]/.test(artifact.path) || artifact.path.startsWith("/") || segments.includes("..")) {
        ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "baseline", "artifacts", index, "path"], message: "Baseline artifact paths must be exact relative paths without globs or parent traversal." });
      }
      const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
      for (const [prior, priorIndex] of artifactPaths) {
        if (normalized === prior || normalized.startsWith(`${prior}/`) || prior.startsWith(`${normalized}/`)) {
          ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "baseline", "artifacts", index, "path"], message: `Baseline artifact path overlaps artifact at index ${priorIndex}; precedence would be ambiguous.` });
        }
      }
      artifactPaths.set(normalized, index);
    });
    const ranks = /* @__PURE__ */ new Set();
    baseline.precedence.forEach((item, index) => {
      if (ranks.has(item.rank)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "baseline", "precedence", index, "rank"], message: `Duplicate precedence rank ${item.rank}.` });
      ranks.add(item.rank);
      checkKnown([item.artifactId], artifactIds, ["designContract", "baseline", "precedence", index, "artifactId"], "baseline artifact");
    });
    design2.deltas.forEach((item, index) => {
      if (requiresBaseline && item.baselineId !== baseline.id) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "deltas", index, "baselineId"], message: "A delta for an observed or declared baseline must identify that baseline." });
      if (!requiresBaseline && item.baselineId) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["designContract", "deltas", index, "baselineId"], message: "A not-applicable baseline forbids a baseline-linked delta." });
      checkKnown(item.targetRefs, referenceIds, ["designContract", "deltas", index, "targetRefs"], "delta target");
      checkKnown(item.verificationRefs, verificationIds, ["designContract", "deltas", index, "verificationRefs"], "verification");
    });
    const decisionById = new Map(spec.adrs.map((adr) => [adr.id, adr]));
    spec.adrs.forEach((adr, index) => {
      if (adr.rigidity === "superseded") {
        if (!adr.supersededBy || adr.supersededBy === adr.id || !decisionById.has(adr.supersededBy)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "A superseded ADR requires an existing non-self supersededBy ADR." });
      } else if (adr.supersededBy) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "Only a superseded ADR may declare supersededBy." });
      const constraintRefs = adr.constraintRefs ?? [];
      if (adr.rigidity === "locked") {
        const enforceable = Boolean(adr.scope) && constraintRefs.some((id) => design2.constraints.some((constraint) => constraint.id === id && scopesIntersect(adr.scope, constraint.scope)));
        if (!enforceable) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "constraintRefs"], message: "A locked ADR requires an enforceable scoped constraint, including a relational constraint when its scope matches." });
      }
      checkKnown(constraintRefs, constraintIds, ["adrs", index, "constraintRefs"], "constraint");
      if (adr.scope) {
        validateScope(adr.scope, ["adrs", index, "scope"], "ADR scope");
        constraintRefs.forEach((id, constraintIndex) => {
          const constraint = design2.constraints.find((candidate) => candidate.id === id);
          if (constraint && !scopesIntersect(adr.scope, constraint.scope)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "constraintRefs", constraintIndex], message: `ADR scope does not intersect constraint ${id} scope.` });
        });
      }
    });
    const decisionIndex = new Map(spec.adrs.map((adr, index) => [adr.id, index]));
    spec.adrs.forEach((adr, index) => {
      const seen = /* @__PURE__ */ new Set([adr.id]);
      let next = adr.supersededBy;
      while (next) {
        if (seen.has(next)) {
          ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "ADR supersession graph contains a cycle." });
          break;
        }
        seen.add(next);
        const nextIndex = decisionIndex.get(next);
        next = nextIndex === void 0 ? void 0 : spec.adrs[nextIndex]?.supersededBy;
      }
    });
    const lockedConstraints = spec.adrs.filter((adr) => adr.rigidity === "locked").flatMap((adr) => (adr.constraintRefs ?? []).map((id) => ({ adr, constraint: design2.constraints.find((item) => item.id === id) })).filter((item) => Boolean(item.constraint)));
    const pathsOverlap = (left, right) => left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
    const conflicts = (left, right) => {
      if (left.operator === "eq" && right.operator === "eq") return JSON.stringify(left.value) !== JSON.stringify(right.value);
      if (left.operator === "exists" && right.operator === "not-exists" || left.operator === "not-exists" && right.operator === "exists") return true;
      if ((left.operator === "contains" && right.operator === "excludes" || left.operator === "excludes" && right.operator === "contains") && JSON.stringify(left.value) === JSON.stringify(right.value)) return true;
      if (typeof left.value === "number" && typeof right.value === "number") {
        if (left.operator === "gte" && right.operator === "lte") return left.value > right.value;
        if (left.operator === "lte" && right.operator === "gte") return right.value > left.value;
        if (left.operator === "eq" && right.operator === "gte") return left.value < right.value;
        if (left.operator === "eq" && right.operator === "lte") return left.value > right.value;
        if (right.operator === "eq" && left.operator === "gte") return right.value < left.value;
        if (right.operator === "eq" && left.operator === "lte") return right.value > left.value;
      }
      return false;
    };
    lockedConstraints.forEach((left, leftIndex) => lockedConstraints.slice(leftIndex + 1).forEach((right) => {
      if (left.constraint.id === right.constraint.id || left.constraint.targetRef !== right.constraint.targetRef) return;
      if (!scopesIntersect(left.constraint.scope, right.constraint.scope) || !pathsOverlap(left.constraint.propertyPath, right.constraint.propertyPath)) return;
      if (conflicts(left.constraint, right.constraint)) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["adrs", decisionIndex.get(right.adr.id) ?? 0, "constraintRefs"], message: `Locked constraints ${left.constraint.id} and ${right.constraint.id} conflict.` });
    }));
  }
  const behaviorVerificationIds = new Set(design2?.verification.map((item) => item.id) ?? []);
  (spec.behaviorContracts ?? []).forEach((contract, contractIndex) => {
    validateScope(contract.scope, ["behaviorContracts", contractIndex, "scope"], "behavior scope");
    check(contract.verificationRefs, behaviorVerificationIds, ["behaviorContracts", contractIndex, "verificationRefs"], "verification");
    const stateIds = new Set(contract.states.map((state) => state.id));
    const actionIds = new Set(contract.actions.map((action) => action.id));
    const checkPredicate = (predicate, path5) => check([predicate.subjectRef], referenceIds, [...path5, "subjectRef"], "predicate subject");
    contract.preconditions.forEach((predicate, index) => checkPredicate(predicate, ["behaviorContracts", contractIndex, "preconditions", index]));
    contract.states.forEach((state, stateIndex) => check(state.visibleRefs, referenceIds, ["behaviorContracts", contractIndex, "states", stateIndex, "visibleRefs"], "visible"));
    const writeIdentity = (write) => `${write.storeRef}:${write.entity}:${write.mode}:${write.fields.slice().sort().join(",")}`;
    contract.actions.forEach((action, actionIndex) => {
      check(action.fromStateIds, stateIds, ["behaviorContracts", contractIndex, "actions", actionIndex, "fromStateIds"], "behavior state");
      if (action.toStateId) check([action.toStateId], stateIds, ["behaviorContracts", contractIndex, "actions", actionIndex, "toStateId"], "behavior state");
      const prohibited = new Set(action.prohibitedWrites.map(writeIdentity));
      action.writes.forEach((write, writeIndex) => {
        if (prohibited.has(writeIdentity(write))) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["behaviorContracts", contractIndex, "actions", actionIndex, "writes", writeIndex], message: "An action cannot both write and prohibit the same normalized write." });
      });
      action.effects.forEach((effect, effectIndex) => check([effect.targetRef], referenceIds, ["behaviorContracts", contractIndex, "actions", actionIndex, "effects", effectIndex, "targetRef"], "effect target"));
      for (const [field, recovery] of [["failure", action.failure], ["recovery", action.recovery]]) {
        if (!recovery) continue;
        checkPredicate(recovery.failureCondition, ["behaviorContracts", contractIndex, "actions", actionIndex, field, "failureCondition"]);
        if (recovery.toStateId) check([recovery.toStateId], stateIds, ["behaviorContracts", contractIndex, "actions", actionIndex, field, "toStateId"], "behavior state");
      }
      if (action.confirmation?.when) checkPredicate(action.confirmation.when, ["behaviorContracts", contractIndex, "actions", actionIndex, "confirmation", "when"]);
    });
    contract.transitions.forEach((transition, transitionIndex) => {
      check([transition.fromStateId, transition.toStateId], stateIds, ["behaviorContracts", contractIndex, "transitions", transitionIndex], "behavior state");
      check([transition.actionId], actionIds, ["behaviorContracts", contractIndex, "transitions", transitionIndex, "actionId"], "behavior action");
    });
    contract.informationFlow.forEach((flow, flowIndex) => {
      check([flow.sourceRef], referenceIds, ["behaviorContracts", contractIndex, "informationFlow", flowIndex, "sourceRef"], "information-flow source");
      check([flow.targetRef], referenceIds, ["behaviorContracts", contractIndex, "informationFlow", flowIndex, "targetRef"], "information-flow target");
    });
  });
  const topologyResult = PlatformTopologySchema.safeParse({
    platformTarget: spec.platformTarget,
    platformSurfaces: spec.platformSurfaces
  });
  if (!topologyResult.success) {
    topologyResult.error.issues.forEach((issue) => {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: issue.path,
        message: issue.message
      });
    });
  }
  const localRefs = [
    ...spec.needs.map((item) => ({ specId: spec.id, kind: "requirement", id: item.id })),
    ...spec.features.map((item) => ({ specId: spec.id, kind: "feature", id: item.id })),
    ...spec.screens.flatMap((screen) => [
      { specId: spec.id, kind: "screen", id: screen.id },
      ...(screen.elements ?? []).map((element) => ({
        specId: spec.id,
        kind: "element",
        id: element.id
      }))
    ])
  ];
  validateArchitecture(spec.architecture, { specId: spec.id, localRefs }).forEach((issue) => {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["architecture", ...issue.path],
      message: issue.message
    });
  });
  spec.architecture.flows.forEach((flow, flowIndex) => {
    flow.exchanges.forEach((exchange, exchangeIndex) => {
      checkStateRefs(
        exchange.stateRefs,
        ["architecture", "flows", flowIndex, "exchanges", exchangeIndex, "stateRefs"]
      );
    });
  });
  const localIdentity = new Set(localRefs.map((ref2) => `${ref2.specId}:${ref2.kind}:${ref2.id}`));
  spec.architecture.components.forEach((item) => localIdentity.add(`${spec.id}:component:${item.id}`));
  spec.architecture.contracts.forEach((item) => localIdentity.add(`${spec.id}:contract:${item.id}`));
  spec.architecture.flows.forEach((item) => localIdentity.add(`${spec.id}:flow:${item.id}`));
  const dependencySpecIds = new Set(spec.architecture.specDependencies.map((item) => item.specId));
  ["current", "proposed", "verified"].forEach((bucket) => {
    spec.changeSet[bucket].forEach((record2, index) => {
      const identity = `${record2.target.specId}:${record2.target.kind}:${record2.target.id}`;
      const targetIsKnown = record2.target.specId === spec.id ? localIdentity.has(identity) : dependencySpecIds.has(record2.target.specId);
      if (!targetIsKnown) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["changeSet", bucket, index, "target"],
          message: `Unknown change target: ${identity}`
        });
      }
    });
  });
  const seenChangeRecordIds = /* @__PURE__ */ new Map();
  ["current", "proposed", "verified"].forEach((bucket) => {
    spec.changeSet[bucket].forEach((record2, index) => {
      const firstPath = seenChangeRecordIds.get(record2.id);
      if (firstPath) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["changeSet", bucket, index, "id"],
          message: `Duplicate change record ID ${record2.id}; first declared at ${firstPath}`
        });
      } else {
        seenChangeRecordIds.set(record2.id, `changeSet.${bucket}.${index}.id`);
      }
    });
  });
});
function slugIdPart(value, fallback) {
  const slug3 = String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug3 || fallback;
}
function migratedScreenElements(rawScreens) {
  if (!Array.isArray(rawScreens)) return rawScreens;
  const used = /* @__PURE__ */ new Set();
  rawScreens.forEach((screen) => {
    if (!screen || typeof screen !== "object" || Array.isArray(screen)) return;
    const elements = screen.elements;
    if (!Array.isArray(elements)) return;
    elements.forEach((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) return;
      const id = element.id;
      if (typeof id === "string" && id.trim()) used.add(id);
    });
  });
  return rawScreens.map((screen, screenIndex) => {
    if (!screen || typeof screen !== "object" || Array.isArray(screen)) return screen;
    const rawScreen = screen;
    if (!Array.isArray(rawScreen.elements)) return screen;
    const screenPart = slugIdPart(rawScreen.id, `screen-${screenIndex + 1}`);
    const elements = rawScreen.elements.map((element, elementIndex) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) return element;
      const rawElement = element;
      const existingId = typeof rawElement.id === "string" && rawElement.id.trim() ? rawElement.id : void 0;
      if (existingId) return { ...rawElement, id: existingId };
      const base = `element-${screenPart}-${slugIdPart(rawElement.name, String(elementIndex + 1))}`;
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }
      used.add(id);
      return { ...rawElement, id };
    });
    return { ...rawScreen, elements };
  });
}
function migratedPrimarySurface(platformTarget) {
  return {
    id: `surface-${slugIdPart(platformTarget, "web")}`,
    platform: platformTarget,
    role: "primary",
    name: `${platformTarget} primary surface`,
    interactionModes: [],
    featureIds: [],
    provenance: "derived"
  };
}
function migrateSpecInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const raw = input;
  if (raw.schemaVersion === 3 || typeof raw.schemaVersion === "number" && raw.schemaVersion > 3) {
    return input;
  }
  const integrations = Array.isArray(raw.integrations) ? raw.integrations.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const old = entry;
    const legacySetup = Array.isArray(old.manualSetup) ? old.manualSetup : [];
    const verification = Array.isArray(old.verification) && old.verification.length ? old.verification : ["TAG:UNRESOLVED \u2014 define the provider success and failure verification steps."];
    const { manualSetup: _manualSetup, ...rest } = old;
    return {
      ...rest,
      codeSetup: Array.isArray(old.codeSetup) ? old.codeSetup : [],
      unclassifiedSetup: Array.isArray(old.unclassifiedSetup) ? old.unclassifiedSetup : legacySetup,
      externalManualActions: Array.isArray(old.externalManualActions) ? old.externalManualActions : [],
      verification
    };
  }) : raw.integrations;
  const platformTargetResult = PlatformSchema.safeParse(raw.platformTarget ?? "web");
  const platformTarget = platformTargetResult.success ? platformTargetResult.data : raw.platformTarget;
  const specId = typeof raw.id === "string" && raw.id ? raw.id : "spec-migrated";
  return {
    ...raw,
    schemaVersion: 3,
    integrations,
    screens: migratedScreenElements(raw.screens),
    platformTarget,
    platformSurfaces: platformTargetResult.success ? [migratedPrimarySurface(platformTargetResult.data)] : raw.platformSurfaces,
    architecture: raw.architecture ?? {
      components: [],
      contracts: [],
      relationships: [],
      flows: [],
      specDependencies: []
    },
    governance: raw.governance ?? { constraints: [], decisions: [], owners: [] },
    changeSet: raw.changeSet ?? {
      id: `change-${slugIdPart(specId, "migrated")}-migration`,
      current: [],
      proposed: [],
      verified: []
    }
  };
}
var SpecSchema = external_exports.preprocess(migrateSpecInput, ValidatedSpecObjectSchema);
var LintIssueSchema = external_exports.object({
  id: IdSchema2,
  rule: external_exports.string(),
  severity: Severity,
  // Non-waivable blockers (PII without handlingNote) set this to false.
  waivable: external_exports.boolean().default(true),
  message: external_exports.string(),
  // Pointers back into the Spec graph.
  refs: external_exports.array(external_exports.object({
    kind: external_exports.enum([
      "need",
      "feature",
      "persona",
      "scenario",
      "uxflow",
      "screen",
      "datapoint",
      "integration",
      "api",
      "test",
      "adr",
      "assumption",
      "risk",
      "non_goal",
      "stance",
      "agent"
    ]),
    id: IdSchema2
  })).default([])
});
var TraceMatrixSchema = external_exports.object({
  generatedBy: external_exports.string(),
  // need_id → feature_ids
  needToFeatures: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // need_id → test_ids
  needToTests: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // feature_id → api_ids
  featureToApis: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  featureToTests: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // feature_id → screen_ids / integration_ids / task_ids
  featureToScreens: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  featureToIntegrations: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  featureToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // screen / integration / need → implementation task ids
  screenToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  integrationToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  needToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // implementation task id → tests that verify its satisfied entities
  taskToTests: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  integrationToTests: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  screenToTests: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  flowToScreens: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  platformSurfaceToTests: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToScopeRefs: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToScreens: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToElements: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToComponents: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToStates: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToActions: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToVerifications: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  behaviorToTests: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  decisionToConstraints: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  decisionToScopeRefs: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  decisionToScreens: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  decisionToElements: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  decisionToComponents: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  decisionToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  decisionToTests: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  decisionSupersession: external_exports.record(external_exports.string(), IdSchema2).default({}),
  designContractIntent: external_exports.enum(["change", "conformance"]).optional(),
  baselineToDeltas: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  constraintToVerifications: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  deltaToTargets: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  deltaToVerifications: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // adr_id → need_ids/feature_ids it justifies
  adrToTargets: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // Groundwork: pointer-grade entity layer wiring (additive; existing keys
  // above are untouched). entity_id → feature_ids that read or write it.
  entityToFeatures: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // Groundwork: the pillar → requirement → design → task → acceptance chain.
  // This is the edge ANNALS-style prompt output cannot produce: a pillar that
  // reaches no acceptance evidence is a stated priority nothing verifies.
  pillarToNeeds: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  pillarToFeatures: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  pillarToInvariants: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  pillarToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  /** Test ids plus the prime acceptanceTest id when it cites this pillar. */
  pillarToAcceptance: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  // Spec v3 architecture and ordered-task projections. Keys use qualified
  // identities where collisions across Specs are possible.
  componentToFeatures: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  componentToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  contractToComponents: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  contractToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  relationshipToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  architectureFlowToTasks: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  specDependencyToRefs: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  taskDependencies: external_exports.record(external_exports.string(), external_exports.array(IdSchema2)).default({}),
  taskToOwnedFiles: external_exports.record(external_exports.string(), external_exports.array(OwnedFileSchema)).optional(),
  taskOwnershipSource: external_exports.record(external_exports.string(), external_exports.enum(["explicit", "inferred"])).optional(),
  taskToPlannedNewFiles: external_exports.record(external_exports.string(), external_exports.array(OwnedFileSchema)).optional(),
  // Per-screen end-to-end impact record. Qualified architecture identities are
  // strings so this remains additive to the compatibility maps above.
  uiImpact: external_exports.array(external_exports.object({
    screenId: IdSchema2,
    needIds: external_exports.array(IdSchema2).default([]),
    featureIds: external_exports.array(IdSchema2).default([]),
    uxFlowIds: external_exports.array(IdSchema2).default([]),
    elementIds: external_exports.array(IdSchema2).default([]),
    stateImpacts: external_exports.array(external_exports.object({
      state: external_exports.string(),
      architectureFlowRefs: external_exports.array(IdSchema2).default([]),
      failurePaths: external_exports.array(external_exports.string()).default([]),
      testIds: external_exports.array(IdSchema2).default([])
    })).default([]),
    dataEntityIds: external_exports.array(IdSchema2).default([]),
    componentRefs: external_exports.array(IdSchema2).default([]),
    contractRefs: external_exports.array(IdSchema2).default([]),
    architectureFlowRefs: external_exports.array(IdSchema2).default([]),
    failurePaths: external_exports.array(external_exports.string()).default([]),
    securityNotes: external_exports.array(external_exports.string()).default([]),
    taskIds: external_exports.array(IdSchema2).default([]),
    testIds: external_exports.array(IdSchema2).default([]),
    unresolved: external_exports.array(external_exports.enum([
      "feature",
      "element-data",
      "data-entity",
      "component",
      "contract",
      "architecture-flow",
      "task",
      "test"
    ])).default([])
  })).default([]),
  coverageGaps: external_exports.array(external_exports.object({
    kind: external_exports.enum(["need", "feature", "screen", "integration", "task", "pillar"]),
    id: IdSchema2,
    missing: external_exports.enum(["feature", "screen", "api", "task", "test", "need", "pillar", "acceptance"])
  })).default([])
});

// engine/src/render.ts
function heading(level, text) {
  return `${"#".repeat(level)} ${text}`;
}
function bullet(line) {
  if (!line) return "";
  return `- ${line}`;
}
function joinNonEmpty(parts, sep3 = "\n") {
  return parts.filter((p) => Boolean(p && p.trim())).join(sep3);
}
function joinLines(parts) {
  return parts.filter((p) => p != null).join("\n");
}
function renderEars(ears, indent = "  ") {
  if (!ears || !ears.length) return "";
  return ears.map((e) => `${indent}- **${e.id}**: ${e.ears}`).join("\n");
}
function unresolved(prompt) {
  return `**TAG:UNRESOLVED** \u2014 ${prompt}`;
}
function renderGoverningSentence(sentence) {
  if (sentence && sentence.trim()) return `> ${sentence.trim()}`;
  return `> ${unresolved(
    'no governing sentence declared. Write the one sentence that decides every scope question \u2014 "<product> is <this>, not <that>." Every pillar and requirement below must be checkable against it.'
  )}`;
}
function renderPillars(pillars) {
  if (!pillars || !pillars.length) {
    return unresolved(
      "no pillars declared. Rank 3\u20135 non-negotiable statements, most important first \u2014 the ranking is what settles the conflicts below."
    );
  }
  return [...pillars].sort((a, b) => a.rank - b.rank).map((p) => `${p.rank}. **${p.id}** ${p.statement}`).join("\n");
}
function renderConflictRule() {
  return joinLines([
    "**Resolving a conflict:**",
    "",
    "- When two pillars conflict, the lower-ranked one yields.",
    "- When a system honours every pillar and still fails the prime-directive acceptance test, the test wins. Passing all the pillars and failing the acceptance test is not a tradeoff \u2014 it is a failed build."
  ]);
}
function renderAcceptanceTest(test) {
  if (!test) {
    return unresolved(
      'no prime-directive acceptance test declared. Name one outcome an observer can watch happen, inside a stated time box (e.g. "a first-time user completes X within 3 minutes, without reading docs"). Implementation is not done until it passes.'
    );
  }
  const lines = [
    `**${test.id}** \u2014 ${test.statement}`,
    "",
    `- **Observable:** ${test.observable}`,
    `- **Time box:** ${test.timeBox}`
  ];
  if (test.steps.length) {
    lines.push("", "**Steps:**");
    test.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  if (test.pillarIds.length) {
    lines.push("", `**Serves pillars:** ${test.pillarIds.join(", ")}`);
  }
  return joinLines(lines);
}
function renderNfr(nfr, label = "Non-functional requirements") {
  const list2 = (items) => items.map((i) => `  - ${i}`).join("\n");
  const field = (title, items, prompt) => items.length ? `- **${title}:**
${list2(items)}` : `- **${title}:** ${unresolved(prompt)}`;
  const lines = [`_${label}: every field below is answered or explicitly marked unresolved._`, ""];
  lines.push(
    nfr?.testStrategy?.trim() ? `- **Test strategy:** ${nfr.testStrategy.trim()}` : `- **Test strategy:** ${unresolved(
      "name the test levels and what each one proves (unit / integration / e2e / manual), and which level gates the release."
    )}`
  );
  lines.push(
    field(
      "Edge cases",
      nfr?.edgeCases ?? [],
      "list the inputs and states that break the happy path: empty, maximum, concurrent, offline, partial, duplicate, and stale."
    )
  );
  lines.push(
    field(
      "Error handling",
      nfr?.errorHandling ?? [],
      "state what the user sees and what the system does for each failure class \u2014 and whether the operation is retryable."
    )
  );
  lines.push(
    field(
      "Validation",
      nfr?.validation ?? [],
      "name every input's rule and the layer that enforces it (client, server, database). Client-only validation is not validation."
    )
  );
  lines.push(
    field(
      "Security",
      nfr?.security ?? [],
      "state the authentication boundary, the authorization rule, secret handling, and the data that must never leave the device or the account."
    )
  );
  lines.push(
    field(
      "Accessibility",
      nfr?.accessibility ?? [],
      "state the contrast floor, keyboard path, screen-reader labels, focus management, and minimum touch target."
    )
  );
  return lines.join("\n");
}
function renderPersonas(personas) {
  if (!personas.length) return "_No personas specified._";
  return personas.map((p) => {
    const lines = [heading(3, p.name)];
    if (p.trigger) lines.push(`**Trigger:** ${p.trigger}`);
    if (p.exclusions.length) {
      lines.push("", "**Who they are NOT:**");
      for (const e of p.exclusions) lines.push(bullet(e));
    }
    if (p.jobs.length) {
      lines.push("", "**Jobs to be done:**");
      for (const j of p.jobs) lines.push(bullet(j));
    }
    return joinNonEmpty(lines);
  }).join("\n\n");
}
function renderGoals(goals, scenarios) {
  if (goals && goals.length) {
    return goals.map((g) => {
      const metric = g.metric ? ` _Success metric:_ ${g.metric}` : "";
      return `- **${g.id}** ${g.statement}${metric}`;
    }).join("\n");
  }
  if (!scenarios.length) return "_No goals specified._";
  return scenarios.map((s) => {
    const ctx = s.context ? `_${s.context}_ \u2014 ` : "";
    return `- ${ctx}**${s.goal}**`;
  }).join("\n");
}
function renderNonGoals(nonGoals) {
  if (!nonGoals.length) return "_None specified._";
  return nonGoals.map((n) => {
    const because = n.because ? ` _Because:_ ${n.because}` : "";
    return `- ${n.text}${because}`;
  }).join("\n");
}
function renderNeedsWithEars(needs) {
  if (!needs.length) return "_None specified._";
  return needs.map((n) => {
    const pri = n.priority ? `[${n.priority}] ` : "";
    const desc = n.description ? ` \u2014 ${n.description}` : "";
    const head = `- **${n.id}** ${pri}${n.title}${desc}`;
    const ears = renderEars(n.ears);
    const acceptance = ears ? `
  - Acceptance criteria (EARS):
${ears.replace(/^ {2}/gm, "    ")}` : "";
    return `${head}${acceptance}`;
  }).join("\n");
}
function renderFeaturesWithEars(features) {
  if (!features.length) return "_None specified._";
  return features.map((f) => {
    const pri = f.priority ? `[${f.priority}] ` : "";
    const refs = f.needIds.length ? ` (serves ${f.needIds.join(", ")})` : "";
    const surface = f.surface === "unspecified" ? "" : ` _Surface: ${f.surface}._`;
    const head = `- **${f.id}** ${pri}${f.title}${refs}${surface}`;
    const plainAc = f.acceptanceCriteria.length ? `
  - Acceptance:
${f.acceptanceCriteria.map((c) => `    - ${c}`).join("\n")}` : "";
    const ears = renderEars(f.ears);
    const earsAc = ears ? `
  - Acceptance criteria (EARS):
${ears.replace(/^ {2}/gm, "    ")}` : "";
    return `${head}${plainAc}${earsAc}`;
  }).join("\n");
}
function renderSuccessMetrics(metrics, scenarios) {
  if (metrics && metrics.length) {
    return metrics.map((m) => `- **${m.id}** ${m.metric} \u2192 **${m.target}**`).join("\n");
  }
  const signals = scenarios.filter((s) => s.successSignal && s.successSignal.trim()).map((s) => `- ${s.successSignal}`);
  if (!signals.length) return "_No success metrics specified._";
  return signals.join("\n");
}
function renderArchitectureSummary(spec) {
  const lines = [];
  lines.push(spec.productDescription || "_No product description._");
  lines.push("");
  lines.push(`**Compatibility platform target:** ${spec.platformTarget}`);
  lines.push("", "**Product topology:**");
  for (const surface of spec.platformSurfaces) {
    const provenance = surface.provenance ? `; ${surface.provenance}` : "";
    const features = surface.featureIds.length ? `; features: ${surface.featureIds.join(", ")}` : "";
    const platform = surface.platform === "macos" ? "macOS" : surface.platform === "ios" ? "iOS" : surface.platform;
    lines.push(`- **${surface.id}** ${surface.name} \u2014 ${platform} (${surface.role}${provenance})${features}`);
  }
  if (spec.architecture.components.length) {
    lines.push("", "**Logical components:**");
    for (const component of spec.architecture.components) {
      const features = component.featureIds.length ? `; features: ${component.featureIds.join(", ")}` : "";
      lines.push(`- **${component.id}** ${component.name} \u2014 ${component.kind}; owner: ${component.owner}${features}`);
      if (component.ownedFiles?.length) lines.push(`  - Explicit owned files: ${component.ownedFiles.map((file) => `\`${file}\``).join(", ")}`);
    }
  }
  if (spec.architecture.contracts.length) {
    lines.push("", "**Component contracts:**");
    for (const contract of spec.architecture.contracts) {
      lines.push(`- **${contract.id}** ${contract.name}`);
      lines.push(`  - Provider: ${contract.provider.specId}:${contract.provider.id}`);
      lines.push(`  - Consumers: ${contract.consumers.map((ref2) => `${ref2.specId}:${ref2.id}`).join(", ")}`);
      lines.push(`  - Transport: ${contract.transport}`);
      lines.push(`  - Ports: ${contract.ports.map((port) => `${port.id} ${port.direction} ${port.type}`).join("; ")}`);
      lines.push(`  - Failure modes: ${contract.failureModes.join("; ")}`);
      lines.push(`  - Security: ${contract.securityNotes.join("; ")}`);
      if (contract.ownedFiles?.length) lines.push(`  - Explicit owned files: ${contract.ownedFiles.map((file) => `\`${file}\``).join(", ")}`);
    }
  }
  if (spec.architecture.relationships.length) {
    lines.push("", "**Dependency relationships:**");
    for (const relationship of spec.architecture.relationships) {
      const contract = relationship.contractRef ? ` via ${relationship.contractRef.specId}:${relationship.contractRef.id}` : "";
      lines.push(`- **${relationship.id}** ${relationship.from.specId}:${relationship.from.id} \u2192 ${relationship.to.specId}:${relationship.to.id}${contract} \u2014 ${relationship.criticality}; ${relationship.rationale}`);
    }
  }
  if (spec.architecture.flows.length) {
    lines.push("", "**Architecture flows:**");
    for (const flow of spec.architecture.flows) {
      lines.push(`- **${flow.id}** ${flow.name} \u2014 trigger: ${flow.trigger}`);
      for (const exchange of [...flow.exchanges].sort((a, b) => a.order - b.order)) {
        lines.push(`  - ${exchange.order}. ${exchange.from.specId}:${exchange.from.id} \u2192 ${exchange.to.specId}:${exchange.to.id}; contract ${exchange.contractRef.specId}:${exchange.contractRef.id}`);
        lines.push(`    - Failure paths: ${exchange.failurePaths.join("; ")}`);
      }
    }
  }
  if (spec.architecture.specDependencies.length) {
    lines.push("", "**Pinned Spec dependencies:**");
    for (const dependency of spec.architecture.specDependencies) {
      const location = dependency.location.kind === "local" ? dependency.location.path : dependency.location.uri;
      lines.push(`- **${dependency.id}** ${dependency.relationship} ${dependency.specId} \u2014 schema v${dependency.schemaVersion}; revision ${dependency.revision}; digest ${dependency.digest}; ${dependency.location.kind}: ${location}`);
    }
  }
  lines.push("", "**Change lifecycle:**");
  for (const bucket of ["current", "proposed", "verified"]) {
    const changes = spec.changeSet[bucket];
    if (!changes.length) {
      lines.push(`- **${bucket}:** none recorded.`);
      continue;
    }
    for (const change of changes) {
      lines.push(`- **${bucket} \xB7 ${change.id}:** ${change.summary} \u2014 target ${change.target.specId}:${change.target.kind}:${change.target.id}; ${change.provenance}`);
    }
  }
  if (spec.integrations.length) {
    lines.push("", "**External integrations:**");
    for (const i of spec.integrations) {
      const auth = i.authMode ? ` (auth: ${i.authMode})` : "";
      lines.push(`- **${i.id}** ${i.name} \u2014 ${i.purpose}${auth}`);
      if (i.requiredEnv.length) {
        lines.push(`  - Required configuration: ${i.requiredEnv.map((v) => `\`${v}\``).join(", ")}`);
      }
      if (i.featureIds.length) lines.push(`  - Serves features: ${i.featureIds.join(", ")}`);
      for (const step of i.codeSetup) lines.push(`  - AI-owned setup: ${step}`);
      for (const step of i.unclassifiedSetup) {
        lines.push(`  - TAG:UNRESOLVED setup ownership: ${step}`);
      }
      for (const action of i.externalManualActions) {
        lines.push(`  - External manual action (${action.surface}): ${action.action}`);
        if (action.requiredValue) lines.push(`    - Required value or permission: ${action.requiredValue}`);
        if (action.appDestination) lines.push(`    - App destination: ${action.appDestination}`);
        lines.push(`    - Verify: ${action.verification}`);
      }
      for (const check of i.verification) lines.push(`  - Verify: ${check}`);
      if (i.docsUrl) lines.push(`  - Provider docs: ${i.docsUrl}`);
    }
  }
  if (spec.agentSystem?.mission) {
    lines.push("", `**Agent mission:** ${spec.agentSystem.mission}`);
  }
  return joinNonEmpty(lines);
}
function renderDataModels(points) {
  if (!points.length) return "_None specified._";
  return points.map((d) => {
    const piiTag = d.pii ? " **(PII)**" : "";
    const desc = d.description ? ` \u2014 ${d.description}` : "";
    const note = d.handlingNote ? `
  - Handling: ${d.handlingNote}` : d.pii ? "\n  - Handling: TAG:UNRESOLVED \u2014 handlingNote required for pii=true" : "";
    return `- **${d.id}** ${d.name} \`${d.type}\`${piiTag}${desc}${note}`;
  }).join("\n");
}
function renderAPIContracts(apis) {
  if (!apis.length) return "_None specified._";
  return apis.map((a) => {
    const lines = [`#### \`${a.method} ${a.path}\` _(${a.id})_`];
    if (a.description) lines.push(a.description);
    if (a.requestSchema) lines.push(`**Request:**
\`\`\`
${a.requestSchema}
\`\`\``);
    if (a.responseSchema) lines.push(`**Response:**
\`\`\`
${a.responseSchema}
\`\`\``);
    if (a.featureIds.length) lines.push(`_Serves features: ${a.featureIds.join(", ")}_`);
    return joinNonEmpty(lines);
  }).join("\n\n");
}
function renderADRs(adrs) {
  if (!adrs.length) return "_None specified._";
  return adrs.map((a) => {
    const lines = [
      heading(3, `${a.id} \u2014 ${a.title}`),
      `**Reversibility:** ${a.reversibility}`,
      `**Context:** ${a.context}`,
      `**Decision:** ${a.decision}`,
      // Consequences carry the tradeoff / alternatives rationale.
      a.consequences ? `**Consequences & alternatives:** ${a.consequences}` : null,
      a.cites.length ? `**Cites:** ${a.cites.join(", ")}` : null
    ];
    return joinNonEmpty(lines);
  }).join("\n\n");
}
function renderServiceLevels(levels) {
  if (!levels.length) return "_None specified._";
  return levels.map((l) => `- **${l.metric}** \u2192 ${l.target}`).join("\n");
}
function renderObservability(obs) {
  if (!obs || !obs.slis.length && !obs.slos.length) return "_None specified._";
  const lines = [];
  lines.push(heading(3, "SLIs"), "", renderServiceLevels(obs.slis));
  lines.push("", heading(3, "SLOs"), "", renderServiceLevels(obs.slos));
  return joinNonEmpty(lines);
}
function renderHardConstraints(constraints) {
  if (!constraints || !constraints.length) {
    return "_None declared \u2014 no technology, hosting, dependency, or data-residency choice is foreclosed._";
  }
  return constraints.map((c) => {
    const because = c.because ? ` _Because:_ ${c.because}` : "";
    return `- **${c.id}** ${c.constraint}${because}`;
  }).join("\n");
}
function renderPerformanceBudget(budget) {
  if (!budget || !budget.length) {
    return unresolved(
      'no performance budget declared. Give each user-visible operation a number and a percentile (e.g. "search results < 300ms p95") and say how it is measured. Without one, "fast enough" is decided by whoever writes the code.'
    );
  }
  return budget.map((b) => {
    const how = b.measuredBy ? ` _Measured by:_ ${b.measuredBy}` : "";
    return `- **${b.id}** ${b.metric} \u2192 **${b.budget}**${how}`;
  }).join("\n");
}
function renderArchitecturalInvariants(invariants) {
  if (!invariants || !invariants.length) {
    return "_None declared \u2014 no structural rule is being asserted beyond the ADRs above._";
  }
  const lines = invariants.map((i) => {
    const pillars = i.pillarIds.length ? ` _(serves ${i.pillarIds.join(", ")})_` : "";
    return `- **${i.id}** ${i.rule}${pillars}
  - Check: \`${i.check}\``;
  });
  lines.push(
    "",
    "**Run every invariant check.** Each command must exit 0; a non-zero exit is a violated invariant, not a warning.",
    "",
    "```bash",
    ...invariants.map((i) => i.check),
    "```"
  );
  return lines.join("\n");
}
function renderRisks(risks) {
  if (!risks.length) return "_None specified._";
  return risks.map((r) => {
    const mit = r.mitigation ? ` Mitigation: ${r.mitigation}` : "";
    return `- _(L:${r.likelihood} I:${r.impact})_ ${r.text}.${mit}`;
  }).join("\n");
}
function renderScreenElements(elements) {
  if (!elements || !elements.length) return "_None specified._";
  return elements.map((e) => e.role ? `${e.name} (${e.role})` : e.name).join(", ");
}
function renderScreenData(data) {
  if (!data || !data.length) return "_None specified._";
  return data.map((d) => d.source ? `${d.field} \u2190 ${d.source}` : d.field).join(", ");
}
function renderScreenCards(screens) {
  if (!screens.length) return "_No screens specified._";
  return screens.map((s) => {
    const lines = [
      heading(3, `${s.name} _(${s.id})_`),
      `**Purpose:** ${s.purpose}`,
      `**Elements:** ${renderScreenElements(s.elements)}`,
      `**Data:** ${renderScreenData(s.data)}`,
      `**Interactions:** ${s.primaryAction ?? "_None specified._"}`,
      `**States:** ${s.states.length ? s.states.join(", ") : "_None specified._"}`
    ];
    return joinNonEmpty(lines);
  }).join("\n\n");
}
function renderBehaviorContracts(contracts) {
  if (!contracts.length) return "_No behavior contract declared. Existing screen and flow sections remain authoritative._";
  return contracts.map((contract) => joinLines([
    heading(3, `${contract.name} _(${contract.id})_`),
    `**Trigger:** ${contract.trigger}`,
    `**Scope:** ${contract.scope.kind} \u2014 ${contract.scope.refs.join(", ")}`,
    `**States:** ${contract.states.length ? contract.states.map((state) => state.id).join(", ") : "_None declared_"}`,
    "**Actions:**",
    ...contract.actions.length ? contract.actions.map((action) => `- **${action.name}** _(${action.id})_ \u2192 ${action.toStateId ?? "state unchanged"}; effects: ${action.effects.map((effect) => effect.kind).join(", ") || "none"}; writes: ${action.writes.map((write) => `${write.storeRef}/${write.entity}`).join(", ") || "none"}; prohibited: ${action.prohibitedWrites.map((write) => `${write.storeRef}/${write.entity}`).join(", ") || "none"}`) : ["- _None declared_"],
    `**Information flow:** ${contract.informationFlow.length ? contract.informationFlow.map((flow) => `${flow.sourceRef} \u2192 ${flow.targetRef}`).join("; ") : "_None declared_"}`
  ])).join("\n\n");
}
function renderDesignContract(spec) {
  const contract = spec.designContract;
  if (!contract) return "_No reproducible baseline or design delta declared._";
  const baseline = contract.baseline;
  return joinLines([
    `**Contract intent:** ${contract.intent?.type ?? "change"}`,
    `**Baseline:** ${baseline.disposition}${baseline.id ? ` \u2014 ${baseline.id}` : ""}`,
    "**Authoritative baseline artifacts:**",
    ...baseline.artifacts.length ? baseline.artifacts.map((artifact) => `- \`${artifact.path}\` \u2014 ${artifact.type}; \`${artifact.digest}\``) : ["- _None declared_"],
    `**Direction:** ${contract.direction.summary}`,
    "**Decisions:**",
    ...spec.adrs.filter((adr) => adr.rigidity).map((adr) => `- **${adr.id}** \u2014 ${adr.rigidity}; scope: ${adr.scope ? adr.scope.refs.join(", ") : "unspecified"}`) || ["- _None declared_"],
    "**Deltas:**",
    ...contract.deltas.length ? contract.deltas.map((delta) => `- **${delta.id}** ${delta.operation} ${delta.targetRefs.join(", ")} (${delta.baselineId ?? "no baseline"})`) : ["- _None declared_"],
    "**Precedence:**",
    ...baseline.precedence.length ? baseline.precedence.map((entry) => `- ${entry.rank}. ${entry.artifactId}`) : ["- _None declared_"],
    `**Verification:** ${contract.verification.length ? contract.verification.map((item) => item.id).join(", ") : "_None declared_"}`,
    "**Exact reconstruction checklist:**",
    ...contract.constraints.length ? contract.constraints.map((item) => `- [ ] \`${item.id}\`: ${item.targetRef}.${item.propertyPath} ${item.operator}${item.value === void 0 ? "" : ` ${JSON.stringify(item.value)}`}${item.unit ? ` ${item.unit}` : ""}; evidence: ${item.sourceArtifactId ?? "none"}; verify: ${item.verificationRefs.join(", ") || "none"}`) : ["- _None declared_"]
  ]);
}
function renderUXFlows(flows) {
  if (!flows.length) return "_None specified._";
  return flows.map((f) => {
    const steps = f.steps.length ? f.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n") : "  _No steps specified._";
    const screens = f.screenIds.length ? `  - Screens: ${f.screenIds.join(", ")}` : "";
    return joinNonEmpty([heading(3, `${f.name} _(${f.id})_`), steps, screens]);
  }).join("\n\n");
}
function renderVoiceProfile(voice) {
  if (!voice || !voice.principles.length && !voice.doWords.length && !voice.dontWords.length && !voice.examples.length) {
    return "_None specified._";
  }
  const blocks = [];
  if (voice.principles.length) {
    blocks.push(joinLines(["**Principles:**", ...voice.principles.map(bullet)]));
  }
  if (voice.doWords.length) blocks.push(`**Do:** ${voice.doWords.join(", ")}`);
  if (voice.dontWords.length) blocks.push(`**Don't:** ${voice.dontWords.join(", ")}`);
  blocks.push(
    joinLines([
      "**Example copy:**",
      ...voice.examples.length ? voice.examples.map((e) => `- _${e.context}:_ "${e.copy}"`) : [
        bullet(
          unresolved(
            "no example copy strings declared. Write the literal text for at least the primary action, one empty state, and one error \u2014 the register is not transferable without them."
          )
        )
      ]
    ])
  );
  return blocks.join("\n\n");
}
function renderReadingContract(spec) {
  const contract = spec.readingContract;
  const tier = contract?.tier?.trim() || "frontier";
  const context = contract?.context?.trim() || "codegen";
  const lines = [
    `**Read at:** tier \`${tier}\` \xB7 context \`${context}\``,
    "",
    "**No compression.** Every section in this set carries a testable constraint. Summarizing a section, merging two, or skipping one marked `TAG:UNRESOLVED` drops the constraint it carried and leaves the prose that hid it. Read every section at full length before writing code."
  ];
  const notes = contract?.notes ?? [];
  if (notes.length) {
    lines.push("", "**Standing instructions:**", ...notes.map(bullet));
  }
  return joinLines(lines);
}
function renderSpecCodeSync(spec) {
  const sync = spec.specCodeSync;
  const policy = sync?.policy ?? "spec-first";
  const specPath = sync?.specPath ?? "spec.json";
  const regenerate = sync?.regenerateCommand;
  const lines = [
    `**Policy:** \`${policy}\` \xB7 **Source of truth:** \`${specPath}\``,
    ""
  ];
  if (policy === "spec-first") {
    lines.push(
      `When implementation and \`${specPath}\` disagree, \`${specPath}\` wins: change it first, regenerate, then code.`
    );
  } else if (policy === "code-first") {
    lines.push(
      `When implementation and \`${specPath}\` disagree, the running code wins: update \`${specPath}\` to match observed behavior, then regenerate.`
    );
  } else {
    lines.push(
      `When implementation and \`${specPath}\` disagree, resolve the delta explicitly and record which side changed \u2014 neither silently wins.`
    );
  }
  lines.push(
    "",
    `Every markdown file in this directory is a rendered projection of \`${specPath}\`. Editing one by hand loses the edit on the next generation \u2014 edit the Spec instead.`,
    "",
    "**A change is not done until the Spec reflects it.** Update the Spec and regenerate when the work:"
  );
  const triggers = sync?.triggers.length ? sync.triggers : [
    "adds, removes, or renames a requirement, feature, screen, or API contract",
    "changes a data field, its type, or its PII classification",
    "adds or drops an external integration, environment variable, or manual setup action",
    "changes an acceptance criterion, invariant, performance budget, or hard constraint",
    "resolves a TAG:UNRESOLVED or TAG:ASSUMED item anywhere in this artifact set"
  ];
  for (const t of triggers) lines.push(bullet(t));
  if (regenerate) {
    lines.push("", "**Regenerate with:**", "", "```bash", regenerate, "```");
  } else {
    lines.push(
      "",
      `**Regenerate with:** the Groundwork emitter against \`${specPath}\` (\`node <plugin>/engine/dist/cli.js ${specPath} --out .\`).`
    );
  }
  return lines.join("\n");
}
function renderProjectContext(spec) {
  const context = spec.projectContext;
  const lines = [`**Starting point:** ${context.startingPoint}`];
  if (context.sourceRepo) lines.push(`**Source repository:** \`${context.sourceRepo}\``);
  if (context.sourceUrl) lines.push(`**Running product:** ${context.sourceUrl}`);
  if (context.sourceArtifacts.length) {
    lines.push(`**Inspected artifacts:** ${context.sourceArtifacts.map((item) => `\`${item}\``).join(", ")}`);
  }
  if (context.inspectedAt) lines.push(`**Inspected at:** ${context.inspectedAt}`);
  if (context.bootstrap) {
    lines.push("", "**Accepted bootstrap files:**");
    for (const file of context.bootstrap.ownedFiles) lines.push(`- \`${file}\``);
    lines.push(
      "",
      "**Accepted bootstrap commands:**",
      `- Install: \`${context.bootstrap.commands.install}\``,
      `- Typecheck: \`${context.bootstrap.commands.typecheck}\``,
      `- Test: \`${context.bootstrap.commands.test}\``,
      `- Build: \`${context.bootstrap.commands.build}\``
    );
  }
  if (context.evidence.length) {
    lines.push("", "**Evidence and decisions:**");
    for (const item of context.evidence) {
      const refs = item.sourceRefs.length ? ` _Sources: ${item.sourceRefs.join(", ")}._` : "";
      lines.push(`- **${item.status.toUpperCase()} \xB7 ${item.id}:** ${item.statement}${refs}`);
    }
  }
  return joinNonEmpty(lines);
}
function renderUiPreferences(spec) {
  const ui = spec.uiPreferences;
  const lines = [];
  if (ui.informationDensity) lines.push(`**Information density:** ${ui.informationDensity}`);
  if (ui.brandAdjectives.length) lines.push(`**Brand direction:** ${ui.brandAdjectives.join(", ")}`);
  if (ui.accessibilityFloor.length) {
    lines.push("", "**Accessibility floor:**");
    for (const item of ui.accessibilityFloor) lines.push(bullet(item));
  }
  if (ui.responsiveTargets) {
    const range = [ui.responsiveTargets.minimum, ui.responsiveTargets.maximum].filter(Boolean).join(" \u2192 ");
    if (range) lines.push("", `**Responsive range:** ${range}`);
    if (ui.responsiveTargets.deviceClasses.length) {
      lines.push(`**Device classes:** ${ui.responsiveTargets.deviceClasses.join(", ")}`);
    }
  }
  if (ui.mustKeep.length) {
    lines.push("", "**Must keep:**");
    for (const item of ui.mustKeep) lines.push(bullet(item));
  }
  if (ui.mustAvoid.length) {
    lines.push("", "**Must avoid:**");
    for (const item of ui.mustAvoid) lines.push(bullet(item));
  }
  if (ui.mayEvolve.length) {
    lines.push("", "**May evolve:**");
    for (const item of ui.mayEvolve) lines.push(bullet(item));
  }
  if (ui.visualReferences.length) {
    lines.push("", "**Visual references:**");
    for (const item of ui.visualReferences) lines.push(bullet(item));
  }
  return joinNonEmpty(lines) || "_No UI preferences captured._";
}
function renderRequirements(spec) {
  const featureNfrOverrides = renderFeatureNfrOverrides(spec.features);
  const parts = [
    heading(1, `Requirements \u2014 ${spec.productName}`),
    "",
    // Pillars and the prime directive lead the document deliberately: a reader
    // must be able to resolve a priority conflict, and know what "done" looks
    // like, before reading a single requirement.
    renderGoverningSentence(spec.governingSentence),
    "",
    heading(2, "Pillars"),
    "",
    "_Ranked non-negotiables. Rank 1 is the one that survives when something has to give._",
    "",
    renderPillars(spec.pillars),
    "",
    renderConflictRule(),
    "",
    heading(2, "Prime directive \u2014 acceptance test"),
    "",
    "_The single observable, time-boxed outcome that decides whether this build succeeded._",
    "",
    renderAcceptanceTest(spec.acceptanceTest),
    "",
    heading(2, "Problem & context"),
    "",
    spec.productDescription || "_No description._",
    "",
    heading(2, "Starting point & provenance"),
    "",
    renderProjectContext(spec),
    "",
    heading(2, "Goals"),
    "",
    renderGoals(spec.goals, spec.scenarios),
    "",
    heading(2, "Non-goals"),
    "",
    renderNonGoals(spec.nonGoals),
    "",
    heading(2, "Personas"),
    "",
    renderPersonas(spec.personas),
    "",
    heading(2, "Needs"),
    "",
    renderNeedsWithEars(spec.needs),
    "",
    heading(2, "Features"),
    "",
    renderFeaturesWithEars(spec.features),
    "",
    heading(2, "Non-functional requirements"),
    "",
    renderNfr(spec.nfr),
    "",
    // Only present when at least one feature declares an override — an empty
    // heading would read like a defect.
    ...featureNfrOverrides ? [featureNfrOverrides, ""] : [],
    heading(2, "Success metrics"),
    "",
    renderSuccessMetrics(spec.successMetrics, spec.scenarios),
    ""
  ];
  return parts.join("\n");
}
function renderFeatureNfrOverrides(features) {
  const withNfr = features.filter((f) => f.nfr);
  if (!withNfr.length) return "";
  return withNfr.map(
    (f) => joinLines([
      heading(3, `Feature overrides \u2014 ${f.title} _(${f.id})_`),
      "",
      renderNfr(f.nfr, `Overrides for ${f.id}`)
    ])
  ).join("\n\n");
}
function renderDesign(spec) {
  const parts = [
    heading(1, `Design \u2014 ${spec.productName}`),
    "",
    heading(2, "Architecture summary"),
    "",
    renderArchitectureSummary(spec),
    "",
    ...spec.designContract ? [heading(2, "Reproducible design contract"), "", renderDesignContract(spec), ""] : [],
    heading(2, "Hard constraints"),
    "",
    "_Non-negotiable bounds on the solution space. A design that violates one is wrong, not a tradeoff._",
    "",
    renderHardConstraints(spec.hardConstraints),
    "",
    heading(2, "Performance budget"),
    "",
    renderPerformanceBudget(spec.performanceBudget),
    "",
    heading(2, "Architectural invariants"),
    "",
    "_Each rule carries the check that enforces it. Prose without a check is a wish._",
    "",
    renderArchitecturalInvariants(spec.architecturalInvariants),
    "",
    heading(2, "Data models"),
    "",
    renderDataModels(spec.dataPoints),
    "",
    heading(2, "API contracts"),
    "",
    renderAPIContracts(spec.apiContracts),
    "",
    heading(2, "Architecture decisions (ADRs)"),
    "",
    renderADRs(spec.adrs),
    "",
    heading(2, "Observability"),
    "",
    renderObservability(spec.observability),
    "",
    heading(2, "Risks"),
    "",
    renderRisks(spec.risks),
    ""
  ];
  return parts.join("\n");
}
function renderDesignUx(spec) {
  const parts = [
    heading(1, `Design (UX) \u2014 ${spec.productName}`),
    "",
    ...spec.behaviorContracts?.length ? [heading(2, "Behavior contract"), "", renderBehaviorContracts(spec.behaviorContracts), ""] : [],
    heading(2, "Screens"),
    "",
    renderScreenCards(spec.screens),
    "",
    heading(2, "UX flows"),
    "",
    renderUXFlows(spec.uxFlows),
    "",
    heading(2, "Voice & tone"),
    "",
    renderVoiceProfile(spec.voiceProfile),
    "",
    heading(2, "Confirmed UI preferences"),
    "",
    renderUiPreferences(spec),
    "",
    "---",
    "> **Design tokens** (color, type, space, motion), when confirmed, are embedded in the Builder Handoff alongside this human-facing screen and voice brief. No separate token sidecar is required to understand the accepted direction.",
    ""
  ];
  return parts.join("\n");
}
function renderSteering(spec) {
  const boundaries = spec.boundaries;
  const lines = [
    heading(1, `Steering \u2014 ${spec.productName}`),
    "",
    // The config header leads the packet's front door: it governs how every
    // other file here is read, so it cannot sit below them.
    renderReadingContract(spec),
    "",
    "---",
    "",
    renderGoverningSentence(spec.governingSentence),
    "",
    heading(2, "Pillars"),
    "",
    renderPillars(spec.pillars),
    "",
    renderConflictRule(),
    "",
    heading(2, "Spec \u2194 code sync"),
    "",
    renderSpecCodeSync(spec),
    "",
    heading(2, "Product direction"),
    "",
    spec.productDescription,
    "",
    renderProjectContext(spec),
    "",
    heading(2, "UI direction"),
    "",
    renderUiPreferences(spec),
    "",
    heading(2, "Voice"),
    "",
    renderVoiceProfile(spec.voiceProfile),
    "",
    heading(2, "Operating boundaries"),
    ""
  ];
  if (!boundaries) {
    lines.push("_No explicit boundaries captured._");
  } else {
    for (const [label, items] of [
      ["Always", boundaries.always],
      ["Ask first", boundaries.askFirst],
      ["Never", boundaries.never]
    ]) {
      lines.push(heading(3, label), "");
      lines.push(items.length ? items.map(bullet).join("\n") : "_None specified._", "");
    }
  }
  return lines.join("\n");
}
function renderDocs(spec) {
  return {
    "steering.md": renderSteering(spec),
    "requirements.md": renderRequirements(spec),
    "design.md": renderDesign(spec),
    // Named `design-system.md` (not `DESIGN.md`) so it never collides with
    // `design.md` on case-insensitive filesystems (default macOS APFS).
    "design-system.md": renderDesignUx(spec)
  };
}

// engine/src/graph.ts
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// engine/src/build-exchange.ts
import { createHash } from "node:crypto";
var BUILD_REQUEST_CONTRACT = "groundwork.build-request/v1";
var IMPLEMENTATION_MAP_CONTRACT = "build-loop.implementation-map/v1";
var CONVERGENCE_CONTRACT = "groundwork.convergence/v1";
var IdSchema3 = external_exports.string().min(1);
var NonEmptyStringSchema2 = external_exports.string().min(1);
var DigestSchema = external_exports.string().regex(/^sha256:[a-f0-9]{64}$/);
var DateTimeSchema = external_exports.string().datetime({ offset: true });
var EMPTY_DIGEST = `sha256:${"0".repeat(64)}`;
var BuildTaskSchema = external_exports.object({
  id: IdSchema3,
  title: NonEmptyStringSchema2,
  componentRefs: external_exports.array(QualifiedRefSchema),
  contractRefs: external_exports.array(QualifiedRefSchema),
  requirementIds: external_exports.array(IdSchema3),
  dependsOn: external_exports.array(IdSchema3),
  acceptanceCriterionIds: external_exports.array(IdSchema3),
  ownedFiles: OwnedFilesSchema.optional()
}).strict();
var BuildAcceptanceCriterionSchema = external_exports.object({
  id: IdSchema3,
  statement: NonEmptyStringSchema2,
  testHint: external_exports.string().optional()
}).strict();
var BuildManualActionSchema = external_exports.object({
  id: IdSchema3,
  location: NonEmptyStringSchema2,
  action: NonEmptyStringSchema2,
  requiredValueName: NonEmptyStringSchema2,
  destination: NonEmptyStringSchema2,
  verification: NonEmptyStringSchema2
}).strict().superRefine((action, ctx) => {
  for (const field of ["id", "location", "action", "requiredValueName", "destination", "verification"]) {
    const reason = externalManualActionSecretReason(action[field]);
    if (reason) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [field],
        message: `Build manual actions may name required values or permissions, but must not contain actual secrets (${reason}).`
      });
    }
  }
});
var ReturnVersionsSchema = external_exports.object({
  implementationMap: external_exports.array(external_exports.literal(IMPLEMENTATION_MAP_CONTRACT)).min(1),
  convergence: external_exports.array(external_exports.literal(CONVERGENCE_CONTRACT)).min(1)
}).strict();
var BuildRequestSchema = external_exports.object({
  contract: external_exports.literal(BUILD_REQUEST_CONTRACT),
  runId: IdSchema3,
  specId: IdSchema3,
  specDigest: DigestSchema,
  taskDigest: DigestSchema,
  platformSurfaces: external_exports.array(PlatformSurfaceSchema).min(1),
  architecture: ArchitectureSchema,
  tasks: external_exports.array(BuildTaskSchema).min(1),
  acceptanceCriteria: external_exports.array(BuildAcceptanceCriterionSchema),
  manualActions: external_exports.array(BuildManualActionSchema),
  returnVersions: ReturnVersionsSchema,
  requestDigest: DigestSchema,
  createdAt: DateTimeSchema
}).strict();
var ImplementationProducerSchema = external_exports.object({
  name: external_exports.literal("build-loop"),
  version: NonEmptyStringSchema2,
  commit: external_exports.string().min(7).optional()
}).strict();
var ImplementationMappingKindSchema = external_exports.enum([
  "task",
  "component",
  "contract",
  "requirement"
]);
var ImplementationMappingStatusSchema = external_exports.enum([
  "not-started",
  "implemented",
  "verified",
  "blocked",
  "manual",
  "diverged"
]);
var ImplementationMappingSchema = external_exports.object({
  id: IdSchema3,
  kind: ImplementationMappingKindSchema,
  targetId: IdSchema3,
  status: ImplementationMappingStatusSchema,
  fileRefs: external_exports.array(NonEmptyStringSchema2),
  symbolRefs: external_exports.array(NonEmptyStringSchema2),
  commitRefs: external_exports.array(external_exports.string().min(7)),
  testEvidenceIds: external_exports.array(IdSchema3),
  runtimeEvidenceIds: external_exports.array(IdSchema3),
  deviationIds: external_exports.array(IdSchema3).optional()
}).strict();
var ImplementationEvidenceKindSchema = external_exports.enum(["test", "runtime", "inspection"]);
var ImplementationEvidenceOutcomeSchema = external_exports.enum(["passed", "failed", "blocked", "manual"]);
var ImplementationEvidenceSchema = external_exports.object({
  id: IdSchema3,
  kind: ImplementationEvidenceKindSchema,
  command: NonEmptyStringSchema2,
  outcome: ImplementationEvidenceOutcomeSchema,
  summary: external_exports.string().optional(),
  artifactDigest: DigestSchema.optional(),
  recordedAt: DateTimeSchema
}).strict();
var ImplementationDeviationSchema = external_exports.object({
  id: IdSchema3,
  targetId: IdSchema3,
  summary: NonEmptyStringSchema2,
  impact: external_exports.enum(["none", "low", "medium", "high", "blocking"])
}).strict();
var ImplementationMapSchema = external_exports.object({
  contract: external_exports.literal(IMPLEMENTATION_MAP_CONTRACT),
  runId: IdSchema3,
  buildRequestDigest: DigestSchema,
  specDigest: DigestSchema,
  taskDigest: DigestSchema,
  producer: ImplementationProducerSchema,
  mappings: external_exports.array(ImplementationMappingSchema),
  evidence: external_exports.array(ImplementationEvidenceSchema),
  deviations: external_exports.array(ImplementationDeviationSchema),
  implementationMapDigest: DigestSchema,
  createdAt: DateTimeSchema
}).strict();
var ConvergenceStatusSchema = external_exports.enum([
  "unverified",
  "implemented",
  "verified",
  "diverged",
  "blocked",
  "manual"
]);
var ConvergenceSummarySchema = external_exports.object({
  unverified: external_exports.number().int().min(0),
  implemented: external_exports.number().int().min(0),
  verified: external_exports.number().int().min(0),
  diverged: external_exports.number().int().min(0),
  blocked: external_exports.number().int().min(0),
  manual: external_exports.number().int().min(0)
}).strict();
var ConvergenceItemSchema = external_exports.object({
  kind: ImplementationMappingKindSchema,
  targetId: IdSchema3,
  status: ConvergenceStatusSchema,
  mappingIds: external_exports.array(IdSchema3),
  evidenceIds: external_exports.array(IdSchema3),
  reason: NonEmptyStringSchema2
}).strict();
var ConvergenceSchema = external_exports.object({
  contract: external_exports.literal(CONVERGENCE_CONTRACT),
  runId: IdSchema3,
  specDigest: DigestSchema,
  taskDigest: DigestSchema,
  buildRequestDigest: DigestSchema,
  implementationMapDigest: DigestSchema,
  calculatedBy: external_exports.object({
    name: external_exports.literal("groundwork"),
    version: NonEmptyStringSchema2
  }).strict(),
  summary: ConvergenceSummarySchema,
  items: external_exports.array(ConvergenceItemSchema),
  calculatedAt: DateTimeSchema
}).strict();
var ExchangeValidationError = class extends Error {
  issues;
  constructor(issues) {
    super(issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`).join("\n"));
    this.name = "ExchangeValidationError";
    this.issues = issues.map((issue) => ({ ...issue, path: [...issue.path] }));
  }
};
function normalizeJsonValue(value, path5, ancestors) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${formatPath(path5)} must be a finite JSON number.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`${formatPath(path5)} contains a circular JSON value.`);
    const nextAncestors = new Set(ancestors).add(value);
    return value.map((entry, index) => normalizeJsonValue(entry, [...path5, index], nextAncestors));
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError(`${formatPath(path5)} contains a circular JSON value.`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${formatPath(path5)} must contain only plain JSON objects.`);
    }
    const nextAncestors = new Set(ancestors).add(value);
    const record2 = value;
    return Object.fromEntries(
      Object.keys(record2).sort().map((key) => [
        key,
        normalizeJsonValue(record2[key], [...path5, key], nextAncestors)
      ])
    );
  }
  throw new TypeError(`${formatPath(path5)} contains unsupported JSON value ${typeof value}.`);
}
function normalizeJson(value) {
  return JSON.stringify(normalizeJsonValue(value, [], /* @__PURE__ */ new Set()));
}
function digestNormalizedJson(value) {
  return `sha256:${createHash("sha256").update(normalizeJson(value), "utf8").digest("hex")}`;
}
function calculateSpecDigest(canonicalSpec) {
  return digestNormalizedJson(canonicalSpec);
}
function calculateTaskDigest(tasks2) {
  return digestNormalizedJson(tasks2);
}
function calculateBuildRequestDigest(request) {
  const projection = { ...request };
  delete projection.requestDigest;
  return digestNormalizedJson(projection);
}
function calculateImplementationMapDigest(implementationMap) {
  const projection = { ...implementationMap };
  delete projection.implementationMapDigest;
  return digestNormalizedJson(projection);
}
function bindBuildRequest(draft, canonicalSpec) {
  const withBindings = BuildRequestSchema.parse({
    ...draft,
    specDigest: calculateSpecDigest(canonicalSpec),
    taskDigest: calculateTaskDigest(draft.tasks),
    requestDigest: EMPTY_DIGEST
  });
  const request = BuildRequestSchema.parse({
    ...withBindings,
    requestDigest: calculateBuildRequestDigest(withBindings)
  });
  return validateBuildRequest(request, canonicalSpec);
}
function validateBuildRequest(request, canonicalSpec) {
  const parsed = BuildRequestSchema.parse(request);
  const issues = validateRequestEnvelope(parsed);
  if (parsed.specDigest !== calculateSpecDigest(canonicalSpec)) {
    issues.push({ path: ["specDigest"], message: "specDigest does not match the normalized canonical Spec." });
  }
  throwIfIssues(issues);
  return parsed;
}
function validateImplementationMap(requestInput, implementationMapInput) {
  const request = BuildRequestSchema.parse(requestInput);
  const implementationMap = ImplementationMapSchema.parse(implementationMapInput);
  const issues = validateRequestEnvelope(request);
  if (implementationMap.runId !== request.runId) {
    issues.push({ path: ["runId"], message: `Expected runId ${request.runId}.` });
  }
  if (implementationMap.buildRequestDigest !== request.requestDigest) {
    issues.push({ path: ["buildRequestDigest"], message: "Return is not bound to this build request digest." });
  }
  if (implementationMap.specDigest !== request.specDigest) {
    issues.push({ path: ["specDigest"], message: "Return specDigest does not match the request." });
  }
  if (implementationMap.taskDigest !== request.taskDigest) {
    issues.push({ path: ["taskDigest"], message: "Return taskDigest does not match the request." });
  }
  if (implementationMap.implementationMapDigest !== calculateImplementationMapDigest(implementationMap)) {
    issues.push({ path: ["implementationMapDigest"], message: "implementationMapDigest does not match its normalized self-digest projection." });
  }
  const requestCreated = Date.parse(request.createdAt);
  const mapCreated = Date.parse(implementationMap.createdAt);
  if (mapCreated < requestCreated) {
    issues.push({ path: ["createdAt"], message: "Implementation map predates its build request." });
  }
  addDuplicateIdIssues(implementationMap.mappings, "mappings", issues);
  addDuplicateIdIssues(implementationMap.evidence, "evidence", issues);
  addDuplicateIdIssues(implementationMap.deviations, "deviations", issues);
  const evidenceById = new Map(implementationMap.evidence.map((evidence) => [evidence.id, evidence]));
  const deviationById = new Map(implementationMap.deviations.map((deviation) => [deviation.id, deviation]));
  const intendedTargets = collectIntendedTargets(request);
  implementationMap.evidence.forEach((evidence, evidenceIndex) => {
    const recordedAt = Date.parse(evidence.recordedAt);
    if (recordedAt < requestCreated || recordedAt > mapCreated) {
      issues.push({
        path: ["evidence", evidenceIndex, "recordedAt"],
        message: "Evidence timestamp must fall between the request and implementation-map timestamps."
      });
    }
    for (const [field, value] of [["command", evidence.command], ["summary", evidence.summary]]) {
      if (value) addSensitiveTextIssues(value, ["evidence", evidenceIndex, field], issues);
    }
  });
  implementationMap.deviations.forEach((deviation, deviationIndex) => {
    if (!targetExists(intendedTargets, deviation.targetId)) {
      issues.push({ path: ["deviations", deviationIndex, "targetId"], message: `Unknown intended target ${deviation.targetId}.` });
    }
    addSensitiveTextIssues(deviation.summary, ["deviations", deviationIndex, "summary"], issues);
  });
  implementationMap.mappings.forEach((mapping, mappingIndex) => {
    const mappingPath = ["mappings", mappingIndex];
    if (!intendedTargets[mapping.kind].has(mapping.targetId)) {
      issues.push({
        path: [...mappingPath, "targetId"],
        message: `Unknown ${mapping.kind} target ${mapping.targetId}.`
      });
    }
    addDuplicateValueIssues(mapping.fileRefs, [...mappingPath, "fileRefs"], issues);
    addDuplicateValueIssues(mapping.symbolRefs, [...mappingPath, "symbolRefs"], issues);
    addDuplicateValueIssues(mapping.commitRefs, [...mappingPath, "commitRefs"], issues);
    addDuplicateValueIssues(mapping.testEvidenceIds, [...mappingPath, "testEvidenceIds"], issues);
    addDuplicateValueIssues(mapping.runtimeEvidenceIds, [...mappingPath, "runtimeEvidenceIds"], issues);
    addDuplicateValueIssues(mapping.deviationIds ?? [], [...mappingPath, "deviationIds"], issues);
    mapping.fileRefs.forEach((fileRef, fileIndex) => {
      const reason = evidencePathRejectionReason(fileRef);
      if (reason) issues.push({ path: [...mappingPath, "fileRefs", fileIndex], message: reason });
    });
    mapping.symbolRefs.forEach((symbol, symbolIndex) => {
      addSensitiveTextIssues(symbol, [...mappingPath, "symbolRefs", symbolIndex], issues);
    });
    const referencedEvidence = [];
    mapping.testEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        issues.push({ path: [...mappingPath, "testEvidenceIds", evidenceIndex], message: `Unknown evidence ${evidenceId}.` });
      } else if (evidence.kind !== "test") {
        issues.push({ path: [...mappingPath, "testEvidenceIds", evidenceIndex], message: `Evidence ${evidenceId} is ${evidence.kind}, not test evidence.` });
      } else {
        referencedEvidence.push(evidence);
      }
    });
    mapping.runtimeEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        issues.push({ path: [...mappingPath, "runtimeEvidenceIds", evidenceIndex], message: `Unknown evidence ${evidenceId}.` });
      } else if (evidence.kind !== "runtime") {
        issues.push({ path: [...mappingPath, "runtimeEvidenceIds", evidenceIndex], message: `Evidence ${evidenceId} is ${evidence.kind}, not runtime evidence.` });
      } else {
        referencedEvidence.push(evidence);
      }
    });
    const codeEvidence = hasCodeEvidence(mapping);
    const passingVerification = referencedEvidence.some((evidence) => evidence.outcome === "passed");
    const evidenceRefs = mapping.testEvidenceIds.length > 0 || mapping.runtimeEvidenceIds.length > 0;
    const deviationRefs = (mapping.deviationIds ?? []).length > 0;
    if (mapping.status === "not-started" && (codeEvidence || evidenceRefs || deviationRefs)) {
      issues.push({
        path: [...mappingPath, "status"],
        message: "not-started must not include code, verification evidence, or deviations."
      });
    }
    if ((mapping.status === "implemented" || mapping.status === "verified") && !codeEvidence) {
      issues.push({ path: [...mappingPath, "status"], message: `${mapping.status} requires mapped code evidence.` });
    }
    if (mapping.status === "implemented" && passingVerification) {
      issues.push({
        path: [...mappingPath, "status"],
        message: "implemented must not include passing test or runtime evidence; use verified."
      });
    }
    if (mapping.status === "verified" && !passingVerification) {
      issues.push({ path: [...mappingPath, "status"], message: "verified requires passing test or runtime evidence." });
    }
    const deviations = (mapping.deviationIds ?? []).map((deviationId, deviationIndex) => {
      const deviation = deviationById.get(deviationId);
      if (!deviation) {
        issues.push({ path: [...mappingPath, "deviationIds", deviationIndex], message: `Unknown deviation ${deviationId}.` });
      } else if (deviation.targetId !== mapping.targetId) {
        issues.push({ path: [...mappingPath, "deviationIds", deviationIndex], message: `Deviation ${deviationId} targets ${deviation.targetId}, not ${mapping.targetId}.` });
      }
      return deviation;
    }).filter((deviation) => Boolean(deviation));
    if (mapping.status === "diverged" && deviations.length === 0) {
      issues.push({ path: [...mappingPath, "status"], message: "diverged requires a declared deviation for the mapped target." });
    }
  });
  throwIfIssues(issues);
  return implementationMap;
}
function calculateConvergence(requestInput, implementationMapInput, options) {
  const request = BuildRequestSchema.parse(requestInput);
  const implementationMap = validateImplementationMap(request, implementationMapInput);
  if (!options.groundworkVersion) throw new TypeError("groundworkVersion must be non-empty.");
  DateTimeSchema.parse(options.calculatedAt);
  if (Date.parse(options.calculatedAt) < Date.parse(implementationMap.createdAt)) {
    throw new ExchangeValidationError([{ path: ["calculatedAt"], message: "Convergence cannot predate the implementation map." }]);
  }
  const evidenceById = new Map(implementationMap.evidence.map((evidence) => [evidence.id, evidence]));
  const mappingsByTarget = /* @__PURE__ */ new Map();
  implementationMap.mappings.forEach((mapping) => {
    const key = targetKey(mapping.kind, mapping.targetId);
    const values = mappingsByTarget.get(key) ?? [];
    values.push(mapping);
    mappingsByTarget.set(key, values);
  });
  const deviationsByTarget = /* @__PURE__ */ new Map();
  implementationMap.deviations.forEach((deviation) => {
    const values = deviationsByTarget.get(deviation.targetId) ?? [];
    values.push(deviation);
    deviationsByTarget.set(deviation.targetId, values);
  });
  const intendedTargets = collectIntendedTargets(request);
  const kindOrder = ["task", "component", "contract", "requirement"];
  const items = [];
  kindOrder.forEach((kind) => {
    [...intendedTargets[kind]].sort().forEach((targetId) => {
      const mappings = [...mappingsByTarget.get(targetKey(kind, targetId)) ?? []].sort((left, right) => left.id.localeCompare(right.id));
      const deviations = deviationsByTarget.get(targetId) ?? [];
      const evidenceIds = [...new Set(mappings.flatMap((mapping) => [
        ...mapping.testEvidenceIds,
        ...mapping.runtimeEvidenceIds
      ]))].sort();
      const { status, reason } = deriveConvergenceStatus(mappings, deviations, evidenceById);
      items.push({
        kind,
        targetId,
        status,
        mappingIds: mappings.map((mapping) => mapping.id),
        evidenceIds,
        reason
      });
    });
  });
  const summary = {
    unverified: 0,
    implemented: 0,
    verified: 0,
    diverged: 0,
    blocked: 0,
    manual: 0
  };
  items.forEach((item) => {
    summary[item.status] += 1;
  });
  return ConvergenceSchema.parse({
    contract: CONVERGENCE_CONTRACT,
    runId: request.runId,
    specDigest: request.specDigest,
    taskDigest: request.taskDigest,
    buildRequestDigest: request.requestDigest,
    implementationMapDigest: implementationMap.implementationMapDigest,
    calculatedBy: { name: "groundwork", version: options.groundworkVersion },
    summary,
    items,
    calculatedAt: options.calculatedAt
  });
}
function validateRequestEnvelope(request) {
  const issues = [];
  if (!request.returnVersions.implementationMap.includes(IMPLEMENTATION_MAP_CONTRACT)) {
    issues.push({ path: ["returnVersions", "implementationMap"], message: `Unsupported implementation-map versions.` });
  }
  if (!request.returnVersions.convergence.includes(CONVERGENCE_CONTRACT)) {
    issues.push({ path: ["returnVersions", "convergence"], message: `Unsupported convergence versions.` });
  }
  if (request.taskDigest !== calculateTaskDigest(request.tasks)) {
    issues.push({ path: ["taskDigest"], message: "taskDigest does not match the final ordered task list." });
  }
  if (request.requestDigest !== calculateBuildRequestDigest(request)) {
    issues.push({ path: ["requestDigest"], message: "requestDigest does not match its normalized self-digest projection." });
  }
  addDuplicateIdIssues(request.tasks, "tasks", issues);
  addDuplicateIdIssues(request.acceptanceCriteria, "acceptanceCriteria", issues);
  addDuplicateIdIssues(request.manualActions, "manualActions", issues);
  addCrossKindTargetIdIssues(request, issues);
  const taskIds = new Set(request.tasks.map((task) => task.id));
  const taskPositions = /* @__PURE__ */ new Map();
  request.tasks.forEach((task, taskIndex) => {
    if (!taskPositions.has(task.id)) taskPositions.set(task.id, taskIndex);
  });
  const acceptanceIds = new Set(request.acceptanceCriteria.map((criterion) => criterion.id));
  const localComponentIds = new Set(request.architecture.components.map((component) => component.id));
  const localContractIds = new Set(request.architecture.contracts.map((contract) => contract.id));
  const dependencySpecIds = new Set(request.architecture.specDependencies.map((dependency) => dependency.specId));
  request.tasks.forEach((task, taskIndex) => {
    addDuplicateValueIssues(task.dependsOn, ["tasks", taskIndex, "dependsOn"], issues);
    addDuplicateValueIssues(task.requirementIds, ["tasks", taskIndex, "requirementIds"], issues);
    addDuplicateValueIssues(task.acceptanceCriterionIds, ["tasks", taskIndex, "acceptanceCriterionIds"], issues);
    addDuplicateValueIssues(task.componentRefs.map(qualifiedRefIdentity), ["tasks", taskIndex, "componentRefs"], issues);
    addDuplicateValueIssues(task.contractRefs.map(qualifiedRefIdentity), ["tasks", taskIndex, "contractRefs"], issues);
    task.dependsOn.forEach((dependencyId, dependencyIndex) => {
      const dependencyPosition = taskPositions.get(dependencyId);
      if (!taskIds.has(dependencyId) || dependencyPosition === void 0) {
        issues.push({ path: ["tasks", taskIndex, "dependsOn", dependencyIndex], message: `Unknown task dependency ${dependencyId}.` });
      } else if (dependencyPosition >= taskIndex) {
        issues.push({
          path: ["tasks", taskIndex, "dependsOn", dependencyIndex],
          message: `Task dependency ${dependencyId} must precede ${task.id} in the final ordered task list.`
        });
      }
    });
    task.acceptanceCriterionIds.forEach((criterionId, criterionIndex) => {
      if (!acceptanceIds.has(criterionId)) {
        issues.push({ path: ["tasks", taskIndex, "acceptanceCriterionIds", criterionIndex], message: `Unknown acceptance criterion ${criterionId}.` });
      }
    });
    task.componentRefs.forEach((ref2, refIndex) => {
      validateTaskRef(ref2, "component", request.specId, localComponentIds, dependencySpecIds, ["tasks", taskIndex, "componentRefs", refIndex], issues);
    });
    task.contractRefs.forEach((ref2, refIndex) => {
      validateTaskRef(ref2, "contract", request.specId, localContractIds, dependencySpecIds, ["tasks", taskIndex, "contractRefs", refIndex], issues);
    });
  });
  return issues;
}
function addCrossKindTargetIdIssues(request, issues) {
  const seen = /* @__PURE__ */ new Map();
  const targets = [
    ...request.tasks.map((task, index) => ({ id: task.id, kind: "task", path: ["tasks", index, "id"] })),
    ...request.architecture.components.map((component, index) => ({
      id: component.id,
      kind: "component",
      path: ["architecture", "components", index, "id"]
    })),
    ...request.architecture.contracts.map((contract, index) => ({
      id: contract.id,
      kind: "contract",
      path: ["architecture", "contracts", index, "id"]
    })),
    ...request.tasks.flatMap((task, taskIndex) => task.requirementIds.map((id, requirementIndex) => ({
      id,
      kind: "requirement",
      path: ["tasks", taskIndex, "requirementIds", requirementIndex]
    })))
  ];
  targets.forEach((target) => {
    const firstKind = seen.get(target.id);
    if (!firstKind) {
      seen.set(target.id, target.kind);
    } else if (firstKind !== target.kind) {
      issues.push({
        path: target.path,
        message: `Target ID ${target.id} is reused across ${firstKind} and ${target.kind} kinds; intended target IDs must be globally unique across kinds.`
      });
    }
  });
}
function validateTaskRef(ref2, expectedKind, specId, localIds, dependencySpecIds, path5, issues) {
  if (ref2.kind !== expectedKind) {
    issues.push({ path: [...path5, "kind"], message: `Expected ${expectedKind} reference, received ${ref2.kind}.` });
  }
  if (ref2.specId === specId && !localIds.has(ref2.id)) {
    issues.push({ path: path5, message: `Unknown local ${expectedKind} ${ref2.id}.` });
  }
  if (ref2.specId !== specId && !dependencySpecIds.has(ref2.specId)) {
    issues.push({ path: [...path5, "specId"], message: `Remote reference has no declared Spec dependency for ${ref2.specId}.` });
  }
}
function collectIntendedTargets(request) {
  return {
    task: new Set(request.tasks.map((task) => task.id)),
    component: new Set(request.architecture.components.map((component) => component.id)),
    contract: new Set(request.architecture.contracts.map((contract) => contract.id)),
    requirement: new Set(request.tasks.flatMap((task) => task.requirementIds))
  };
}
function targetExists(targets, targetId) {
  return Object.values(targets).some((values) => values.has(targetId));
}
function targetKey(kind, targetId) {
  return `${kind}:${targetId}`;
}
function hasCodeEvidence(mapping) {
  return mapping.fileRefs.length > 0 || mapping.symbolRefs.length > 0 || mapping.commitRefs.length > 0;
}
function deriveConvergenceStatus(mappings, deviations, evidenceById) {
  if (mappings.some((mapping) => mapping.status === "manual")) {
    return { status: "manual", reason: "Build Loop declared the intended entity manual." };
  }
  if (mappings.some((mapping) => mapping.status === "blocked")) {
    return { status: "blocked", reason: "Build Loop declared the intended entity blocked." };
  }
  if (deviations.length > 0 || mappings.some((mapping) => mapping.status === "diverged")) {
    return { status: "diverged", reason: "Build Loop declared a deviation from the intended entity." };
  }
  const codeMappings = mappings.filter(hasCodeEvidence);
  if (codeMappings.length === 0) {
    return { status: "unverified", reason: "No mapped code evidence was returned." };
  }
  const hasPassingVerification = codeMappings.some((mapping) => [
    ...mapping.testEvidenceIds,
    ...mapping.runtimeEvidenceIds
  ].some((evidenceId) => evidenceById.get(evidenceId)?.outcome === "passed"));
  if (hasPassingVerification) {
    return { status: "verified", reason: "Mapped code includes passing test or runtime evidence." };
  }
  return { status: "implemented", reason: "Mapped code was returned without passing test or runtime evidence." };
}
function addDuplicateIdIssues(values, collection, issues) {
  const seen = /* @__PURE__ */ new Map();
  values.forEach((value, index) => {
    const firstIndex = seen.get(value.id);
    if (firstIndex !== void 0) {
      issues.push({ path: [collection, index, "id"], message: `Duplicate ID ${value.id}; first declared at ${collection}.${firstIndex}.id.` });
    } else {
      seen.set(value.id, index);
    }
  });
}
function addDuplicateValueIssues(values, path5, issues) {
  const seen = /* @__PURE__ */ new Set();
  values.forEach((value, index) => {
    if (seen.has(value)) issues.push({ path: [...path5, index], message: `Duplicate value ${value}.` });
    seen.add(value);
  });
}
function evidencePathRejectionReason(value) {
  if (!value || value.includes("\0")) return "Evidence path must be a non-empty repository-relative path.";
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\") || value.startsWith("~")) {
    return "Evidence path must not be absolute or home-relative.";
  }
  if (value.includes("\\")) return "Evidence paths must use repository-relative forward slashes.";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return "Evidence path must not be a URL or URI.";
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "Evidence path contains invalid percent encoding.";
  }
  if (decoded.includes("\\")) return "Evidence paths must use repository-relative forward slashes.";
  const segments = decoded.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return "Evidence path must not contain empty, current-directory, or traversal segments.";
  }
  const privateSegments = /* @__PURE__ */ new Set([".git", ".ssh", ".aws", ".gnupg", ".env", "secrets", "credentials"]);
  const privateNames = /^(?:credentials(?:\.[^.]+)?|secrets?(?:\.[^.]+)?|id_(?:rsa|dsa|ecdsa|ed25519))$/i;
  if (segments.some((segment) => {
    const lower = segment.toLowerCase();
    const privateEnv = lower.startsWith(".env.") && lower !== ".env.example";
    return privateSegments.has(lower) || privateEnv || privateNames.test(segment);
  })) {
    return "Evidence path points to a private or credential-bearing location.";
  }
  return void 0;
}
function addSensitiveTextIssues(value, path5, issues) {
  if (containsCredentialBearingUrl2(value)) {
    issues.push({ path: path5, message: "Credential-bearing URLs are not valid implementation evidence." });
  }
  if (containsAbsolutePrivatePath(value)) {
    issues.push({ path: path5, message: "Absolute private paths are not valid implementation evidence." });
  }
}
function containsCredentialBearingUrl2(value) {
  const candidates = value.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g) ?? [];
  return candidates.some((candidate) => {
    const cleaned = candidate.replace(/[),.;!?]+$/, "");
    try {
      const url = new URL(cleaned);
      if (url.username || url.password) return true;
      for (const key of url.searchParams.keys()) {
        if (/(?:token|secret|password|passwd|api[-_]?key|credential|signature|access[-_]?key)/i.test(key)) return true;
      }
      return false;
    } catch {
      return true;
    }
  });
}
function containsAbsolutePrivatePath(value) {
  return /(?:^|[\s"'(])(?:\/(?:Users|home|root|var\/folders)\/[^\s"')]+|[A-Za-z]:\\Users\\[^\s"')]+)/i.test(value);
}
function throwIfIssues(issues) {
  if (issues.length === 0) return;
  issues.sort((left, right) => formatPath(left.path).localeCompare(formatPath(right.path)) || left.message.localeCompare(right.message));
  throw new ExchangeValidationError(issues);
}
function formatPath(path5) {
  return path5.length ? path5.join(".") : "$";
}

// engine/src/graph.ts
var MAX_SPEC_BYTES = 2 * 1024 * 1024;
var MAX_MANIFEST_BYTES = 256 * 1024;
function safeRelativeSpecPath(value) {
  return Boolean(value) && !path.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}
function inside(root, candidate) {
  const relative3 = path.relative(root, candidate);
  return relative3 === "" || !relative3.startsWith("..") && !path.isAbsolute(relative3);
}
function readSafeRegularFile(file, maxBytes, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file.`);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
  return fs.readFileSync(file, "utf8");
}
function verifyDependencyManifest(file, dependency, rawText) {
  if (path.basename(file) !== "spec.json") {
    throw new Error(`Local Spec dependency ${dependency.id} must point to an atomic Groundwork spec.json artifact.`);
  }
  const manifestPath = path.join(path.dirname(file), "artifact-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Local Spec dependency ${dependency.id} is missing artifact-manifest.json.`);
  }
  const manifest = JSON.parse(readSafeRegularFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    `Manifest for dependency ${dependency.id}`
  ));
  if (manifest.schema !== "groundwork.artifacts/v1" || manifest.generationId !== dependency.revision) {
    throw new Error(`Local Spec dependency ${dependency.id} revision does not match its artifact manifest.`);
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const entry = files.find((item) => item && typeof item === "object" && item.name === "spec.json");
  const contentHash = crypto.createHash("sha256").update(rawText, "utf8").digest("hex");
  if (!entry || entry.sha256 !== contentHash) {
    throw new Error(`Local Spec dependency ${dependency.id} does not match its manifest content hash.`);
  }
}
function architectureRefsForSpec(spec) {
  return [
    ...spec.architecture.contracts.flatMap((contract) => [
      contract.provider,
      ...contract.consumers
    ]),
    ...spec.architecture.relationships.flatMap((relationship) => [
      relationship.from,
      relationship.to,
      ...relationship.contractRef ? [relationship.contractRef] : []
    ]),
    ...spec.architecture.flows.flatMap((flow) => flow.exchanges.flatMap((exchange) => [
      exchange.from,
      exchange.to,
      exchange.contractRef,
      ...exchange.inputRefs,
      ...exchange.outputRefs
    ])),
    ...["current", "proposed", "verified"].flatMap((bucket) => spec.changeSet[bucket].map((change) => change.target))
  ];
}
function declaredIdentities(spec) {
  return [
    ...spec.needs.map((item) => ({ specId: spec.id, kind: "requirement", id: item.id })),
    ...spec.features.map((item) => ({ specId: spec.id, kind: "feature", id: item.id })),
    ...spec.screens.flatMap((screen) => [
      { specId: spec.id, kind: "screen", id: screen.id },
      ...(screen.elements ?? []).map((element) => ({ specId: spec.id, kind: "element", id: element.id }))
    ]),
    ...spec.architecture.components.map((item) => ({ specId: spec.id, kind: "component", id: item.id })),
    ...spec.architecture.contracts.map((item) => ({ specId: spec.id, kind: "contract", id: item.id })),
    ...spec.architecture.flows.map((item) => ({ specId: spec.id, kind: "flow", id: item.id }))
  ];
}
function validateResolvedReferences(specs) {
  const known = new Set(specs.flatMap(declaredIdentities).map(qualifiedRefIdentity));
  for (const spec of specs) {
    for (const ref2 of architectureRefsForSpec(spec)) {
      if (!known.has(qualifiedRefIdentity(ref2))) {
        throw new Error(`Resolved architecture contains unknown reference: ${qualifiedRefIdentity(ref2)}`);
      }
    }
  }
}
function hardRelationshipEdges(specs) {
  const edges = [];
  for (const spec of specs) {
    for (const relationship of spec.architecture.relationships) {
      if (relationship.criticality !== "hard") continue;
      edges.push({ from: relationship.from, to: relationship.to, id: relationship.id });
      if (relationship.direction === "bidirectional") {
        edges.push({ from: relationship.to, to: relationship.from, id: relationship.id });
      }
    }
  }
  return edges;
}
function validateCombinedHardCycles(specs) {
  const edges = hardRelationshipEdges(specs);
  const adjacency = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const from = qualifiedRefIdentity(edge.from);
    const to = qualifiedRefIdentity(edge.to);
    adjacency.set(from, [...adjacency.get(from) ?? [], to]);
  }
  adjacency.forEach((values, key) => adjacency.set(key, [...new Set(values)].sort()));
  const state = /* @__PURE__ */ new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, "visiting");
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      if (state.get(next) === "visiting") {
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(id, "visited");
    return void 0;
  };
  for (const id of [...adjacency.keys()].sort()) {
    if (state.has(id)) continue;
    const cycle = visit(id);
    if (cycle) throw new Error(`Cross-Spec hard dependency cycle: ${cycle.join(" -> ")}`);
  }
}
function resolveSpecGraph(root, options = {}) {
  const dependencies = root.architecture.specDependencies;
  if (!dependencies.length) return { root, dependencies: [] };
  if (!options.sourcePath) throw new Error("Local Spec dependencies require a file source; stdin cannot establish their base path.");
  const allowedRoots = (options.allowedRoots ?? []).map((entry) => {
    const absolute = path.resolve(entry);
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Allowed Spec root is not a regular directory: ${absolute}`);
    return fs.realpathSync(absolute);
  });
  if (!allowedRoots.length) throw new Error("Local Spec dependencies require at least one explicit --allow-spec-root.");
  const maxSpecBytes = options.maxSpecBytes ?? MAX_SPEC_BYTES;
  const bySpecId = /* @__PURE__ */ new Map([
    [root.id, { digest: "<root>", spec: root, packet: root }]
  ]);
  const resolved = [];
  const visiting = /* @__PURE__ */ new Set();
  const loadFrom = (owner, ownerFile) => {
    for (const dependency of [...owner.architecture.specDependencies].sort((a, b) => a.id.localeCompare(b.id))) {
      if (dependency.specId === root.id) {
        throw new Error(`Spec dependency ${dependency.id} cyclically targets the root Spec ${root.id}.`);
      }
      if (dependency.location.kind === "uri") {
        throw new Error(`Spec dependency ${dependency.id} uses a URI; Groundwork is offline and no resolver was approved.`);
      }
      const declaredPath = dependency.location.path;
      if (!safeRelativeSpecPath(declaredPath)) {
        throw new Error(`Spec dependency ${dependency.id} path must be a traversal-free relative POSIX path.`);
      }
      const candidate = path.resolve(path.dirname(ownerFile), declaredPath);
      if (!fs.existsSync(candidate)) throw new Error(`Spec dependency ${dependency.id} is missing: ${declaredPath}`);
      const candidateStat = fs.lstatSync(candidate);
      if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
        throw new Error(`Spec dependency ${dependency.id} must be a regular, non-symlink file.`);
      }
      const realCandidate = fs.realpathSync(candidate);
      if (!allowedRoots.some((allowedRoot) => inside(allowedRoot, realCandidate))) {
        throw new Error(`Spec dependency ${dependency.id} escapes the explicit allowed roots.`);
      }
      const rawText = readSafeRegularFile(realCandidate, maxSpecBytes, `Spec dependency ${dependency.id}`);
      verifyDependencyManifest(realCandidate, dependency, rawText);
      let packet;
      try {
        packet = JSON.parse(rawText);
      } catch (error) {
        throw new Error(`Spec dependency ${dependency.id} is not valid JSON: ${error.message}`);
      }
      const rawVersion = packet && typeof packet === "object" && !Array.isArray(packet) ? packet.schemaVersion : void 0;
      if (dependency.schemaVersion !== 3 || rawVersion !== 3) {
        throw new Error(`Spec dependency ${dependency.id} must pin an unmigrated Spec v3 packet.`);
      }
      const spec = SpecSchema.parse(packet);
      if (spec.id !== dependency.specId) {
        throw new Error(`Spec dependency ${dependency.id} expected ${dependency.specId}, received ${spec.id}.`);
      }
      const digest = calculateSpecDigest(packet);
      if (digest !== dependency.digest) {
        throw new Error(`Spec dependency ${dependency.id} digest mismatch.`);
      }
      const prior = bySpecId.get(spec.id);
      if (prior && prior.digest !== "<root>" && prior.digest !== digest) {
        throw new Error(`Spec ${spec.id} resolves to conflicting digests.`);
      }
      if (!prior) {
        bySpecId.set(spec.id, { digest, spec, packet });
        resolved.push({
          dependencyId: dependency.id,
          declaredBySpecId: owner.id,
          declaredPath,
          revision: dependency.revision,
          digest,
          spec,
          canonicalPacket: packet
        });
      }
      const visitKey = `${owner.id}:${dependency.id}`;
      if (visiting.has(visitKey)) throw new Error(`Spec dependency declaration cycle at ${visitKey}.`);
      if (!prior) {
        visiting.add(visitKey);
        loadFrom(spec, realCandidate);
        visiting.delete(visitKey);
      }
    }
  };
  loadFrom(root, path.resolve(options.sourcePath));
  const specs = [root, ...resolved.map((entry) => entry.spec)];
  validateResolvedReferences(specs);
  validateCombinedHardCycles(specs);
  return { root, dependencies: resolved.sort((a, b) => a.spec.id.localeCompare(b.spec.id)) };
}
function taskIdsForComponent(spec, tasks2, ref2) {
  if (ref2.kind !== "component") return [];
  if (ref2.specId !== spec.id) {
    return tasks2.filter((task) => task.layer === "dependency" && task.satisfies.includes(ref2.specId)).map((task) => task.id);
  }
  const component = spec.architecture.components.find((item) => item.id === ref2.id);
  if (!component) return [];
  const componentTasks = tasks2.filter((task) => task.layer === "component" && task.satisfies.includes(component.id));
  if (componentTasks.length) return componentTasks.map((task) => task.id);
  return tasks2.filter((task) => task.layer === "feature" && component.featureIds.some((featureId) => task.satisfies.includes(featureId))).map((task) => task.id);
}
function compareTaskFallback(left, right) {
  return left.n - right.n || left.id.localeCompare(right.id);
}
function compileTaskGraph(spec, inputTasks) {
  const tasks2 = inputTasks.map((task) => ({ ...task, deps: [...task.deps] }));
  const byOldNumber = new Map(tasks2.map((task) => [task.n, task.id]));
  const byId = new Map(tasks2.map((task) => [task.id, task]));
  const dependencies = new Map(
    tasks2.map((task) => [task.id, new Set(task.deps.map((number) => byOldNumber.get(number)).filter((id) => Boolean(id)))])
  );
  for (const relationship of spec.architecture.relationships) {
    if (relationship.criticality !== "hard") continue;
    const contract = relationship.contractRef?.specId === spec.id ? spec.architecture.contracts.find((candidate) => candidate.id === relationship.contractRef?.id) : void 0;
    const providerRefs = contract ? [contract.provider] : [relationship.from];
    const consumerRefs = contract ? contract.consumers : [relationship.to];
    const providers = [...new Set(providerRefs.flatMap((ref2) => taskIdsForComponent(spec, tasks2, ref2)))];
    const consumers = [...new Set(consumerRefs.flatMap((ref2) => taskIdsForComponent(spec, tasks2, ref2)))];
    for (const consumer of consumers) {
      for (const provider of providers) {
        if (provider !== consumer) dependencies.get(consumer)?.add(provider);
      }
    }
  }
  const outgoing = new Map(tasks2.map((task) => [task.id, /* @__PURE__ */ new Set()]));
  const indegree = new Map(tasks2.map((task) => [task.id, dependencies.get(task.id)?.size ?? 0]));
  dependencies.forEach((providers, consumer) => providers.forEach((provider) => {
    if (!byId.has(provider)) throw new Error(`Task ${consumer} depends on unknown task ${provider}.`);
    outgoing.get(provider)?.add(consumer);
  }));
  const ready = tasks2.filter((task) => indegree.get(task.id) === 0).sort(compareTaskFallback);
  const ordered = [];
  while (ready.length) {
    const task = ready.shift();
    ordered.push(task);
    for (const consumer of [...outgoing.get(task.id) ?? []].sort()) {
      indegree.set(consumer, (indegree.get(consumer) ?? 0) - 1);
      if (indegree.get(consumer) === 0) {
        ready.push(byId.get(consumer));
        ready.sort(compareTaskFallback);
      }
    }
  }
  if (ordered.length !== tasks2.length) {
    const blocked = tasks2.filter((task) => !ordered.some((item) => item.id === task.id)).map((task) => task.id).sort();
    throw new Error(`Task dependency cycle: ${blocked.join(" -> ")}`);
  }
  const newNumber = new Map(ordered.map((task, index) => [task.id, index + 1]));
  return ordered.map((task, index) => ({
    ...task,
    n: index + 1,
    deps: [...dependencies.get(task.id) ?? []].map((id) => newNumber.get(id)).sort((a, b) => a - b)
  }));
}
function refsForTask(spec, task) {
  const refs = /* @__PURE__ */ new Map();
  const directContractRefs = /* @__PURE__ */ new Map();
  for (const component of spec.architecture.components) {
    const ownsComponent = task.layer === "component" ? task.satisfies.includes(component.id) : component.featureIds.some((featureId) => task.satisfies.includes(featureId));
    if (ownsComponent) {
      const ref2 = { specId: spec.id, kind: "component", id: component.id };
      refs.set(qualifiedRefIdentity(ref2), ref2);
    }
  }
  if (task.layer === "dependency") {
    for (const ref2 of architectureRefsForSpec(spec)) {
      if (ref2.specId === spec.id || !task.satisfies.includes(ref2.specId)) continue;
      if (ref2.kind === "component") refs.set(qualifiedRefIdentity(ref2), ref2);
      if (ref2.kind === "contract") directContractRefs.set(qualifiedRefIdentity(ref2), ref2);
    }
  }
  for (const contract of spec.architecture.contracts) {
    if (!task.satisfies.includes(contract.id)) continue;
    for (const ref2 of [contract.provider, ...contract.consumers]) {
      if (ref2.kind === "component") refs.set(qualifiedRefIdentity(ref2), ref2);
    }
  }
  const componentRefs = [...refs.values()].filter((ref2) => ref2.kind === "component").sort((a, b) => qualifiedRefIdentity(a).localeCompare(qualifiedRefIdentity(b)));
  const componentIds = new Set(componentRefs.map(qualifiedRefIdentity));
  const contractRefs = spec.architecture.contracts.filter((contract) => task.satisfies.includes(contract.id) || [
    contract.provider,
    ...contract.consumers
  ].some((ref2) => componentIds.has(qualifiedRefIdentity(ref2)))).map((contract) => ({ specId: spec.id, kind: "contract", id: contract.id }));
  contractRefs.push(...directContractRefs.values());
  for (const relationship of spec.architecture.relationships) {
    if (relationship.contractRef && componentRefs.some((ref2) => qualifiedRefIdentity(ref2) === qualifiedRefIdentity(relationship.from) || qualifiedRefIdentity(ref2) === qualifiedRefIdentity(relationship.to))) {
      contractRefs.push(relationship.contractRef);
    }
  }
  return {
    componentRefs,
    contractRefs: [...new Map(contractRefs.map((ref2) => [qualifiedRefIdentity(ref2), ref2])).values()].sort((a, b) => qualifiedRefIdentity(a).localeCompare(qualifiedRefIdentity(b)))
  };
}

// engine/src/handoff.ts
function renderTasks(spec, tasks2 = compileTaskGraph(spec, deriveTasks(spec))) {
  const sections = [];
  sections.push(renderHeader(spec, tasks2.length));
  sections.push(renderReadingContractSection(spec));
  sections.push(renderPrimeDirective(spec));
  sections.push(renderApproachLenses(spec));
  sections.push(renderReadsFromBoundary(spec));
  sections.push(renderThreatModel(spec));
  sections.push(renderActivationMap(spec));
  sections.push(renderPhaseAcceptance(spec, tasks2));
  sections.push(renderInvariantChecks(spec));
  if (tasks2.length === 0) {
    sections.push(
      "_No buildable units derived from this Spec (no data points, features, screens, API contracts, or tests). Capture at least one before handoff._"
    );
  } else {
    for (const t of tasks2) sections.push(renderTask(t, spec.platformTarget));
  }
  sections.push(renderTerminalGate(spec));
  sections.push(renderSpecCodeSyncSection(spec));
  sections.push(renderTraceabilityNote(tasks2));
  const joined = sections.filter((s) => s && s.trim().length > 0).join("\n\n");
  return scrubSecretShapedStrings(joined) + "\n";
}
function renderBuilderHandoff(spec, inputs) {
  const lines = [
    `# Builder handoff \u2014 ${spec.productName}`,
    "",
    "> Paste this single file into the AI coding tool working in the target repository.",
    "> The complete written Groundwork contract is embedded below; optional mockups",
    "> and design tokens may be attached when the visual flow produced them.",
    "> The embedded Canonical Spec and Traceability sections are authoritative copies;",
    "> no `spec.json`, `traceability.json`, or other unstated sidecar is required.",
    "",
    renderReadingContractSection(spec),
    "",
    "## Implementation directive",
    "",
    `Build **${spec.productName}** into a high-fidelity, near-production-ready ${PLATFORM_DISPLAY[spec.platformTarget]} result. Do not stop at scaffolding, static screens, or a partial happy path.`,
    "",
    renderPrimeDirective(spec),
    "",
    "## Read before editing",
    "",
    "Treat the embedded sections in this file as one contract, in this order:",
    "",
    "1. Canonical Spec \u2014 machine-readable source of truth.",
    "2. Steering \u2014 durable product, UI, voice, and operating boundaries.",
    "3. Requirements \u2014 users, jobs, scope, metrics, and acceptance criteria.",
    "4. Technical design \u2014 architecture, data, APIs, integrations, observability, and ADRs.",
    "5. UI design \u2014 screens, states, interactions, voice, and confirmed preferences.",
    "6. Implementation plan \u2014 dependency-ordered implementation and verification work.",
    "7. Traceability \u2014 requirement-to-screen-to-task-to-test coverage.",
    "8. Optional `design-tokens.md` and `mockups/` attachments \u2014 these can add visual evidence but are not required to understand this embedded contract. Preserve them when supplied. Read `mockups/.canvas/gallery-selections.json` first when present; every open element annotation is required UI feedback and must be implemented or explicitly dispositioned.",
    "",
    ...(spec.behaviorContracts?.length ?? 0) || spec.designContract ? [renderBehaviorAndBaselineContract(spec), ""] : [],
    "If code or current runtime behavior conflicts with these artifacts, verify the live state, preserve confirmed user decisions, and record the resolved delta instead of silently choosing one source.",
    "",
    renderDefinitionCompleteness(spec, inputs),
    "",
    "## Delivery contract",
    "",
    "- Implement every declared user flow, screen state, data path, API contract, validation branch, error state, loading state, empty state, and accessibility requirement.",
    "- Match the confirmed UI direction with production-quality responsive behavior; do not replace it with generic framework defaults.",
    "- Wire persistence, security boundaries, observability, and tests. Do not ship mock data, dead controls, placeholder copy, or fake integrations in user-facing paths.",
    "- Implement each external integration adapter, configuration reader, validation path, failure behavior, and testable boundary even when provider credentials are unavailable.",
    "- Leave manual only the external account, dashboard, credential, approval, callback-registration, or provider-console actions that an agent cannot perform locally.",
    "- Run the repo-native typecheck, test, build, and relevant live-flow verification after the final mutation.",
    "",
    renderManualIntegrations(spec),
    "",
    renderDataWireMap(spec),
    "",
    renderSpecCodeSyncSection(spec),
    "",
    "## Completion report",
    "",
    "Return the implemented flows, verification evidence, remaining assumptions, and an exact checklist for every manual integration action. For each manual action include where to perform it, the value or permission needed, where that value belongs in the app, and how to verify success.",
    "",
    renderEmbeddedContract(spec, inputs)
  ];
  return scrubSecretShapedStrings(lines.join("\n")) + "\n";
}
function renderBehaviorAndBaselineContract(spec) {
  const lines = ["## Behavior, baseline, and decision contract"];
  if (!(spec.behaviorContracts?.length ?? 0) && !spec.designContract) {
    lines.push("", "_No additive behavior or reproducibility contract declared; preserve the existing Spec v3 behavior._");
    return lines.join("\n");
  }
  for (const behavior of spec.behaviorContracts ?? []) {
    lines.push("", `### Behavior: ${behavior.name} (\`${behavior.id}\`)`, `- Trigger: ${behavior.trigger}`);
    for (const action of behavior.actions) lines.push(`- **${action.name}**: effects ${action.effects.map((effect) => effect.kind).join(", ") || "none"}; writes ${action.writes.map((write) => `${write.storeRef}/${write.entity}`).join(", ") || "none"}; prohibited ${action.prohibitedWrites.map((write) => `${write.storeRef}/${write.entity}`).join(", ") || "none"}.`);
  }
  if (spec.designContract) {
    const { baseline, direction, deltas, verification } = spec.designContract;
    lines.push("", `### Baseline: ${baseline.disposition}${baseline.id ? ` (\`${baseline.id}\`)` : ""}`, `- Contract intent: ${spec.designContract.intent?.type ?? "change"}`, `- Direction: ${direction.summary}`, `- Precedence: ${baseline.precedence.map((item) => `${item.rank}:${item.artifactId}`).join(", ") || "none"}`, `- Deltas: ${deltas.map((item) => item.id).join(", ") || "none"}`, `- Verification: ${verification.map((item) => item.id).join(", ") || "none"}`, "- Authoritative artifacts:", ...baseline.artifacts.map((artifact) => `  - \`${artifact.path}\` \u2014 ${artifact.type}; \`${artifact.digest}\``), "- Constraint checklist:", ...spec.designContract.constraints.map((constraint) => `  - [ ] \`${constraint.id}\`: ${constraint.targetRef}.${constraint.propertyPath} ${constraint.operator}${constraint.value === void 0 ? "" : ` ${JSON.stringify(constraint.value)}`}; source ${constraint.sourceArtifactId ?? "none"}; verify ${constraint.verificationRefs.join(", ") || "none"}`));
  }
  const decisions = spec.adrs.filter((adr) => adr.rigidity);
  if (decisions.length) lines.push("", "### Decision rigidity", ...decisions.map((adr) => `- **${adr.id}** \u2014 ${adr.rigidity}; preserve its declared scope and constraints.`));
  return lines.join("\n");
}
function renderManualIntegrations(spec) {
  const lines = ["## External manual integrations"];
  if (!spec.integrations.length) {
    lines.push(
      "",
      "_No external provider account, dashboard, credential, callback-registration, or provider-console action is declared. Architecture-level HTTPS, authentication, persistence, and security work remains AI-owned repository work unless an external provider is explicitly added. If implementation discovers an unavoidable external action, update the Spec and this handoff before completion._"
    );
    return lines.join("\n");
  }
  for (const integration of spec.integrations) {
    lines.push(
      "",
      `### ${integration.name} (\`${integration.id}\`)`,
      "",
      `**Purpose:** ${integration.purpose}`,
      `**Authentication:** ${integration.authMode || "Confirm the provider authentication model before implementation."}`,
      "",
      "**Code the AI must complete:** integration adapter, typed configuration boundary, input/output validation, unavailable/error states, and repo-native tests.",
      "",
      "**Required configuration:**"
    );
    if (integration.requiredEnv.length) {
      for (const name of integration.requiredEnv) lines.push(`- \`${name}\``);
    } else {
      lines.push("- No environment variable is declared; verify whether the platform uses entitlements, generated config, or another provider-specific mechanism.");
    }
    lines.push("", "**AI-owned repository setup:**");
    if (integration.codeSetup.length) {
      for (const step of integration.codeSetup) lines.push(`- ${step}`);
    } else {
      lines.push("- No additional repository setup is declared beyond the adapter and configuration boundary.");
    }
    for (const item of integration.unclassifiedSetup) {
      lines.push(`- **TAG:UNRESOLVED:** classify before implementation closes: ${item}`);
    }
    lines.push("", "**Unavoidable external manual actions:**");
    if (integration.externalManualActions.length) {
      for (const action of integration.externalManualActions) {
        lines.push(`- **${action.id}** at ${action.surface}: ${action.action}`);
        if (action.requiredValue) lines.push(`  - Required value or permission: ${action.requiredValue}`);
        if (action.appDestination) lines.push(`  - App destination: ${action.appDestination}`);
        lines.push(`  - Verify: ${action.verification}`);
      }
    } else {
      lines.push("- None declared. Do not invent a manual step for work the coding agent can perform in the repository.");
    }
    lines.push("", "**Code-owned local/ephemeral verification:**");
    if (integration.verification.length) {
      for (const check of integration.verification) lines.push(`- ${check}`);
    } else {
      lines.push("- Run a real connection or permission check and record the expected success signal and failure behavior.");
    }
    if (integration.docsUrl) lines.push("", `**Provider documentation:** ${integration.docsUrl}`);
  }
  return lines.join("\n");
}
function renderDefinitionCompleteness(spec, inputs) {
  const blockers = [];
  const ownershipTasks = deriveTasks(spec);
  const hasAcceptance = spec.needs.some((need) => (need.ears ?? []).length > 0) || spec.features.some((feature) => (feature.ears ?? []).length > 0 || feature.acceptanceCriteria.length > 0);
  const interactiveWithoutWire = spec.screens.flatMap((screen) => (screen.elements ?? []).filter(
    (element) => isInteractiveRole(element.role) && !element.dataIn && !element.dataOut
  ));
  const hasVisualDirection = Object.keys(inputs.visualEvidence ?? {}).length > 0 || spec.uiPreferences.brandAdjectives.length > 0 || spec.uiPreferences.mustKeep.length > 0 || spec.uiPreferences.visualReferences.length > 0;
  if (spec.projectContext.startingPoint === "unspecified") blockers.push("Starting point is unresolved; inspect or classify the target before choosing repository paths.");
  if (spec.projectContext.startingPoint === "initial-idea" && !spec.projectContext.bootstrap) {
    blockers.push("Clean-sheet bootstrap files and exact install, typecheck, test, and build commands are unresolved.");
  }
  const exactOwnershipRequired = spec.projectContext.startingPoint === "existing-app" || spec.designIntent === "iterate-ui";
  if (exactOwnershipRequired) {
    const inferred = ownershipTasks.filter((task) => task.ownershipSource === "inferred" && task.layer !== "dependency");
    if (inferred.length) blockers.push(`Existing-app ownership is inferred for ${inferred.map((task) => task.id).join(", ")}; inspect and declare exact ownedFiles.`);
  }
  const ambiguous = ownershipTasks.filter((task) => task.ownershipSource === "inferred" && task.satisfies.filter((id) => spec.features.some((feature) => feature.id === id)).some((featureId) => platformsForFeatures(spec, [featureId]).length > 1));
  if (ambiguous.length) blockers.push(`Multi-platform ownership is ambiguous for ${ambiguous.map((task) => task.id).join(", ")}; declare exact ownedFiles per build unit.`);
  if (!hasAcceptance) blockers.push("No executable acceptance criteria are captured.");
  if ((spec.features.length > 0 || spec.screens.length > 0) && spec.tests.length === 0) blockers.push("No acceptance, smoke, unit, or manual tests are captured.");
  if (spec.platformSurfaces.length > 1) {
    const uncovered = spec.platformSurfaces.filter((surface) => surface.featureIds.length > 0 && !spec.tests.some((candidate) => candidate.platformSurfaceIds.includes(surface.id)));
    if (uncovered.length) blockers.push(`No platform-specific test is assigned to: ${uncovered.map((surface) => `${surface.name} (${surface.id})`).join(", ")}.`);
  }
  if (interactiveWithoutWire.length > 0) blockers.push(`${interactiveWithoutWire.length} interactive element(s) have no declared data input or output.`);
  if (!hasVisualDirection && spec.screens.length > 0) blockers.push("No confirmed UI preference or embedded visual evidence is captured.");
  const lines = ["## Definition completeness"];
  if (!blockers.length) {
    lines.push("", "**READY FOR BUILD:** the handoff contains a classified starting point, acceptance criteria, tests, UI direction, and data wires for every declared interactive element.");
  } else {
    lines.push(
      "",
      "**BLOCKED \u2014 RETURN TO GROUNDWORK BEFORE CLAIMING NEAR-PRODUCTION READINESS.** The embedded file is self-contained, but the accepted definition is incomplete:",
      "",
      ...blockers.map((blocker) => `- ${blocker}`),
      "",
      "Do not invent these decisions in the coding tool. Resolve them with the user, regenerate this handoff, and continue only when this section reports READY FOR BUILD."
    );
  }
  return lines.join("\n");
}
var INTERACTIVE_ROLE_RE = /\b(button|nav(?:igation)?|search|link|field|input|toggle|control|action|form|submit|select|checkbox|radio|menu|tab)\b/i;
function isInteractiveRole(role) {
  return Boolean(role && INTERACTIVE_ROLE_RE.test(role));
}
function describeElementDataIn(el) {
  if (!el.dataIn) return "_none declared_";
  const type = el.dataIn.expectedType ? ` (\`${el.dataIn.expectedType}\`)` : "";
  const note = el.dataIn.note ? ` \u2014 ${el.dataIn.note}` : "";
  return `${el.dataIn.source}${type}${note}`;
}
function describeElementDataOut(el) {
  if (!el.dataOut) return "_none declared_";
  const shows = el.dataOut.shows?.trim() ? el.dataOut.shows : "(unspecified)";
  const type = el.dataOut.expectedType ? ` (\`${el.dataOut.expectedType}\`)` : "";
  const note = el.dataOut.note ? ` \u2014 ${el.dataOut.note}` : "";
  return `${shows}${type}${note}`;
}
function featureLabel(spec, featureId) {
  const feature = spec.features.find((f) => f.id === featureId);
  return feature ? `${feature.title} (\`${featureId}\`)` : `\`${featureId}\``;
}
function renderDataWireMap(spec) {
  const lines = [
    "## Data wire map",
    "",
    "> These element-level wires map UI controls to the authoritative embedded architecture contracts and data model. Implement the full persistence, transport, failure, and security semantics declared in those sections; do not treat a view-level pointer as a replacement for them."
  ];
  const screensWithElements = spec.screens.filter((s) => (s.elements ?? []).length > 0);
  if (!screensWithElements.length) {
    lines.push("", "_No screen elements captured \u2014 nothing to wire yet._");
  } else {
    let deadControlCount = 0;
    for (const screen of screensWithElements) {
      lines.push("", `### Screen: ${screen.name} (\`${screen.id}\`)`, "");
      for (const el of screen.elements ?? []) {
        const roleLabel = el.role ? ` _(${el.role})_` : "";
        const hasWire = Boolean(el.dataIn) || Boolean(el.dataOut);
        const flag = isInteractiveRole(el.role) && !hasWire ? " \u2014 **DEAD-CONTROL RISK**: interactive element declares no data wire." : "";
        if (flag) deadControlCount++;
        lines.push(
          `- **${el.name}**${roleLabel} \u2014 dataIn: ${describeElementDataIn(el)} \xB7 dataOut: ${describeElementDataOut(el)}${flag}`
        );
      }
    }
    lines.push(
      "",
      deadControlCount ? `**${deadControlCount} DEAD-CONTROL RISK element(s) above.** Wire dataIn/dataOut (or confirm the control is intentionally static) before implementation closes.` : "_No dead-control risk detected: every interactive element declares at least one data wire._"
    );
  }
  lines.push("", "### Data model entities");
  if (!spec.dataModel.length) {
    lines.push(
      "",
      "_No dataModel entities declared. Element-level dataIn/dataOut above (when present) is the only pointer-grade data signal captured; the full entity and persistence design is build-loop's to make._"
    );
  } else {
    for (const entity of spec.dataModel) {
      const reads = entity.readByFeatureIds?.length ? entity.readByFeatureIds.map((id) => featureLabel(spec, id)).join(", ") : "_none declared_";
      const writes = entity.writtenByFeatureIds?.length ? entity.writtenByFeatureIds.map((id) => featureLabel(spec, id)).join(", ") : "_none declared_";
      const refs = entity.elementRefs?.length ? entity.elementRefs.join(", ") : "_none declared_";
      const desc = entity.description ? ` \u2014 ${entity.description}` : "";
      lines.push(
        "",
        `- **${entity.name}** (\`${entity.id}\`)${desc}`,
        `  - Read by: ${reads}`,
        `  - Written by: ${writes}`,
        `  - Element refs: ${refs}`
      );
    }
  }
  return lines.join("\n");
}
function renderEmbeddedContract(spec, inputs) {
  const sections = ["## Embedded Groundwork contract"];
  const replacements = portablePathReplacements(spec);
  const portable = (body) => {
    let value = body;
    for (const [localPath, label] of replacements) {
      value = value.split(localPath).join(label);
      const jsonEscaped = JSON.stringify(localPath).slice(1, -1);
      if (jsonEscaped !== localPath) value = value.split(jsonEscaped).join(label);
    }
    value = value.replace(
      /\/(?:Users|home|tmp|private|Volumes|var\/folders)\/[^\s`"'<>()[\]{}]+/g,
      "[machine-local path redacted; inspect the current repository]"
    );
    value = value.replace(
      /[A-Za-z]:\\(?:Users|Temp)\\[^\s`"'<>()[\]{}]+/g,
      "[machine-local path redacted; inspect the current repository]"
    );
    value = value.replace(
      /[A-Za-z]:\\\\(?:Users|Temp)\\\\[^`"<>()[\]{}\n]+/g,
      "[machine-local path redacted; inspect the current repository]"
    );
    return value;
  };
  const append = (title, language, body) => {
    const content = portable(body).trimEnd();
    const longest = Math.max(0, ...Array.from(content.matchAll(/~+/g), (match) => match[0].length));
    const fence = "~".repeat(Math.max(4, longest + 1));
    sections.push("", `### ${title}`, "", `${fence}${language}`, content, fence);
  };
  append("Canonical Spec", "json", JSON.stringify(spec, null, 2));
  append("Steering", "markdown", inputs.docs["steering.md"] ?? "");
  append("Requirements", "markdown", inputs.docs["requirements.md"] ?? "");
  append("Technical design", "markdown", inputs.docs["design.md"] ?? "");
  if (inputs.resolvedArchitecture) {
    append("Resolved architecture graph", "json", JSON.stringify(inputs.resolvedArchitecture, null, 2));
  }
  append("UI design", "markdown", inputs.docs["design-system.md"] ?? "");
  for (const [label, body] of Object.entries(inputs.visualEvidence ?? {})) {
    append(label, label.endsWith(".json") ? "json" : label.endsWith(".html") ? "html" : "markdown", body);
  }
  append("Implementation plan", "markdown", inputs.tasks);
  append("Traceability", "json", JSON.stringify(inputs.traceability, null, 2));
  return sections.join("\n");
}
function portablePathReplacements(spec) {
  const paths = [
    ...spec.projectContext.sourceArtifacts.map((value) => [value, "[current-state path redacted; inspect the current repository]"]),
    ...spec.projectContext.evidence.flatMap(
      (item) => item.sourceRefs.map((value) => [value, "[current-state path redacted; inspect the current repository]"])
    ),
    ...spec.uiPreferences.visualReferences.map((value) => [value, "[visual-source path redacted; use embedded visual evidence]"])
  ];
  const machineLocal = /^(?:\/(?:Users|home|tmp|private|Volumes|var\/folders)(?:\/|$)|[A-Za-z]:[\\/](?:Users|Temp)(?:[\\/]|$)|\\\\[^\\]+\\[^\\]+)/;
  const replacements = paths.filter((entry) => Boolean(entry[0]) && machineLocal.test(entry[0]));
  if (spec.projectContext.sourceRepo) {
    replacements.push([spec.projectContext.sourceRepo, "[repository path redacted; use the repository where this handoff is executed]"]);
  }
  return replacements.sort((left, right) => right[0].length - left[0].length);
}
function deriveTasks(spec) {
  const tasks2 = [];
  let n = 0;
  const next = () => ++n;
  const repoLayout = spec.projectContext.repoLayout;
  const needById = /* @__PURE__ */ new Map();
  for (const need of spec.needs) needById.set(need.id, need);
  const hasWork = spec.dataPoints.length > 0 || spec.features.length > 0 || spec.screens.length > 0 || spec.integrations.length > 0 || spec.architecture.components.length > 0 || spec.architecture.contracts.length > 0 || spec.apiContracts.length > 0 || spec.tests.length > 0;
  const scaffoldNum = next();
  tasks2.push({
    id: "task-scaffold",
    n: scaffoldNum,
    layer: "scaffold",
    title: hasWork ? scaffoldTitle(spec) : "Confirm project baseline and capture implementation scope",
    ownedFiles: scaffoldOwnedFiles(spec),
    dod: scaffoldDoD(spec),
    deps: [],
    satisfies: spec.dataPoints.map((d) => d.id)
  });
  const scaffoldDeps = scaffoldNum ? [scaffoldNum] : [];
  for (const dependency of spec.architecture.specDependencies) {
    const num = next();
    tasks2.push({
      id: `task-spec-dependency-${slug(dependency.id)}`,
      n: num,
      layer: "dependency",
      title: `Verify pinned Spec dependency: ${dependency.specId}`,
      ownedFiles: [`dependency:${dependency.specId}`],
      dod: [
        `Resolve only the pinned ${dependency.relationship} dependency ${dependency.specId}.`,
        `Verify schema v${dependency.schemaVersion}, revision ${dependency.revision}, and digest ${dependency.digest}.`,
        "Do not fetch a network URI or mutate the dependency's desired Spec."
      ],
      deps: scaffoldDeps,
      satisfies: [dependency.id, dependency.specId]
    });
  }
  const integrationTaskNum = /* @__PURE__ */ new Map();
  for (const integration of spec.integrations) {
    const num = next();
    integrationTaskNum.set(integration.id, num);
    tasks2.push({
      id: `task-integration-${slug(integration.id)}`,
      n: num,
      layer: "integration",
      title: `Implement integration: ${integration.name}`,
      ownedFiles: integration.ownedFiles.length ? integration.ownedFiles : repoLayout?.integrationsDir ? [integrationOwnedFile(integration, spec.platformTarget, repoLayout)] : spec.projectContext.bootstrap ? ownedFilesForFeatures(spec, integration.featureIds, "integrations", integration.name) : [integrationOwnedFile(integration, spec.platformTarget)],
      dod: integrationDoD(integration),
      deps: scaffoldDeps,
      satisfies: [integration.id, ...integration.featureIds]
    });
  }
  const architectureContractTaskNum = /* @__PURE__ */ new Map();
  for (const contract of spec.architecture.contracts) {
    const num = next();
    architectureContractTaskNum.set(contract.id, num);
    tasks2.push({
      id: `task-contract-${slug(contract.id)}`,
      n: num,
      layer: "contract",
      title: `Implement architecture contract: ${contract.name}`,
      ownedFiles: contractOwnedFiles(contract, spec),
      dod: architectureContractDoD(contract),
      deps: scaffoldDeps,
      satisfies: [contract.id]
    });
  }
  const componentTaskNum = /* @__PURE__ */ new Map();
  for (const component of spec.architecture.components) {
    const num = next();
    componentTaskNum.set(component.id, num);
    const contractDeps = spec.architecture.contracts.filter((contract) => [contract.provider, ...contract.consumers].some((ref2) => ref2.specId === spec.id && ref2.kind === "component" && ref2.id === component.id)).map((contract) => architectureContractTaskNum.get(contract.id)).filter((value) => value != null);
    const integrationDeps = spec.integrations.filter((integration) => integration.featureIds.some((featureId) => component.featureIds.includes(featureId))).map((integration) => integrationTaskNum.get(integration.id)).filter((value) => value != null);
    const componentDeps = uniqueSorted([...contractDeps, ...integrationDeps]);
    tasks2.push({
      id: `task-component-${slug(component.id)}`,
      n: num,
      layer: "component",
      title: `Implement component: ${component.name}`,
      ownedFiles: componentOwnedFiles(component, spec),
      dod: componentDoD(component),
      deps: componentDeps.length ? componentDeps : scaffoldDeps,
      satisfies: [component.id, ...component.featureIds]
    });
  }
  const apiTaskNum = /* @__PURE__ */ new Map();
  for (const api of spec.apiContracts) {
    const num = next();
    apiTaskNum.set(api.id, num);
    const servedFeatures = api.featureIds.map((fid) => spec.features.find((f) => f.id === fid)).filter((f) => Boolean(f));
    const integrationDeps = spec.integrations.filter((integration) => integration.featureIds.some((id) => api.featureIds.includes(id))).map((integration) => integrationTaskNum.get(integration.id)).filter((x) => x != null);
    const contractDeps = spec.architecture.contracts.filter((contract) => [contract.provider, ...contract.consumers].some((ref2) => {
      if (ref2.specId !== spec.id || ref2.kind !== "component") return false;
      return spec.architecture.components.find((component) => component.id === ref2.id)?.featureIds.some((id) => api.featureIds.includes(id));
    })).map((contract) => architectureContractTaskNum.get(contract.id)).filter((x) => x != null);
    const providerComponentIds = new Set(spec.architecture.contracts.filter((contract) => contract.provider.specId === spec.id && contract.provider.kind === "component").filter((contract) => spec.architecture.components.find((component) => component.id === contract.provider.id)?.featureIds.some((id) => api.featureIds.includes(id))).map((contract) => contract.provider.id));
    const componentDeps = spec.architecture.components.filter((component) => providerComponentIds.has(component.id)).map((component) => componentTaskNum.get(component.id)).filter((x) => x != null);
    const apiDeps = uniqueSorted([...integrationDeps, ...contractDeps, ...componentDeps]);
    tasks2.push({
      id: `task-api-${slug(api.id)}`,
      n: num,
      layer: "api",
      title: `Implement API \`${api.method} ${api.path}\``,
      ownedFiles: api.ownedFiles.length ? api.ownedFiles : repoLayout?.apiFilePattern ? [apiOwnedFile(api, repoLayout)] : spec.projectContext.bootstrap ? apiOwnedFiles(api, spec) : [apiOwnedFile(api)],
      dod: apiDoD(api, servedFeatures, needById),
      deps: apiDeps.length ? apiDeps : scaffoldDeps,
      satisfies: [api.id, ...api.featureIds]
    });
  }
  const featureTaskNum = /* @__PURE__ */ new Map();
  const needToFeatureTasks = /* @__PURE__ */ new Map();
  for (const feature of spec.features) {
    const num = next();
    featureTaskNum.set(feature.id, num);
    const apiDeps = spec.apiContracts.filter((a) => a.featureIds.includes(feature.id)).map((a) => apiTaskNum.get(a.id)).filter((x) => x != null);
    const integrationDeps = spec.integrations.filter((integration) => integration.featureIds.includes(feature.id)).map((integration) => integrationTaskNum.get(integration.id)).filter((x) => x != null);
    const architectureDeps = spec.architecture.contracts.filter((contract) => [contract.provider, ...contract.consumers].some((ref2) => {
      if (ref2.specId !== spec.id || ref2.kind !== "component") return false;
      return spec.architecture.components.find((component) => component.id === ref2.id)?.featureIds.includes(feature.id);
    })).map((contract) => architectureContractTaskNum.get(contract.id)).filter((x) => x != null);
    const componentDeps = spec.architecture.components.filter((component) => component.featureIds.includes(feature.id)).map((component) => componentTaskNum.get(component.id)).filter((x) => x != null);
    const explicitDeps = [...componentDeps, ...architectureDeps, ...apiDeps, ...integrationDeps];
    const deps = explicitDeps.length ? explicitDeps : scaffoldDeps;
    tasks2.push({
      id: `task-feature-${slug(feature.id)}`,
      n: num,
      layer: "feature",
      title: `Implement feature: ${feature.title}`,
      ownedFiles: feature.ownedFiles ?? (repoLayout?.featuresDir ? [featureOwnedFile(feature, spec.platformTarget, repoLayout)] : spec.projectContext.bootstrap ? ownedFilesForFeatures(spec, [feature.id], "features", feature.title) : [featureOwnedFile(feature, spec.platformTarget)]),
      dod: featureDoD(feature, needById),
      deps: uniqueSorted(deps),
      satisfies: [feature.id, ...feature.needIds]
    });
    for (const needId of feature.needIds) {
      const arr = needToFeatureTasks.get(needId) ?? [];
      arr.push(num);
      needToFeatureTasks.set(needId, arr);
    }
  }
  const allFeatureTaskNums = Array.from(featureTaskNum.values());
  const screenTaskNum = /* @__PURE__ */ new Map();
  for (const screen of spec.screens) {
    const num = next();
    screenTaskNum.set(screen.id, num);
    const linkedFeatureDeps = screen.featureIds.map((featureId) => featureTaskNum.get(featureId)).filter((x) => x != null);
    const deps = linkedFeatureDeps.length ? linkedFeatureDeps : allFeatureTaskNums.length ? allFeatureTaskNums : scaffoldDeps;
    tasks2.push({
      id: `task-screen-${slug(screen.id)}`,
      n: num,
      layer: "screen",
      title: `Build screen: ${screen.name}`,
      ownedFiles: screen.ownedFiles ?? (repoLayout?.screensDir ? [screenOwnedFile(screen, spec.platformTarget, repoLayout)] : spec.projectContext.bootstrap ? ownedFilesForFeatures(spec, screen.featureIds, "screens", screen.name, true) : [screenOwnedFile(screen, spec.platformTarget)]),
      dod: screenDoD(screen),
      deps: uniqueSorted(deps),
      satisfies: [screen.id, ...screen.featureIds]
    });
  }
  const firstTestNumber = n + 1;
  const testTaskNum = new Map(spec.tests.map((candidate, index) => [candidate.id, firstTestNumber + index]));
  for (const test of spec.tests) {
    const num = next();
    const directFeatureDeps = test.featureIds.map((fid) => featureTaskNum.get(fid)).filter((x) => x != null);
    const needFeatureDeps = test.featureIds.length ? [] : test.needIds.flatMap((nid) => needToFeatureTasks.get(nid) ?? []);
    const integrationDeps = test.integrationIds.map((integrationId) => integrationTaskNum.get(integrationId)).filter((x) => x != null);
    const screenDeps = test.screenIds.map((screenId) => screenTaskNum.get(screenId)).filter((x) => x != null);
    const testDeps = test.dependsOnTestIds.map((testId) => testTaskNum.get(testId)).filter((x) => x != null);
    let deps = uniqueSorted([
      ...directFeatureDeps,
      ...needFeatureDeps,
      ...integrationDeps,
      ...screenDeps,
      ...testDeps
    ]);
    if (deps.length === 0) {
      deps = allFeatureTaskNums.length ? uniqueSorted(allFeatureTaskNums) : scaffoldDeps;
    }
    tasks2.push({
      id: `task-test-${slug(test.id)}`,
      n: num,
      layer: "test",
      title: `Write ${test.kind} test: ${truncate(test.description, 60)}`,
      ownedFiles: test.ownedFiles.length ? test.ownedFiles : repoLayout?.testsDir ? [testOwnedFile(test, spec.platformTarget, repoLayout)] : spec.projectContext.bootstrap ? testOwnedFiles(test, spec) : [testOwnedFile(test, spec.platformTarget)],
      dod: testDoD(test, spec.platformTarget),
      deps,
      satisfies: [test.id, ...test.needIds, ...test.featureIds, ...test.integrationIds]
    });
  }
  const declaredNew = new Set((spec.projectContext.declaredNewFiles ?? []).map((entry) => entry.path));
  const explicitTaskIds = /* @__PURE__ */ new Set();
  if (spec.projectContext.bootstrap?.ownedFiles.length || spec.dataModel.some((item) => item.ownedFiles.length)) explicitTaskIds.add("task-scaffold");
  spec.integrations.filter((item) => item.ownedFiles.length).forEach((item) => explicitTaskIds.add(`task-integration-${slug(item.id)}`));
  spec.architecture.contracts.filter((item) => item.ownedFiles?.length).forEach((item) => explicitTaskIds.add(`task-contract-${slug(item.id)}`));
  spec.architecture.components.filter((item) => item.ownedFiles?.length).forEach((item) => explicitTaskIds.add(`task-component-${slug(item.id)}`));
  spec.apiContracts.filter((item) => item.ownedFiles.length).forEach((item) => explicitTaskIds.add(`task-api-${slug(item.id)}`));
  spec.features.filter((item) => item.ownedFiles?.length).forEach((item) => explicitTaskIds.add(`task-feature-${slug(item.id)}`));
  spec.screens.filter((item) => item.ownedFiles?.length).forEach((item) => explicitTaskIds.add(`task-screen-${slug(item.id)}`));
  spec.tests.filter((item) => item.ownedFiles.length).forEach((item) => explicitTaskIds.add(`task-test-${slug(item.id)}`));
  return tasks2.map((task) => ({
    ...task,
    ownershipSource: task.ownershipSource ?? (explicitTaskIds.has(task.id) ? "explicit" : "inferred"),
    plannedNewFiles: task.ownedFiles.filter((file) => declaredNew.has(file))
  }));
}
function scaffoldTitle(spec) {
  if (spec.projectContext.startingPoint === "existing-app") {
    return "Inspect existing project and evolve the data model";
  }
  if (spec.projectContext.startingPoint === "existing-definition") {
    return "Preserve the existing definition and establish the target scaffold";
  }
  if (spec.projectContext.startingPoint === "unspecified") {
    return "Confirm the starting point and establish the project baseline";
  }
  return "Scaffold project and data model";
}
function scaffoldDoD(spec) {
  const dataPoints = spec.dataPoints;
  const dod = [
    "Project scaffold builds and typechecks clean."
  ];
  if (spec.projectContext.startingPoint === "existing-app") {
    dod.unshift("Inspected live paths, tests, and current contracts remain preserved unless the Spec declares a delta.");
  } else if (spec.projectContext.startingPoint === "unspecified") {
    dod.unshift("Starting point is verified before any scaffold or migration decision.");
  }
  if (spec.projectContext.bootstrap) {
    const { commands } = spec.projectContext.bootstrap;
    dod.push(`Install: ${commands.install}`);
    dod.push(`Typecheck: ${commands.typecheck}`);
    dod.push(`Test: ${commands.test}`);
    dod.push(`Build: ${commands.build}`);
  } else if (spec.projectContext.startingPoint === "initial-idea") {
    dod.push("TAG:UNRESOLVED \u2014 capture exact bootstrap files and install, typecheck, test, and build commands before implementation.");
  }
  if (dataPoints.length === 0) {
    dod.push("No data model captured \u2014 confirm none is required before proceeding.");
    return dod;
  }
  dod.push("Data model persists and round-trips the following data points:");
  for (const d of dataPoints) {
    if (d.pii === true) {
      const note = d.handlingNote?.trim() ? d.handlingNote : "TAG:UNRESOLVED \u2014 handlingNote required (linter blocks export).";
      dod.push(`\`${d.id}\` ${d.name} \`${d.type}\` (PII \u2014 handling note only): ${note}`);
    } else {
      const desc = d.description ? ` \u2014 ${d.description}` : "";
      dod.push(`\`${d.id}\` ${d.name} \`${d.type}\`${desc}`);
    }
  }
  return dod;
}
function integrationDoD(integration) {
  const dod = [
    `Implements the ${integration.name} adapter and typed unavailable/error boundary for: ${integration.purpose}`
  ];
  for (const item of integration.codeSetup) dod.push(`AI-owned setup: ${item}`);
  for (const item of integration.unclassifiedSetup) {
    dod.push(`TAG:UNRESOLVED \u2014 classify as AI-owned code setup or an unavoidable external action: ${item}`);
  }
  if (integration.requiredEnv.length) {
    dod.push(`Validates configuration: ${integration.requiredEnv.join(", ")}.`);
  }
  for (const check of integration.verification) dod.push(`Code-owned local/ephemeral verification: ${check}`);
  if (integration.externalManualActions.length) {
    dod.push("Tests the configured and unconfigured paths without embedding provider credentials.");
  }
  return dod;
}
function architectureContractDoD(contract) {
  return [
    `Provider: ${contract.provider.specId}:${contract.provider.kind}:${contract.provider.id}.`,
    `Consumers: ${contract.consumers.map((ref2) => `${ref2.specId}:${ref2.kind}:${ref2.id}`).join(", ")}.`,
    `Transport: ${contract.transport}.`,
    ...contract.ports.map((port) => `${port.direction} port \`${port.id}\` (${port.name}) uses \`${port.type}\`${port.required ? " and is required" : " and is optional"}.`),
    ...contract.failureModes.map((mode) => `Failure behavior: ${mode}`),
    ...contract.securityNotes.map((note) => `Security: ${note}`),
    "Add repo-native contract tests for serialization, version behavior, failure retention, and access controls."
  ];
}
function componentDoD(component) {
  return [
    `Implements the \`${component.kind}\` component owned by ${component.owner}.`,
    component.description || `Implements component \`${component.id}\` against its declared contracts.`,
    component.featureIds.length ? `Provides feature behavior: ${component.featureIds.join(", ")}.` : "Provides architecture-only behavior with no product feature assigned.",
    "Map this logical component to verified live repository paths during Assess; do not invent a framework-specific location."
  ];
}
function apiDoD(api, servedFeatures, needById) {
  const dod = [];
  if (api.description) dod.push(api.description);
  dod.push(`Endpoint \`${api.method} ${api.path}\` returns the contracted shape.`);
  if (api.requestSchema) dod.push(`Validates request against: ${inline(api.requestSchema)}`);
  if (api.responseSchema) dod.push(`Responds with: ${inline(api.responseSchema)}`);
  const ears = earsForFeatures(servedFeatures, needById);
  for (const e of ears) dod.push(e);
  if (dod.length === 0) dod.push(`Implements API \`${api.id}\`; verify response shape.`);
  return dod;
}
function featureDoD(feature, needById) {
  const dod = [];
  for (const e of feature.ears ?? []) dod.push(earsLine(e.id, e.ears));
  for (const c of feature.acceptanceCriteria) dod.push(c);
  for (const needId of feature.needIds) {
    const need = needById.get(needId);
    if (!need) continue;
    for (const e of need.ears ?? []) dod.push(earsLine(e.id, e.ears, needId));
  }
  for (const line of featureNfrDoD(feature.nfr)) dod.push(line);
  if (dod.length === 0) {
    const base = feature.description ? feature.description : `Implements "${feature.title}".`;
    dod.push(`${base} Verify behavior against the requirement.`);
  }
  return dod;
}
function screenDoD(screen) {
  const dod = [`Renders "${screen.name}" \u2014 ${screen.purpose}.`];
  if (screen.primaryAction) dod.push(`Primary action works: ${screen.primaryAction}.`);
  if (screen.states.length) {
    dod.push(`Handles all declared states: ${screen.states.join(", ")}.`);
  }
  return dod;
}
function testDoD(test, platform) {
  const dod = [
    `${capitalize(test.kind)} test asserts: ${test.description}`,
    test.command ? `Run \`${test.command}\`.` : PLATFORM_TEST_RUN[platform] ?? "Run the project's test suite."
  ];
  if (test.platformSurfaceIds.length) dod.push(`Platform surfaces: ${test.platformSurfaceIds.join(", ")}.`);
  if (platform === "claude-plugin") {
    const refs = test.validatorRefs.length ? test.validatorRefs.join(", ") : "no validatorRefs declared (linter warning)";
    dod.push(`Validators: ${refs}.`);
  }
  if (test.testFramework.trim()) dod.push(`Framework: \`${test.testFramework}\`.`);
  return dod;
}
function earsForFeatures(features, needById) {
  const out = /* @__PURE__ */ new Set();
  for (const f of features) {
    for (const e of f.ears ?? []) out.add(earsLine(e.id, e.ears, f.id));
    for (const needId of f.needIds) {
      const need = needById.get(needId);
      if (!need) continue;
      for (const e of need.ears ?? []) out.add(earsLine(e.id, e.ears, needId));
    }
  }
  return [...out];
}
function earsLine(id, ears, source) {
  const via = source ? ` (via ${source})` : "";
  return `EARS \`${id}\`${via}: ${ears}`;
}
function trimTrailingSlash(s) {
  return s.replace(/\/+$/, "");
}
function dataOwnedFile(platform, repoLayout) {
  if (repoLayout?.dataModel) return repoLayout.dataModel;
  switch (platform) {
    case "ios":
    case "macos":
      return "Sources/Models/ (data model)";
    case "claude-plugin":
      return "plugin.json + skills/ (scaffold)";
    case "agent-system":
      return "src/state/ (agent state model)";
    default:
      return "src/db/schema.ts";
  }
}
function apiPathToken(rawPath, fallbackId) {
  const trimmed = (rawPath ?? "").trim().replace(/^\/+|\/+$/g, "");
  let segs = trimmed.split("/").filter((s) => s.length > 0);
  if (segs.length && segs[0].toLowerCase() === "api") segs = segs.slice(1);
  segs = segs.filter((s) => !s.startsWith(":") && !s.startsWith("{"));
  const token = segs.map((s) => slug(s)).join("/");
  return token || slug(fallbackId);
}
function substituteApiPattern(pattern, token) {
  if (pattern.includes("{path}")) return pattern.split("{path}").join(token);
  const base = trimTrailingSlash(pattern);
  return token ? `${base}/${token}` : base;
}
function apiOwnedFile(api, repoLayout) {
  if (repoLayout?.apiFilePattern) {
    return substituteApiPattern(repoLayout.apiFilePattern, apiPathToken(api.path, api.id));
  }
  const segs = api.path.split("/").map((s) => s.trim()).filter((s) => s && !s.startsWith(":") && !s.startsWith("{") && s.toLowerCase() !== "api");
  const base = segs.length ? segs[0] : api.id;
  return `src/routes/${slug(base)}.ts`;
}
function extensionForPlatform(platform, ui = false) {
  if (platform === "ios" || platform === "macos") return "swift";
  if (ui && (platform === "web" || platform === "vite-spa")) return "tsx";
  if (platform === "claude-plugin") return "json";
  return "ts";
}
function integrationOwnedFile(integration, platform, repoLayout) {
  if (repoLayout?.integrationsDir) {
    return `${trimTrailingSlash(repoLayout.integrationsDir)}/${slug(integration.id)}.${extensionForPlatform(platform)}`;
  }
  const base = pascal(integration.name || integration.id);
  if (platform === "ios" || platform === "macos") return `Sources/Integrations/${base}.swift`;
  if (platform === "claude-plugin") return `integrations/${slug(integration.id)}/`;
  if (platform === "agent-system") return `src/tools/${slug(integration.id)}.ts`;
  return `src/integrations/${slug(integration.id)}.ts`;
}
function featureOwnedFile(feature, platform, repoLayout) {
  const base = feature.title?.trim() ? feature.title : feature.id;
  if (repoLayout?.featuresDir) {
    return `${trimTrailingSlash(repoLayout.featuresDir)}/${slug(base)}.${extensionForPlatform(platform, feature.surface === "ui")}`;
  }
  return `src/features/${slug(base)}.ts`;
}
function screenOwnedFile(screen, platform, repoLayout) {
  const base = screen.name?.trim() ? screen.name : screen.id;
  const ext = platform === "ios" || platform === "macos" ? "swift" : "tsx";
  const dir = repoLayout?.screensDir ? trimTrailingSlash(repoLayout.screensDir) : platform === "ios" || platform === "macos" ? "Sources/Views" : "src/screens";
  return `${dir}/${pascal(base)}.${ext}`;
}
function testOwnedFile(test, platform, repoLayout) {
  if (repoLayout?.testsDir) {
    const suffix = repoLayout.testFileSuffix || (platform === "ios" || platform === "macos" ? "Tests.swift" : ".test.ts");
    return `${trimTrailingSlash(repoLayout.testsDir)}/${slug(test.id)}${suffix}`;
  }
  switch (platform) {
    case "ios":
    case "macos":
      return `Tests/${pascal(test.id)}.swift`;
    case "claude-plugin":
      return test.validatorRefs.length ? `validators: ${test.validatorRefs.join(", ")}` : "TODO: declare validatorRefs";
    case "agent-system":
      return `evals/${slug(test.id)}.ts`;
    default:
      return `test/${slug(test.id)}.test.ts`;
  }
}
function scaffoldOwnedFiles(spec) {
  const explicit = [
    ...spec.projectContext.bootstrap?.ownedFiles ?? [],
    ...spec.dataModel.flatMap((entity) => entity.ownedFiles)
  ];
  if (explicit.length) return [...new Set(explicit)];
  if (spec.projectContext.repoLayout?.dataModel) {
    return [dataOwnedFile(spec.platformTarget, spec.projectContext.repoLayout)];
  }
  const hasBuildableScope = Boolean(
    spec.dataPoints.length || spec.features.length || spec.screens.length || spec.integrations.length || spec.apiContracts.length || spec.tests.length || spec.architecture.components.length || spec.architecture.contracts.length
  );
  return hasBuildableScope ? [dataOwnedFile(spec.platformTarget)] : ["README.md"];
}
function platformsForFeatures(spec, featureIds) {
  const wanted = new Set(featureIds);
  return [...new Set(spec.platformSurfaces.filter((surface) => surface.featureIds.some((id) => wanted.has(id))).map((surface) => surface.platform))].sort();
}
function ownedFilesForPlatforms(platforms, dir, base, webTsx = false) {
  const safeBase = slug(base);
  const nativeBase = pascal(base);
  const values = platforms.flatMap((platform) => {
    if (platform === "ios" || platform === "macos") return [`Sources/${pascal(dir)}/${nativeBase}.swift`];
    if (platform === "web" || platform === "vite-spa") return [`apps/web/src/${dir}/${safeBase}.${webTsx ? "tsx" : "ts"}`];
    if (platform === "service" || platform === "api") return [`services/review/src/${dir}/${safeBase}.ts`];
    if (platform === "claude-plugin") return [`${dir}/${safeBase}.json`];
    if (platform === "agent-system") return [`src/${dir}/${safeBase}.ts`];
    return [`src/${dir}/${safeBase}.ts`];
  });
  return [...new Set(values.length ? values : [`src/${dir}/${safeBase}.ts`])];
}
function ownedFilesForFeatures(spec, featureIds, dir, base, webTsx = false) {
  return ownedFilesForPlatforms(platformsForFeatures(spec, featureIds), dir, base, webTsx);
}
function contractOwnedFiles(contract, spec) {
  if (contract.ownedFiles?.length) return contract.ownedFiles;
  const componentIds = new Set([contract.provider, ...contract.consumers].filter((ref2) => ref2.specId === spec.id && ref2.kind === "component").map((ref2) => ref2.id));
  const featureIds = spec.architecture.components.filter((component) => componentIds.has(component.id)).flatMap((component) => component.featureIds);
  return ownedFilesForFeatures(spec, featureIds, "contracts", contract.name);
}
function apiOwnedFiles(api, spec) {
  const featurePlatforms = platformsForFeatures(spec, api.featureIds);
  const serverPlatforms = featurePlatforms.filter((platform) => platform === "service" || platform === "api");
  return ownedFilesForPlatforms(serverPlatforms.length ? serverPlatforms : featurePlatforms, "routes", api.id);
}
function componentOwnedFiles(component, spec) {
  if (component.ownedFiles?.length) return component.ownedFiles;
  const dir = component.kind === "ui" ? "components" : component.kind === "data" ? "data" : "components";
  return ownedFilesForFeatures(spec, component.featureIds, dir, component.name, component.kind === "ui");
}
function testOwnedFiles(test, spec) {
  const surfacePlatforms = spec.platformSurfaces.filter((surface) => test.platformSurfaceIds.includes(surface.id)).map((surface) => surface.platform);
  const files = surfacePlatforms.flatMap((platform) => {
    if (platform === "ios" || platform === "macos") return [`Tests/${pascal(test.id)}.swift`];
    if (platform === "web" || platform === "vite-spa") return [`apps/web/tests/${slug(test.id)}.${/playwright/i.test(test.testFramework) ? "spec.ts" : "test.ts"}`];
    if (platform === "service" || platform === "api") return [`services/review/test/${slug(test.id)}.test.ts`];
    if (platform === "claude-plugin") return test.validatorRefs.length ? [`validators: ${test.validatorRefs.join(", ")}`] : ["TODO: declare validatorRefs"];
    if (platform === "agent-system") return [`evals/${slug(test.id)}.ts`];
    return [`test/${slug(test.id)}.test.ts`];
  });
  return files.length ? [...new Set(files)] : ownedFilesForPlatforms([spec.platformTarget], "test", test.id);
}
var PLATFORM_TEST_RUN = {
  web: "Run `npm run test` (Vitest).",
  "vite-spa": "Run `npm run test` (Vitest).",
  ios: "Run the explicit XCTest command captured for this test; if none is captured, return to Groundwork instead of guessing a scheme or destination.",
  macos: "Run the explicit XCTest command captured for this test; if none is captured, return to Groundwork instead of guessing a scheme or destination.",
  "claude-plugin": "Run plugin-builder validators (manifest / skill / hook / command) + `claude plugins lint`.",
  "agent-system": "Run the golden-task suite + safety / permission evals."
};
var PLATFORM_DISPLAY = {
  web: "web",
  "vite-spa": "Vite SPA",
  ios: "iOS",
  macos: "macOS",
  "claude-plugin": "Claude Code/Codex plugin",
  "agent-system": "agent system"
};
function renderHeader(spec, taskCount) {
  return `# Build plan \u2014 ${spec.productName}

> ${spec.productDescription?.trim() || "_No product description captured._"}
>
> Generated by Groundwork in build-loop native plan format. The build-loop
> orchestrator consumes this as its Phase 2 plan. Tasks are ordered by
> dependency: scaffold / data layer \u2192 integrations + contracts + components + API \u2192 features \u2192 UI screens \u2192 tests.
> Each task lists its owned files, definition-of-done, dependencies, and the
> requirement IDs it satisfies (traceability).

**Platform target:** \`${spec.platformTarget}\`  \xB7  **Tasks:** ${taskCount}`;
}
function renderApproachLenses(spec) {
  const context = spec.projectContext;
  if (context.startingPoint === "unspecified") {
    return `## Approach Lenses

**Starting point unresolved:** Determine whether the target is a clean-sheet
build, an existing definition, or an existing implementation before editing.

**Preserve:** Treat supplied artifacts and user-confirmed preferences as
constraints until their current status is verified.

**Recommendation:** Build Loop Assess must classify the starting point, inspect
the relevant live surface, and then map this task graph without assuming a
greenfield repository.`;
  }
  if (context.startingPoint === "existing-app" || context.startingPoint === "existing-definition") {
    const inspected = context.sourceArtifacts.length ? context.sourceArtifacts.map((item) => machineLocalPath(item) ? "a recorded current-state artifact (local path redacted)" : `\`${item}\``).join(", ") : "the recorded source artifacts";
    return `## Approach Lenses

**Current system:** Groundwork started from the existing product in the repository where this handoff is executed and
captured current-state evidence from ${inspected}.

**Preserve:** Keep verified contracts and the user-confirmed must-keep
preferences in the embedded Canonical Spec; do not replace working architecture by default.

**Delta:** Implement the declared requirements, may-evolve preferences, and
unresolved assumptions as changes to the inspected system.

**Recommendation:** During Build Loop Assess, verify each proposed owned file
against the live repository and map this task graph onto the existing paths.`;
  }
  return `## Approach Lenses

**Clean-sheet:** Implement against the validated requirements, contracts, and
ADRs in the embedded Canonical Spec without assuming a target repository structure.

**Current constraints:** Groundwork has not inspected the future target
repository, so concrete paths, existing contracts, and framework conventions
remain repo-specific.

**Bridge:** During Build Loop Assess, map each owned-file suggestion and
contract below to the live repository before implementation.

**Recommendation:** Preserve this dependency and traceability graph; refine only
the repo-specific implementation choices against live code.`;
}
function renderReadsFromBoundary(spec) {
  const context = spec.projectContext;
  if (context.startingPoint === "unspecified") {
    return `## Depends-on (reads-from)

- Embedded Canonical Spec section \u2014 validated desired state; starting-point classification unresolved
- Embedded Traceability section \u2014 generated cross-reference graph \u2014 verified

override: reads-from-dependency \u2014 Resolve and inspect the target repository or
artifact set before accepting any proposed owned file.`;
  }
  if (context.startingPoint === "existing-app" || context.startingPoint === "existing-definition") {
    return `## Depends-on (reads-from)

- Embedded Canonical Spec section \u2014 validated desired state and provenance \u2014 verified
- Embedded Traceability section \u2014 generated cross-reference graph \u2014 verified
- Live current repository state \u2014 verify its paths, contracts, and tests; no source artifact or redacted local path is required

override: reads-from-dependency \u2014 Existing-product evidence can become stale;
Build Loop must re-verify the named live dependencies before implementation.`;
  }
  return `## Depends-on (reads-from)

- Embedded Canonical Spec section \u2014 validated product requirements and contracts \u2014 verified
- Embedded Traceability section \u2014 generated cross-reference graph \u2014 verified

override: reads-from-dependency \u2014 Groundwork cannot verify contracts in a
future target repository; Build Loop must resolve those live dependencies
during Assess before implementation.`;
}
function machineLocalPath(value) {
  return /^(?:\/(?:Users|home|tmp|private|Volumes|var\/folders)(?:\/|$)|[A-Za-z]:[\\/](?:Users|Temp)(?:[\\/]|$)|\\\\[^\\]+\\[^\\]+)/.test(value);
}
function renderThreatModel(spec) {
  const pii = spec.dataPoints.filter((d) => d.pii);
  const authIntegrations = spec.integrations.filter((i) => i.authMode?.trim());
  const hasRiskSurface = pii.length > 0 || spec.apiContracts.length > 0 || authIntegrations.length > 0 || spec.architecture.contracts.length > 0;
  if (!hasRiskSurface) {
    return `## Threat Model

threat-model: not-applicable: the accepted Spec contains no PII, authenticated
integration, or API contract. Reassess if Build Loop adds one.`;
  }
  const lines = ["## Threat Model", "", "**Protected assets:**"];
  if (pii.length) {
    for (const point of pii) lines.push(`- \`${point.id}\` ${point.name}`);
  } else {
    lines.push("- API and architecture-contract data declared in the Spec.");
  }
  lines.push("", "**Trust boundaries:**");
  for (const api of spec.apiContracts) {
    lines.push(`- \`${api.method} ${api.path}\` request/response boundary.`);
  }
  for (const integration of authIntegrations) {
    lines.push(`- ${integration.name} authentication boundary (${integration.authMode}).`);
  }
  for (const contract of spec.architecture.contracts) {
    lines.push(`- Architecture contract \`${contract.id}\` over ${contract.transport}.`);
    for (const note of contract.securityNotes) lines.push(`  - Required security behavior: ${note}`);
  }
  lines.push("", "**Required controls:**");
  for (const point of pii) {
    lines.push(
      `- \`${point.id}\`: ${point.handlingNote?.trim() || "TAG:UNRESOLVED \u2014 define storage, access, retention, and deletion controls."}`
    );
  }
  for (const rule of spec.boundaries?.askFirst ?? []) lines.push(`- Ask first: ${rule}`);
  for (const rule of spec.boundaries?.never ?? []) lines.push(`- Never: ${rule}`);
  if (!pii.length && !(spec.boundaries?.askFirst.length || spec.boundaries?.never.length)) {
    lines.push("- Validate access, input handling, failure behavior, and data exposure.");
  }
  lines.push(
    "",
    "**Verification:** Build Loop must convert these controls into repo-native tests and a security review before implementation closes."
  );
  return lines.join("\n");
}
var ACTIVATION_TOKEN_RULES = [
  { re: /\bstop\s+hook\b/i, label: () => "Stop hook" },
  { re: /\bsessionstart\b/i, label: () => "SessionStart hook" },
  { re: /\bpretooluse\b/i, label: () => "PreToolUse hook" },
  { re: /\bposttooluse\b/i, label: () => "PostToolUse hook" },
  { re: /\bcron\b/i, label: () => "cron schedule" },
  { re: /\blaunchd\b/i, label: () => "launchd job" },
  { re: /\bwatcher\b/i, label: () => "watcher" },
  { re: /\bgit\s+hook\b/i, label: () => "git hook" },
  { re: /\bpre-commit\b/i, label: () => "pre-commit hook" },
  { re: /\bpost-commit\b/i, label: () => "post-commit hook" },
  { re: /\bwebhook\b/i, label: () => "webhook" },
  {
    re: /\b(?:repo-level|lifecycle|codex|claude(?:\s+code)?|session|host)\s+hooks?\b/i,
    label: (m) => capitalize(m.trim().replace(/\s+/g, " "))
  },
  { re: /\bhooks?\.json\b/i, label: () => "hooks.json registration" }
];
function capitalizedWordBefore(text, index) {
  const before = text.slice(0, index);
  const m = /([A-Z][a-z]+)\s*$/.exec(before);
  return m ? m[1] : null;
}
function detectActivationTrigger(text) {
  if (!text) return null;
  for (const rule of ACTIVATION_TOKEN_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const base = rule.label(m[0]);
    const prefix = capitalizedWordBefore(text, m.index);
    return prefix ? `${prefix} ${base}` : base;
  }
  return null;
}
function scanActivationMapEntries(spec) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (component, trigger) => {
    const key = `${component}::${trigger}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ component, trigger });
  };
  for (const integration of spec.integrations) {
    const component = integration.name?.trim() || integration.id;
    for (const line of integration.codeSetup ?? []) {
      const trigger = detectActivationTrigger(line);
      if (trigger) add(component, trigger);
    }
  }
  for (const feature of spec.features) {
    const component = feature.title?.trim() || feature.id;
    const text = [feature.title, feature.description].filter(Boolean).join(" \u2014 ");
    const trigger = detectActivationTrigger(text);
    if (trigger) add(component, trigger);
  }
  return entries;
}
function renderActivationMap(spec) {
  const entries = scanActivationMapEntries(spec);
  if (!entries.length) return "";
  const lines = ["## Activation Map"];
  for (const e of entries) {
    lines.push(`- ${e.component} \u2014 trigger: ${e.trigger} \u2014 verified-live: pending`);
  }
  return lines.join("\n");
}
function cell(value) {
  return value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}
function renderPrimeDirective(spec) {
  const test = spec.acceptanceTest;
  const lines = ["## Prime directive"];
  if (!test) {
    lines.push(
      "",
      unresolved(
        'no prime-directive acceptance test declared in the Spec. Define one observable, time-boxed outcome before implementation closes \u2014 otherwise "done" is whatever the implementer decides it is.'
      )
    );
    return lines.join("\n");
  }
  lines.push(
    "",
    `**${test.id}:** ${test.statement}`,
    "",
    `- **Observable:** ${test.observable}`,
    `- **Time box:** ${test.timeBox}`
  );
  if (test.pillarIds.length) lines.push(`- **Serves pillars:** ${test.pillarIds.join(", ")}`);
  if (test.steps.length) {
    lines.push("", "**Run it:**");
    test.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  lines.push(
    "",
    "This is the terminal gate at the bottom of this plan. Every task below exists to make it pass."
  );
  return lines.join("\n");
}
var PLATFORM_COMMANDS = {
  web: { typecheck: "npm run typecheck", build: "npm run build", test: "npm run test" },
  "vite-spa": { typecheck: "npm run typecheck", build: "npm run build", test: "npm run test" },
  ios: {
    typecheck: "xcodebuild -scheme <Scheme> build",
    build: "xcodebuild -scheme <Scheme> build",
    test: "xcodebuild test -scheme <Scheme>"
  },
  macos: {
    typecheck: "xcodebuild -scheme <Scheme> build",
    build: "xcodebuild -scheme <Scheme> build",
    test: "xcodebuild test -scheme <Scheme>"
  },
  "claude-plugin": {
    typecheck: "claude plugins lint",
    build: "claude plugins lint",
    test: "run the plugin-builder validators (manifest / skill / hook / command)"
  },
  "agent-system": {
    typecheck: "npm run typecheck",
    build: "npm run build",
    test: "run the golden-task suite + safety / permission evals"
  }
};
var LAYER_PHASE_LABEL = {
  scaffold: "Scaffold & data layer",
  dependency: "Pinned dependencies",
  integration: "External integrations",
  contract: "Architecture contracts",
  component: "Architecture components",
  api: "API contracts",
  feature: "Features",
  screen: "UI screens",
  test: "Test suite"
};
function layerAcceptance(layer, cmd) {
  switch (layer) {
    case "scaffold":
      return `\`${cmd.typecheck}\` exits 0 and the data model round-trips every declared data point`;
    case "dependency":
      return `\`${cmd.typecheck}\` exits 0 and every pinned Spec dependency matches its declared schema, revision, and digest`;
    case "integration":
      return `\`${cmd.test}\` passes with provider credentials ABSENT \u2014 the adapter's unavailable path is covered, not skipped`;
    case "contract":
      return `\`${cmd.test}\` passes and every declared provider/consumer contract validates its typed inputs, outputs, and failure modes`;
    case "component":
      return `\`${cmd.test}\` passes and every architecture component satisfies its linked features and contracts`;
    case "api":
      return `\`${cmd.test}\` passes and every declared endpoint returns its contracted response shape`;
    case "feature":
      return `\`${cmd.test}\` passes and each feature's acceptance criteria are asserted, not assumed`;
    case "screen":
      return `\`${cmd.build}\` exits 0 and every declared screen state (loading, empty, error, success) renders`;
    case "test":
      return `\`${cmd.test}\` passes with no skipped, pending, or \`.only\` tests`;
  }
}
function renderPhaseAcceptance(spec, tasks2) {
  const lines = [
    "## Phase acceptance",
    "",
    "> Each phase closes when its acceptance command passes \u2014 not when its tasks look finished.",
    "",
    "| Phase | Scope | Acceptance (runnable) |",
    "|---|---|---|"
  ];
  if (spec.phaseAcceptance?.length) {
    for (const p of spec.phaseAcceptance) {
      lines.push(`| ${cell(p.phase)} | ${cell(p.scope)} | ${cell(p.acceptance)} |`);
    }
    return lines.join("\n");
  }
  if (!tasks2.length) {
    lines.push(
      `| _(none)_ | _no tasks derived_ | ${cell(
        unresolved("capture at least one feature, screen, API contract, or test in the Spec.")
      )} |`
    );
    return lines.join("\n");
  }
  const cmd = spec.projectContext.bootstrap?.commands ?? PLATFORM_COMMANDS[spec.platformTarget];
  const byLayer = /* @__PURE__ */ new Map();
  for (const t of tasks2) {
    const arr = byLayer.get(t.layer) ?? [];
    arr.push(t);
    byLayer.set(t.layer, arr);
  }
  const skeletonLayers = Array.from(byLayer.keys()).filter((l) => l !== "test");
  const skeletonScope = skeletonLayers.length ? `One thin slice through ${skeletonLayers.map((l) => LAYER_PHASE_LABEL[l].toLowerCase()).join(" \u2192 ")}` : "One thin end-to-end slice";
  lines.push(
    `| 0 \u2014 Walking skeleton | ${cell(skeletonScope)} | ${cell(
      `\`${cmd.build}\` exits 0 and the slice runs end to end against real data \u2014 no mocks in the path`
    )} |`
  );
  const order = ["scaffold", "integration", "api", "feature", "screen", "test"];
  let phaseNumber = 0;
  for (const layer of order) {
    const layerTasks = byLayer.get(layer);
    if (!layerTasks?.length) continue;
    phaseNumber++;
    const numbers = layerTasks.map((t) => t.n);
    const scope = numbers.length === 1 ? `Task ${numbers[0]}` : `Tasks ${numbers[0]}\u2013${numbers[numbers.length - 1]}`;
    lines.push(
      `| ${phaseNumber} \u2014 ${LAYER_PHASE_LABEL[layer]} | ${cell(scope)} | ${cell(
        layerAcceptance(layer, cmd)
      )} |`
    );
  }
  return lines.join("\n");
}
function renderInvariantChecks(spec) {
  const invariants = spec.architecturalInvariants ?? [];
  if (!invariants.length) return "";
  const lines = [
    "## Architectural invariants (executable checks)",
    "",
    "> Each check must exit 0 after every task below. A non-zero exit is a violated invariant \u2014 fix the code, do not relax the check.",
    ""
  ];
  for (const i of invariants) {
    const pillars = i.pillarIds.length ? ` _(serves ${i.pillarIds.join(", ")})_` : "";
    lines.push(`- **${i.id}** ${i.rule}${pillars}`);
    lines.push(`  - \`${i.check}\``);
  }
  lines.push("", "```bash", ...invariants.map((i) => i.check), "```");
  return lines.join("\n");
}
function featureNfrDoD(nfr) {
  if (!nfr) return [];
  const out = [];
  if (nfr.testStrategy?.trim()) out.push(`Test strategy: ${nfr.testStrategy.trim()}`);
  for (const item of nfr.edgeCases) out.push(`Edge case handled: ${item}`);
  for (const item of nfr.errorHandling) out.push(`Error handling: ${item}`);
  for (const item of nfr.validation) out.push(`Validation: ${item}`);
  for (const item of nfr.security) out.push(`Security: ${item}`);
  for (const item of nfr.accessibility) out.push(`Accessibility: ${item}`);
  return out;
}
function renderTerminalGate(spec) {
  const cmd = spec.projectContext.bootstrap?.commands ?? PLATFORM_COMMANDS[spec.platformTarget];
  const lines = [
    "## Terminal gate \u2014 do not report done until every line passes",
    ""
  ];
  const test = spec.acceptanceTest;
  lines.push(
    test ? `- [ ] **Prime directive passes.** ${test.statement} \u2014 observed as: ${test.observable}; inside: ${test.timeBox}.` : `- [ ] ${unresolved(
      "no prime-directive acceptance test to run. Define one in the Spec, regenerate, then close this gate."
    )}`
  );
  const invariants = spec.architecturalInvariants ?? [];
  lines.push(
    invariants.length ? `- [ ] **Every architectural invariant check exits 0** (${invariants.length} check(s); see "Architectural invariants" above).` : "- [ ] **No architectural invariants declared** \u2014 confirm none is needed rather than assuming it."
  );
  const budget = spec.performanceBudget ?? [];
  lines.push(
    budget.length ? `- [ ] **Performance budget met:** ${budget.map((b) => `${b.metric} ${b.budget}`).join("; ")}.` : `- [ ] ${unresolved(
      "no performance budget declared. Measure the user-visible operations and record the numbers, or state that no budget applies."
    )}`
  );
  const nfr = spec.nfr;
  const nfrGaps = [];
  if (!nfr?.testStrategy?.trim()) nfrGaps.push("test strategy");
  if (!nfr?.edgeCases.length) nfrGaps.push("edge cases");
  if (!nfr?.errorHandling.length) nfrGaps.push("error handling");
  if (!nfr?.validation.length) nfrGaps.push("validation");
  if (!nfr?.security.length) nfrGaps.push("security");
  if (!nfr?.accessibility.length) nfrGaps.push("accessibility");
  lines.push(
    nfrGaps.length ? `- [ ] ${unresolved(
      `non-functional requirements are unanswered for: ${nfrGaps.join(", ")}. Answer each in the Spec's \`nfr\` block (see requirements.md) or record why it does not apply.`
    )}` : "- [ ] **Every non-functional requirement is satisfied** (test strategy, edge cases, error handling, validation, security, accessibility)."
  );
  const verification = Array.from(/* @__PURE__ */ new Set([cmd.typecheck, cmd.build, cmd.test]));
  lines.push(
    `- [ ] **Repo-native verification passes:** ${verification.map((c) => `\`${c}\``).join(", ")}.`,
    "- [ ] **No `TAG:UNRESOLVED` or `TAG:ASSUMED` marker remains** in this artifact set unresolved or unacknowledged.",
    "- [ ] **No mock data, dead control, placeholder copy, or fake integration** survives in a user-facing path.",
    '- [ ] **The Spec reflects what was built** (see "Spec \u2194 code sync" below).'
  );
  return lines.join("\n");
}
function renderSpecCodeSyncSection(spec) {
  return `## Spec \u2194 code sync

${renderSpecCodeSync(spec)}`;
}
function renderReadingContractSection(spec) {
  return `## How to read this

${renderReadingContract(spec)}`;
}
function renderTask(t, _platform) {
  const lines = [`## Task ${t.n} \u2014 ${t.title}`];
  lines.push("", `**Task ID:** \`${t.id}\``, `**Layer:** ${t.layer}`);
  lines.push("", "**Owned files:**");
  if (t.ownershipSource === "explicit" || t.plannedNewFiles.length) lines.push(`- Ownership source: **${t.ownershipSource}**`);
  for (const f of t.ownedFiles) lines.push(`- \`${f}\`${t.plannedNewFiles.includes(f) ? " \u2014 planned new" : t.ownershipSource === "explicit" ? " \u2014 expected existing" : ""}`);
  lines.push("", "**Definition of done:**");
  if (t.dod.length === 0) {
    lines.push("- _No acceptance criteria captured \u2014 confirm with the user._");
  } else {
    for (const d of t.dod) lines.push(`- ${d}`);
  }
  lines.push(
    "",
    `**Dependencies:** ${t.deps.length ? t.deps.map((d) => `Task ${d}`).join(", ") : "none"}`
  );
  lines.push(
    `**Satisfies:** ${t.satisfies.length ? t.satisfies.map((s) => `\`${s}\``).join(", ") : "_(no linked IDs)_"}`
  );
  return lines.join("\n");
}
function renderTraceabilityNote(tasks2) {
  if (tasks2.length === 0) return "";
  const covered = /* @__PURE__ */ new Set();
  for (const t of tasks2) for (const s of t.satisfies) covered.add(s);
  return `---

_Traceability: ${tasks2.length} task(s) covering ${covered.size} requirement/feature/API/screen/test ID(s). Every dependency reference points at an earlier task number._`;
}
function slug(s) {
  const out = (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || "item";
}
function pascal(s) {
  const parts = (s ?? "").split(/[^a-zA-Z0-9]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.join("") || "Item";
}
function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length <= n ? s : `${s.slice(0, n - 1)}\u2026`;
}
function inline(s) {
  const one = s.replace(/\s+/g, " ").trim();
  return "`" + truncate(one, 200) + "`";
}
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function uniqueSorted(nums) {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}
var SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{24,}\b/g,
  /\bgho_[A-Za-z0-9]{24,}\b/g,
  /\bAKIA[0-9A-Z]{12,20}\b/g,
  /\baws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+]{30,}\b/gi,
  /\b[A-Za-z0-9_-]{40,}\b\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
  // jwt-shaped
];
function scrubSecretShapedStrings(s) {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

// engine/src/atomic-write.ts
import * as crypto2 from "node:crypto";
import * as fs2 from "node:fs";
import * as path2 from "node:path";
var SHA256_RE = /^[a-f0-9]{64}$/;
var TRANSACTION_PREFIX = ".groundwork-tx-";
function sha256(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
function fsyncFile(file) {
  const fd = fs2.openSync(file, "r");
  try {
    fs2.fsyncSync(fd);
  } finally {
    fs2.closeSync(fd);
  }
}
function fsyncDir(dir) {
  const fd = fs2.openSync(dir, "r");
  try {
    fs2.fsyncSync(fd);
  } finally {
    fs2.closeSync(fd);
  }
}
function safeManagedName(name) {
  return Boolean(name) && !path2.isAbsolute(name) && path2.dirname(name) === "." && name !== "." && name !== ".." && !name.includes("\\") && !name.includes("/");
}
function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}
function safeTopLevelPath(root, name, label) {
  if (!safeManagedName(name)) throw new Error(`${label} contains an unsafe managed file name.`);
  const absoluteRoot = path2.resolve(root);
  const candidate = path2.resolve(absoluteRoot, name);
  if (path2.dirname(candidate) !== absoluteRoot) throw new Error(`${label} escapes its managed directory.`);
  return candidate;
}
function requireSafeRegularFile(file, label, maxBytes) {
  const stat = fs2.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file.`);
  if (maxBytes !== void 0 && stat.size > maxBytes) throw new Error(`${label} exceeds its size limit.`);
  return stat;
}
function requireSafeDirectory(dir, label) {
  const stat = fs2.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink directory.`);
}
function parseManifest(value, label) {
  const raw = record(value, label);
  exactKeys(raw, ["schema", "generationId", "generatedAt", "files"], label);
  if (raw.schema !== "groundwork.artifacts/v1" || typeof raw.generationId !== "string" || !raw.generationId || typeof raw.generatedAt !== "string" || !raw.generatedAt || !Array.isArray(raw.files)) {
    throw new Error(`${label} has an invalid contract.`);
  }
  const seen = /* @__PURE__ */ new Set();
  const files = raw.files.map((value2, index) => {
    const entry = record(value2, `${label}.files[${index}]`);
    exactKeys(entry, ["name", "sha256"], `${label}.files[${index}]`);
    if (typeof entry.name !== "string" || !safeManagedName(entry.name)) {
      throw new Error(`${label}.files[${index}] contains an unsafe managed file name.`);
    }
    if (seen.has(entry.name)) throw new Error(`${label} contains duplicate file ${entry.name}.`);
    seen.add(entry.name);
    if (typeof entry.sha256 !== "string" || !SHA256_RE.test(entry.sha256)) {
      throw new Error(`${label}.files[${index}].sha256 is invalid.`);
    }
    return { name: entry.name, sha256: entry.sha256 };
  });
  return {
    schema: "groundwork.artifacts/v1",
    generationId: raw.generationId,
    generatedAt: raw.generatedAt,
    files
  };
}
function parseJournal(value) {
  const raw = record(value, "Transaction journal");
  const isLegacy = raw.schema === void 0;
  const isV2 = raw.schema === "groundwork.transaction/v2";
  exactKeys(
    raw,
    isLegacy ? ["generationId", "files", "hashes"] : isV2 ? ["schema", "generationId", "files", "hashes"] : ["schema", "generationId", "files", "hashes", "manifestSha256"],
    "Transaction journal"
  );
  if (!isLegacy && !isV2 && raw.schema !== "groundwork.transaction/v3" || typeof raw.generationId !== "string" || !raw.generationId || !Array.isArray(raw.files)) {
    throw new Error("Transaction journal has an invalid contract.");
  }
  const manifestSha256 = raw.schema === "groundwork.transaction/v3" ? raw.manifestSha256 : null;
  if (manifestSha256 !== null && (typeof manifestSha256 !== "string" || !SHA256_RE.test(manifestSha256))) {
    throw new Error("Transaction journal manifestSha256 is invalid.");
  }
  const hashesRaw = record(raw.hashes, "Transaction journal hashes");
  const hashes = {};
  for (const [name, hash] of Object.entries(hashesRaw)) {
    if (!safeManagedName(name) || typeof hash !== "string" || !SHA256_RE.test(hash)) {
      throw new Error("Transaction journal contains an unsafe name or invalid hash.");
    }
    hashes[name] = hash;
  }
  const seen = /* @__PURE__ */ new Set();
  const files = raw.files.map((value2, index) => {
    const item = record(value2, `Transaction journal files[${index}]`);
    exactKeys(
      item,
      isLegacy ? ["name", "existed"] : ["name", "existed", "operation"],
      `Transaction journal files[${index}]`
    );
    if (typeof item.name !== "string" || !safeManagedName(item.name)) {
      throw new Error(`Transaction journal files[${index}] contains an unsafe managed file name.`);
    }
    if (seen.has(item.name)) throw new Error(`Transaction journal contains duplicate file ${item.name}.`);
    seen.add(item.name);
    if (typeof item.existed !== "boolean") throw new Error(`Transaction journal files[${index}].existed is invalid.`);
    const operation = isLegacy ? "publish" : item.operation;
    if (operation !== "publish" && operation !== "remove") {
      throw new Error(`Transaction journal files[${index}].operation is invalid.`);
    }
    if (operation === "remove" && item.name === "artifact-manifest.json") {
      throw new Error("Transaction journal cannot remove artifact-manifest.json.");
    }
    return { name: item.name, existed: item.existed, operation };
  });
  const manifestItems = files.filter((item) => item.name === "artifact-manifest.json");
  if (manifestItems.length !== 1 || manifestItems[0].operation !== "publish" || files.at(-1)?.name !== "artifact-manifest.json") {
    throw new Error("Transaction journal must publish artifact-manifest.json exactly once and last.");
  }
  for (const name of Object.keys(hashes)) {
    if (!files.some((item) => item.name === name && item.operation === "publish")) {
      throw new Error(`Transaction journal hash ${name} has no publish operation.`);
    }
  }
  for (const item of files) {
    if (item.name === "artifact-manifest.json") continue;
    if (item.operation === "publish" && hashes[item.name] === void 0) {
      throw new Error(`Transaction journal publish ${item.name} has no content hash.`);
    }
    if (item.operation === "remove" && hashes[item.name] !== void 0) {
      throw new Error(`Transaction journal removal ${item.name} cannot carry a content hash.`);
    }
  }
  return {
    schema: "groundwork.transaction/v3",
    generationId: raw.generationId,
    files,
    hashes,
    manifestSha256
  };
}
function readJsonFile(file, label, maxBytes) {
  requireSafeRegularFile(file, label, maxBytes);
  return JSON.parse(fs2.readFileSync(file, "utf8"));
}
function validateTransactionLayout(txDir, journal) {
  requireSafeDirectory(txDir, "Transaction directory");
  const allowedRootEntries = /* @__PURE__ */ new Set(["journal.json", "stage", "backup"]);
  for (const name of fs2.readdirSync(txDir)) {
    if (!allowedRootEntries.has(name)) throw new Error(`Transaction directory contains unexpected entry ${name}.`);
  }
  const stageDir = path2.join(txDir, "stage");
  const backupDir = path2.join(txDir, "backup");
  requireSafeDirectory(stageDir, "Transaction stage directory");
  requireSafeDirectory(backupDir, "Transaction backup directory");
  const expected = new Set(journal.files.map((item) => item.name));
  for (const [dir, label] of [[stageDir, "stage"], [backupDir, "backup"]]) {
    for (const name of fs2.readdirSync(dir)) {
      if (!expected.has(name) || !safeManagedName(name)) {
        throw new Error(`Transaction ${label} contains unexpected entry ${name}.`);
      }
      requireSafeRegularFile(safeTopLevelPath(dir, name, `Transaction ${label}`), `Transaction ${label} file ${name}`);
    }
  }
}
function manifestMatches(outDir, journal) {
  const manifestPath = path2.join(outDir, "artifact-manifest.json");
  try {
    const manifestBytes = fs2.readFileSync(manifestPath);
    if (journal.manifestSha256 && sha256(manifestBytes.toString("utf8")) !== journal.manifestSha256) return false;
    const manifest = parseManifest(
      JSON.parse(manifestBytes.toString("utf8")),
      "artifact-manifest.json"
    );
    if (manifest.generationId !== journal.generationId) return false;
    const manifestHashes = Object.fromEntries(manifest.files.map((entry) => [entry.name, entry.sha256]));
    const expectedHashNames = Object.keys(journal.hashes).sort();
    if (JSON.stringify(Object.keys(manifestHashes).sort()) !== JSON.stringify(expectedHashNames)) return false;
    for (const [name, hash] of Object.entries(journal.hashes)) {
      const file = safeTopLevelPath(outDir, name, "Transaction manifest check");
      if (!fs2.existsSync(file)) return false;
      requireSafeRegularFile(file, `Managed artifact ${name}`);
      if (manifestHashes[name] !== hash || sha256(fs2.readFileSync(file, "utf8")) !== hash) return false;
    }
    for (const item of journal.files) {
      if (item.operation !== "remove") continue;
      if (fs2.existsSync(safeTopLevelPath(outDir, item.name, "Transaction removal check"))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
function priorManagedRemovals(outDir, nextNames) {
  const manifestPath = path2.join(outDir, "artifact-manifest.json");
  if (!fs2.existsSync(manifestPath)) return [];
  const manifest = parseManifest(
    readJsonFile(manifestPath, "Existing artifact-manifest.json", 512 * 1024),
    "Existing artifact-manifest.json"
  );
  const removals = [];
  for (const entry of manifest.files) {
    if (nextNames.has(entry.name)) continue;
    const file = safeTopLevelPath(outDir, entry.name, "Existing artifact manifest");
    if (!fs2.existsSync(file)) continue;
    requireSafeRegularFile(file, `Previously managed artifact ${entry.name}`);
    if (sha256(fs2.readFileSync(file, "utf8")) !== entry.sha256) {
      throw new Error(`Refusing to remove modified managed artifact: ${entry.name}`);
    }
    removals.push(entry.name);
  }
  return removals.sort();
}
function installedFileMatches(file, item, journal) {
  if (item.operation === "remove") return !fs2.existsSync(file);
  try {
    requireSafeRegularFile(file, `Installed artifact ${item.name}`);
    const expected = item.name === "artifact-manifest.json" ? journal.manifestSha256 : journal.hashes[item.name];
    if (typeof expected === "string") return sha256(fs2.readFileSync(file, "utf8")) === expected;
    if (item.name !== "artifact-manifest.json") return false;
    const legacyManifest = parseManifest(JSON.parse(fs2.readFileSync(file, "utf8")), "Installed legacy artifact manifest");
    return legacyManifest.generationId === journal.generationId && JSON.stringify(Object.fromEntries(legacyManifest.files.map((entry) => [entry.name, entry.sha256]))) === JSON.stringify(journal.hashes);
  } catch {
    return false;
  }
}
function quarantineConcurrentArtifact(outDir, generationId, name, file, conflictRoot) {
  const root = conflictRoot ?? fs2.mkdtempSync(
    path2.join(path2.dirname(outDir), `.groundwork-artifact-conflict-${path2.basename(outDir)}-${generationId}-`)
  );
  const destination = path2.join(root, name);
  fs2.mkdirSync(path2.dirname(destination), { recursive: true });
  fs2.renameSync(file, destination);
  fsyncDir(root);
  return root;
}
function recoverArtifactTransactions(outDir) {
  if (!fs2.existsSync(outDir)) return;
  requireSafeDirectory(outDir, "Groundwork output directory");
  for (const entry of fs2.readdirSync(outDir).sort()) {
    if (!entry.startsWith(TRANSACTION_PREFIX)) continue;
    if (!safeManagedName(entry)) throw new Error("Groundwork output contains an unsafe transaction name.");
    const txDir = safeTopLevelPath(outDir, entry, "Groundwork transaction");
    requireSafeDirectory(txDir, "Transaction directory");
    const journalPath = path2.join(txDir, "journal.json");
    let journal;
    try {
      journal = parseJournal(readJsonFile(journalPath, "Transaction journal", 512 * 1024));
      if (entry !== `${TRANSACTION_PREFIX}${journal.generationId}`) {
        throw new Error("Transaction directory name does not match its generationId.");
      }
      validateTransactionLayout(txDir, journal);
    } catch (error) {
      throw new Error(`Cannot safely recover incomplete Groundwork transaction ${entry}: ${error.message}`);
    }
    if (!manifestMatches(outDir, journal)) {
      const stageDir = path2.join(txDir, "stage");
      const backupDir = path2.join(txDir, "backup");
      let conflictRoot;
      for (const item of [...journal.files].reverse()) {
        const finalPath = safeTopLevelPath(outDir, item.name, "Transaction destination");
        const backupPath = safeTopLevelPath(backupDir, item.name, "Transaction backup");
        const stagedPath = safeTopLevelPath(stageDir, item.name, "Transaction stage");
        if (fs2.existsSync(backupPath)) {
          requireSafeRegularFile(backupPath, `Transaction backup ${item.name}`);
          if (fs2.existsSync(finalPath)) {
            if (installedFileMatches(finalPath, item, journal)) fs2.rmSync(finalPath, { force: true });
            else conflictRoot = quarantineConcurrentArtifact(outDir, journal.generationId, item.name, finalPath, conflictRoot);
          }
          fs2.renameSync(backupPath, finalPath);
        } else if (!item.existed && fs2.existsSync(finalPath)) {
          if (installedFileMatches(finalPath, item, journal)) fs2.rmSync(finalPath, { force: true });
          else conflictRoot = quarantineConcurrentArtifact(outDir, journal.generationId, item.name, finalPath, conflictRoot);
        }
      }
      fs2.rmSync(txDir, { recursive: true, force: true });
      if (conflictRoot) {
        throw new Error(`Concurrent artifact bytes were preserved at ${conflictRoot}; the prior generation was restored.`);
      }
      continue;
    }
    fs2.rmSync(txDir, { recursive: true, force: true });
  }
}
function writeArtifactSetAtomically(outDir, artifacts) {
  fs2.mkdirSync(outDir, { recursive: true });
  recoverArtifactTransactions(outDir);
  const names = Object.keys(artifacts).sort();
  if (names.some((name) => !safeManagedName(name)) || names.includes("artifact-manifest.json")) {
    throw new Error("Groundwork artifact names must be safe top-level relative filenames and must not replace the managed manifest.");
  }
  const removalNames = priorManagedRemovals(outDir, new Set(names));
  const generationId = crypto2.randomUUID();
  const hashes = Object.fromEntries(names.map((name) => [name, sha256(artifacts[name])]));
  const manifest = JSON.stringify({
    schema: "groundwork.artifacts/v1",
    generationId,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: names.map((name) => ({ name, sha256: hashes[name] }))
  }, null, 2) + "\n";
  const allArtifacts = {
    ...artifacts,
    "artifact-manifest.json": manifest
  };
  const operations = [
    ...names.map((name) => ({
      name,
      existed: fs2.existsSync(safeTopLevelPath(outDir, name, "Artifact destination")),
      operation: "publish"
    })),
    ...removalNames.map((name) => ({ name, existed: true, operation: "remove" })),
    {
      name: "artifact-manifest.json",
      existed: fs2.existsSync(path2.join(outDir, "artifact-manifest.json")),
      operation: "publish"
    }
  ];
  const txDir = path2.join(outDir, `${TRANSACTION_PREFIX}${generationId}`);
  const stageDir = path2.join(txDir, "stage");
  const backupDir = path2.join(txDir, "backup");
  fs2.mkdirSync(stageDir, { recursive: true });
  fs2.mkdirSync(backupDir, { recursive: true });
  const journal = {
    schema: "groundwork.transaction/v3",
    generationId,
    files: operations,
    hashes,
    manifestSha256: sha256(manifest)
  };
  try {
    for (const item of operations) {
      const finalPath = safeTopLevelPath(outDir, item.name, "Artifact destination");
      if (fs2.existsSync(finalPath)) requireSafeRegularFile(finalPath, `Managed artifact destination ${item.name}`);
      if (item.operation === "remove") continue;
      const staged = safeTopLevelPath(stageDir, item.name, "Artifact stage");
      fs2.writeFileSync(staged, allArtifacts[item.name], { encoding: "utf8", flag: "wx" });
      fsyncFile(staged);
      if (item.name.endsWith(".json")) JSON.parse(fs2.readFileSync(staged, "utf8"));
    }
    fs2.writeFileSync(path2.join(txDir, "journal.json"), JSON.stringify(journal, null, 2), { flag: "wx" });
    fsyncFile(path2.join(txDir, "journal.json"));
  } catch (error) {
    fs2.rmSync(txDir, { recursive: true, force: true });
    throw error;
  }
  let installed = 0;
  const touched = [];
  try {
    for (const item of operations) {
      touched.push(item);
      const finalPath = safeTopLevelPath(outDir, item.name, "Artifact destination");
      const backupPath = safeTopLevelPath(backupDir, item.name, "Artifact backup");
      if (fs2.existsSync(finalPath)) fs2.renameSync(finalPath, backupPath);
      if (item.operation === "publish") {
        if (process.env.GROUNDWORK_TEST_INSERT_ARTIFACT_BEFORE_INSTALL === item.name) {
          fs2.writeFileSync(finalPath, "concurrent-before-install\n", { flag: "wx" });
        }
        const stagedPath = safeTopLevelPath(stageDir, item.name, "Artifact stage");
        fs2.linkSync(stagedPath, finalPath);
        fs2.unlinkSync(stagedPath);
      }
      installed += 1;
      if (process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL === item.name && fs2.existsSync(finalPath)) {
        fs2.writeFileSync(finalPath, "concurrent-preserve\n");
      }
      if (Number(process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL) === installed) {
        throw new Error(`Injected artifact transaction failure after ${installed} install(s).`);
      }
    }
    fsyncDir(outDir);
    if (!manifestMatches(outDir, journal)) {
      throw new Error("Installed artifact generation changed during publication.");
    }
    fs2.rmSync(txDir, { recursive: true, force: true });
    return [...names, "artifact-manifest.json"].map((name) => path2.join(outDir, name));
  } catch (error) {
    let conflictRoot;
    for (const item of [...touched].reverse()) {
      const finalPath = safeTopLevelPath(outDir, item.name, "Artifact destination");
      const backupPath = safeTopLevelPath(backupDir, item.name, "Artifact backup");
      if (fs2.existsSync(backupPath)) {
        requireSafeRegularFile(backupPath, `Artifact backup ${item.name}`);
        if (fs2.existsSync(finalPath)) {
          if (installedFileMatches(finalPath, item, journal)) fs2.rmSync(finalPath, { force: true });
          else conflictRoot = quarantineConcurrentArtifact(outDir, generationId, item.name, finalPath, conflictRoot);
        }
        fs2.renameSync(backupPath, finalPath);
      } else if (!item.existed && fs2.existsSync(finalPath)) {
        if (installedFileMatches(finalPath, item, journal)) fs2.rmSync(finalPath, { force: true });
        else conflictRoot = quarantineConcurrentArtifact(outDir, generationId, item.name, finalPath, conflictRoot);
      }
    }
    fs2.rmSync(txDir, { recursive: true, force: true });
    if (conflictRoot) {
      throw new Error(`${error.message} Concurrent artifact bytes were preserved at ${conflictRoot}.`, { cause: error });
    }
    throw error;
  }
}

// engine/src/traceability.ts
function buildTraceability(spec, tasks2) {
  const needToFeatures = {};
  const needToTests = {};
  const needToTasks = {};
  const featureToApis = {};
  const featureToTests = {};
  const featureToScreens = {};
  const featureToIntegrations = {};
  const featureToTasks = {};
  const screenToTasks = {};
  const screenToTests = {};
  const integrationToTasks = {};
  const integrationToTests = {};
  const taskToTests = {};
  const adrToTargets = {};
  const entityToFeatures = {};
  const flowToScreens = {};
  const pillarToNeeds = {};
  const pillarToFeatures = {};
  const pillarToInvariants = {};
  const pillarToTasks = {};
  const pillarToAcceptance = {};
  const platformSurfaceToTests = {};
  const componentToFeatures = {};
  const componentToTasks = {};
  const contractToComponents = {};
  const contractToTasks = {};
  const relationshipToTasks = {};
  const architectureFlowToTasks = {};
  const specDependencyToRefs = {};
  const taskDependencies = {};
  const taskToOwnedFiles = {};
  const taskOwnershipSource = {};
  const taskToPlannedNewFiles = {};
  const behaviorToScreens = {};
  const behaviorToElements = {};
  const behaviorToComponents = {};
  const behaviorToTasks = {};
  const behaviorToScopeRefs = {};
  const behaviorToStates = {};
  const behaviorToActions = {};
  const behaviorToVerifications = {};
  const behaviorToTests = {};
  const decisionToConstraints = {};
  const decisionToScopeRefs = {};
  const decisionToScreens = {};
  const decisionToElements = {};
  const decisionToComponents = {};
  const decisionToTasks = {};
  const decisionToTests = {};
  const decisionSupersession = {};
  const baselineToDeltas = {};
  const constraintToVerifications = {};
  const deltaToTargets = {};
  const deltaToVerifications = {};
  const coverageGaps = [];
  const uiImpact = [];
  const uniqueSorted2 = (values) => [...new Set(values)].sort();
  const intersects = (left, right) => left.some((value) => right.has(value));
  const tasksFor = (id) => tasks2.filter((task) => task.layer !== "test" && task.satisfies.includes(id)).map((task) => task.id);
  const testsForTask = (task) => spec.tests.filter((candidate) => {
    if (task.layer === "feature") return candidate.featureIds.some((id) => task.satisfies.includes(id));
    if (task.layer === "screen") return candidate.screenIds.some((id) => task.satisfies.includes(id));
    if (task.layer === "integration") return candidate.integrationIds.some((id) => task.satisfies.includes(id));
    if (task.layer === "test") return task.satisfies.includes(candidate.id);
    return false;
  }).map((candidate) => candidate.id);
  for (const task of tasks2) {
    const repositoryFiles = task.ownedFiles.filter((file) => !file.startsWith("dependency:") && !file.startsWith("validators:") && !file.startsWith("TODO:"));
    taskToOwnedFiles[task.id] = repositoryFiles;
    taskOwnershipSource[task.id] = task.ownershipSource;
    if (task.plannedNewFiles.length) taskToPlannedNewFiles[task.id] = [...task.plannedNewFiles];
  }
  for (const need of spec.needs) {
    needToFeatures[need.id] = spec.features.filter((feature) => feature.needIds.includes(need.id)).map((feature) => feature.id);
    needToTests[need.id] = spec.tests.filter((test) => test.needIds.includes(need.id)).map((test) => test.id);
    needToTasks[need.id] = tasksFor(need.id);
    if (!needToFeatures[need.id].length) coverageGaps.push({ kind: "need", id: need.id, missing: "feature" });
  }
  for (const feature of spec.features) {
    featureToApis[feature.id] = spec.apiContracts.filter((api) => api.featureIds.includes(feature.id)).map((api) => api.id);
    featureToTests[feature.id] = spec.tests.filter((test) => test.featureIds.includes(feature.id)).map((test) => test.id);
    featureToScreens[feature.id] = spec.screens.filter((screen) => screen.featureIds.includes(feature.id)).map((screen) => screen.id);
    featureToIntegrations[feature.id] = spec.integrations.filter((integration) => integration.featureIds.includes(feature.id)).map((integration) => integration.id);
    featureToTasks[feature.id] = tasksFor(feature.id);
    if (feature.surface === "ui" && !featureToScreens[feature.id].length) coverageGaps.push({ kind: "feature", id: feature.id, missing: "screen" });
    if (feature.surface === "api" && !featureToApis[feature.id].length) coverageGaps.push({ kind: "feature", id: feature.id, missing: "api" });
  }
  for (const screen of spec.screens) {
    screenToTasks[screen.id] = tasksFor(screen.id);
    screenToTests[screen.id] = spec.tests.filter((test) => test.screenIds.includes(screen.id)).map((test) => test.id);
  }
  for (const integration of spec.integrations) {
    integrationToTasks[integration.id] = tasksFor(integration.id);
    integrationToTests[integration.id] = spec.tests.filter((test) => test.integrationIds.includes(integration.id)).map((test) => test.id);
  }
  const taskByNumber = new Map(tasks2.map((task) => [task.n, task.id]));
  for (const task of tasks2) {
    taskToTests[task.id] = testsForTask(task);
    taskDependencies[task.id] = task.deps.map((number) => taskByNumber.get(number)).filter(Boolean);
    if (["feature", "screen", "integration"].includes(task.layer) && !taskToTests[task.id].length) {
      coverageGaps.push({ kind: "task", id: task.id, missing: "test" });
    }
  }
  for (const adr of spec.adrs) adrToTargets[adr.id] = adr.cites;
  for (const entity of spec.dataModel) {
    entityToFeatures[entity.id] = [.../* @__PURE__ */ new Set([...entity.readByFeatureIds ?? [], ...entity.writtenByFeatureIds ?? []])];
  }
  for (const flow of spec.uxFlows) flowToScreens[flow.id] = flow.screenIds;
  for (const behavior of spec.behaviorContracts ?? []) {
    const refs = uniqueSorted2(behavior.scope.refs);
    const elements = uniqueSorted2(refs.filter((id) => spec.screens.some((screen) => (screen.elements ?? []).some((element) => element.id === id))));
    const directlyScopedComponents = spec.architecture.components.filter((component) => refs.includes(component.id));
    const screens = uniqueSorted2(spec.screens.filter((screen) => refs.includes(screen.id) || (screen.elements ?? []).some((element) => elements.includes(element.id)) || directlyScopedComponents.some((component) => component.featureIds.some((id) => screen.featureIds.includes(id)))).map((screen) => screen.id));
    const reachedFeatures = new Set(spec.screens.filter((screen) => screens.includes(screen.id)).flatMap((screen) => screen.featureIds));
    const components = uniqueSorted2(spec.architecture.components.filter((component) => refs.includes(component.id) || component.featureIds.some((id) => reachedFeatures.has(id))).map((component) => component.id));
    behaviorToScopeRefs[behavior.id] = refs;
    behaviorToScreens[behavior.id] = screens;
    behaviorToElements[behavior.id] = elements;
    behaviorToComponents[behavior.id] = components;
    behaviorToStates[behavior.id] = uniqueSorted2(behavior.states.map((state) => state.id));
    behaviorToActions[behavior.id] = uniqueSorted2(behavior.actions.map((action) => action.id));
    behaviorToVerifications[behavior.id] = uniqueSorted2(behavior.verificationRefs);
    behaviorToTests[behavior.id] = uniqueSorted2(spec.tests.filter((candidate) => candidate.screenIds.some((id) => behaviorToScreens[behavior.id]?.includes(id))).map((candidate) => candidate.id));
    behaviorToTasks[behavior.id] = uniqueSorted2([...refs, ...screens, ...components].flatMap(tasksFor));
  }
  for (const decision of spec.adrs) {
    const constraintRefs = uniqueSorted2(decision.constraintRefs ?? []);
    const constraintTargets = spec.designContract?.constraints.filter((item) => constraintRefs.includes(item.id)).map((item) => item.targetRef) ?? [];
    const refs = uniqueSorted2([...decision.scope?.refs ?? [], ...constraintTargets]);
    const elements = uniqueSorted2(refs.filter((id) => spec.screens.some((screen) => (screen.elements ?? []).some((element) => element.id === id))));
    const directlyScopedComponents = spec.architecture.components.filter((component) => refs.includes(component.id));
    const screens = uniqueSorted2(spec.screens.filter((screen) => refs.includes(screen.id) || (screen.elements ?? []).some((element) => elements.includes(element.id)) || directlyScopedComponents.some((component) => component.featureIds.some((id) => screen.featureIds.includes(id)))).map((screen) => screen.id));
    const reachedFeatures = new Set(spec.screens.filter((screen) => screens.includes(screen.id)).flatMap((screen) => screen.featureIds));
    const components = uniqueSorted2(spec.architecture.components.filter((component) => refs.includes(component.id) || component.featureIds.some((id) => reachedFeatures.has(id))).map((component) => component.id));
    const verificationRefs = uniqueSorted2(spec.designContract?.constraints.filter((item) => constraintRefs.includes(item.id)).flatMap((item) => item.verificationRefs) ?? []);
    decisionToConstraints[decision.id] = constraintRefs;
    decisionToScopeRefs[decision.id] = refs;
    decisionToScreens[decision.id] = screens;
    decisionToElements[decision.id] = elements;
    decisionToComponents[decision.id] = components;
    decisionToTasks[decision.id] = uniqueSorted2([...refs, ...screens, ...components].flatMap(tasksFor));
    decisionToTests[decision.id] = uniqueSorted2([...spec.tests.filter((test) => test.screenIds.some((id) => screens.includes(id))).map((test) => test.id), ...verificationRefs]);
    if (decision.supersededBy) decisionSupersession[decision.id] = decision.supersededBy;
  }
  if (spec.designContract) {
    if (spec.designContract.baseline.id) baselineToDeltas[spec.designContract.baseline.id] = uniqueSorted2(spec.designContract.deltas.map((delta) => delta.id));
    for (const constraint of spec.designContract.constraints) constraintToVerifications[constraint.id] = uniqueSorted2(constraint.verificationRefs);
    for (const delta of spec.designContract.deltas) {
      deltaToTargets[delta.id] = uniqueSorted2(delta.targetRefs);
      deltaToVerifications[delta.id] = uniqueSorted2(delta.verificationRefs);
    }
  }
  const pillars = spec.pillars ?? [];
  const invariants = spec.architecturalInvariants ?? [];
  if (pillars.length) {
    for (const pillar of pillars) {
      const needIds = spec.needs.filter((need) => need.pillarIds.includes(pillar.id)).map((need) => need.id);
      const featureIds = spec.features.filter((feature) => feature.needIds.some((id) => needIds.includes(id))).map((feature) => feature.id);
      const reached = /* @__PURE__ */ new Set([...needIds, ...featureIds]);
      pillarToNeeds[pillar.id] = needIds;
      pillarToFeatures[pillar.id] = featureIds;
      pillarToInvariants[pillar.id] = invariants.filter((invariant) => invariant.pillarIds.includes(pillar.id)).map((invariant) => invariant.id);
      pillarToTasks[pillar.id] = tasks2.filter((task) => task.layer !== "test" && task.satisfies.some((id) => reached.has(id))).map((task) => task.id);
      const acceptance = spec.tests.filter((test) => test.needIds.some((id) => reached.has(id)) || test.featureIds.some((id) => reached.has(id))).map((test) => test.id);
      if (spec.acceptanceTest?.pillarIds.includes(pillar.id)) acceptance.push(spec.acceptanceTest.id);
      pillarToAcceptance[pillar.id] = acceptance;
      if (!needIds.length) coverageGaps.push({ kind: "pillar", id: pillar.id, missing: "need" });
      else if (!acceptance.length) coverageGaps.push({ kind: "pillar", id: pillar.id, missing: "acceptance" });
    }
    for (const need of spec.needs) {
      if (!need.pillarIds.length) coverageGaps.push({ kind: "need", id: need.id, missing: "pillar" });
    }
  }
  for (const surface of spec.platformSurfaces) {
    platformSurfaceToTests[surface.id] = spec.tests.filter((candidate) => candidate.platformSurfaceIds.includes(surface.id)).map((candidate) => candidate.id);
  }
  const refTasks = (ref2) => tasks2.filter((task) => refsForTask(spec, task).componentRefs.some((candidate) => qualifiedRefIdentity(candidate) === qualifiedRefIdentity(ref2))).map((task) => task.id);
  for (const component of spec.architecture.components) {
    const key = qualifiedRefIdentity({ specId: spec.id, kind: "component", id: component.id });
    componentToFeatures[key] = component.featureIds;
    componentToTasks[key] = refTasks({ specId: spec.id, kind: "component", id: component.id });
  }
  for (const contract of spec.architecture.contracts) {
    const key = qualifiedRefIdentity({ specId: spec.id, kind: "contract", id: contract.id });
    contractToComponents[key] = [contract.provider, ...contract.consumers].map(qualifiedRefIdentity);
    contractToTasks[key] = [...new Set([contract.provider, ...contract.consumers].flatMap(refTasks))];
  }
  for (const relationship of spec.architecture.relationships) {
    relationshipToTasks[relationship.id] = [...new Set([relationship.from, relationship.to].flatMap(refTasks))];
  }
  for (const flow of spec.architecture.flows) {
    architectureFlowToTasks[flow.id] = [...new Set(flow.exchanges.flatMap((exchange) => [exchange.from, exchange.to].flatMap(refTasks)))];
  }
  for (const dependency of spec.architecture.specDependencies) {
    specDependencyToRefs[dependency.id] = [...new Set(architectureRefsForSpec(spec).filter((ref2) => ref2.specId === dependency.specId).map(qualifiedRefIdentity))].sort();
  }
  for (const screen of spec.screens) {
    const featureIds = uniqueSorted2(screen.featureIds);
    const featureSet = new Set(featureIds);
    const needIds = uniqueSorted2(spec.features.filter((feature) => featureSet.has(feature.id)).flatMap((feature) => feature.needIds));
    const uxFlowIds = uniqueSorted2(spec.uxFlows.filter((flow) => flow.screenIds.includes(screen.id)).map((flow) => flow.id));
    const elements = screen.elements ?? [];
    const elementIds = uniqueSorted2(elements.map((element) => element.id));
    const elementIdSet = new Set(elementIds);
    const elementRefs = new Set(elements.flatMap((element) => [
      `${screen.id}:${element.id}`,
      `${screen.id}:${element.name}`
    ]));
    const dataEntityIds = uniqueSorted2(spec.dataModel.filter(
      (entity) => intersects(entity.readByFeatureIds ?? [], featureSet) || intersects(entity.writtenByFeatureIds ?? [], featureSet) || (entity.elementRefs ?? []).some((ref2) => elementRefs.has(ref2))
    ).map((entity) => entity.id));
    const exchangeReferencesScreen = (exchange) => [...exchange.inputRefs, ...exchange.outputRefs].some((ref2) => ref2.specId === spec.id && (ref2.kind === "screen" && ref2.id === screen.id || ref2.kind === "element" && elementIdSet.has(ref2.id))) || exchange.stateRefs.some((ref2) => ref2.screenId === screen.id);
    const matchingArchitectureFlows = spec.architecture.flows.filter((flow) => flow.exchanges.some(exchangeReferencesScreen));
    const matchingExchanges = matchingArchitectureFlows.flatMap((flow) => flow.exchanges.filter(exchangeReferencesScreen));
    const componentRefs = uniqueSorted2(matchingExchanges.flatMap((exchange) => [exchange.from, exchange.to]).filter((ref2) => ref2.kind === "component").map(qualifiedRefIdentity));
    const contractRefs = uniqueSorted2(matchingExchanges.map((exchange) => qualifiedRefIdentity(exchange.contractRef)));
    const referencedContractRefSet = new Set(contractRefs);
    const matchingContracts = spec.architecture.contracts.filter((contract) => referencedContractRefSet.has(qualifiedRefIdentity({
      specId: spec.id,
      kind: "contract",
      id: contract.id
    })));
    const architectureFlowRefs = uniqueSorted2(matchingArchitectureFlows.map((flow) => qualifiedRefIdentity({ specId: spec.id, kind: "flow", id: flow.id })));
    const failurePaths = uniqueSorted2([
      ...matchingContracts.flatMap((contract) => contract.failureModes),
      ...matchingExchanges.flatMap((exchange) => exchange.failurePaths)
    ]);
    const securityNotes = uniqueSorted2(matchingContracts.flatMap((contract) => contract.securityNotes));
    const stateImpacts = uniqueSorted2(screen.states).map((state) => {
      const stateExchanges = spec.architecture.flows.flatMap((flow) => flow.exchanges.filter((exchange) => exchange.stateRefs.some((ref2) => ref2.screenId === screen.id && ref2.state === state)).map((exchange) => ({ flow, exchange })));
      const stateContractRefs = new Set(stateExchanges.map(({ exchange }) => qualifiedRefIdentity(exchange.contractRef)));
      const stateContracts = spec.architecture.contracts.filter((contract) => stateContractRefs.has(qualifiedRefIdentity({
        specId: spec.id,
        kind: "contract",
        id: contract.id
      })));
      return {
        state,
        architectureFlowRefs: uniqueSorted2(stateExchanges.map(({ flow }) => qualifiedRefIdentity({ specId: spec.id, kind: "flow", id: flow.id }))),
        failurePaths: uniqueSorted2([
          ...stateExchanges.flatMap(({ exchange }) => exchange.failurePaths),
          ...stateContracts.flatMap((contract) => contract.failureModes)
        ]),
        testIds: uniqueSorted2(spec.tests.filter((candidate) => candidate.stateRefs.some((ref2) => ref2.screenId === screen.id && ref2.state === state)).map((candidate) => candidate.id))
      };
    });
    const taskIds = uniqueSorted2([
      ...screenToTasks[screen.id] ?? [],
      ...featureIds.flatMap((id) => featureToTasks[id] ?? []),
      ...componentRefs.flatMap((ref2) => componentToTasks[ref2] ?? []),
      ...contractRefs.flatMap((ref2) => contractToTasks[ref2] ?? []),
      ...matchingArchitectureFlows.flatMap((flow) => architectureFlowToTasks[flow.id] ?? [])
    ]);
    const testIds = uniqueSorted2([
      ...screenToTests[screen.id] ?? [],
      ...featureIds.flatMap((id) => featureToTests[id] ?? [])
    ]);
    const remoteBoundary = spec.integrations.some((integration) => intersects(integration.featureIds, featureSet)) || spec.apiContracts.some((api) => intersects(api.featureIds, featureSet)) || (screen.data ?? []).some((item) => /(?:^|[-_/ ])(?:api|remote|server|sync|stream|provider)(?:$|[-_/ ])/i.test(item.source ?? ""));
    const unresolved2 = [];
    if (!featureIds.length) unresolved2.push("feature");
    if (spec.designIntent === "design-app" && elements.some((element) => !element.dataIn && !element.dataOut)) {
      unresolved2.push("element-data");
    }
    const hasDataNeed = elements.some((element) => element.dataIn || element.dataOut) || Boolean(screen.data?.length);
    if (spec.designIntent === "design-app" && hasDataNeed && !dataEntityIds.length) {
      unresolved2.push("data-entity");
    }
    if (spec.designIntent === "design-app" && !componentRefs.length) unresolved2.push("component");
    if (remoteBoundary && !contractRefs.length) unresolved2.push("contract");
    if (remoteBoundary && !architectureFlowRefs.length) unresolved2.push("architecture-flow");
    if (!taskIds.length) unresolved2.push("task");
    if (!testIds.length) unresolved2.push("test");
    uiImpact.push({
      screenId: screen.id,
      needIds,
      featureIds,
      uxFlowIds,
      elementIds,
      stateImpacts,
      dataEntityIds,
      componentRefs,
      contractRefs,
      architectureFlowRefs,
      failurePaths,
      securityNotes,
      taskIds,
      testIds,
      unresolved: unresolved2
    });
  }
  return {
    generatedBy: "groundwork-cli/v3",
    needToFeatures,
    needToTests,
    needToTasks,
    featureToApis,
    featureToTests,
    featureToScreens,
    featureToIntegrations,
    featureToTasks,
    screenToTasks,
    screenToTests,
    integrationToTasks,
    integrationToTests,
    taskToTests,
    adrToTargets,
    entityToFeatures,
    flowToScreens,
    pillarToNeeds,
    pillarToFeatures,
    pillarToInvariants,
    pillarToTasks,
    pillarToAcceptance,
    platformSurfaceToTests,
    componentToFeatures,
    componentToTasks,
    contractToComponents,
    contractToTasks,
    relationshipToTasks,
    architectureFlowToTasks,
    specDependencyToRefs,
    taskDependencies,
    ...tasks2.some((task) => task.ownershipSource === "explicit" || task.plannedNewFiles.length) ? {
      taskToOwnedFiles,
      taskOwnershipSource,
      taskToPlannedNewFiles
    } : {},
    uiImpact,
    coverageGaps,
    behaviorToScopeRefs,
    behaviorToScreens,
    behaviorToElements,
    behaviorToComponents,
    behaviorToTasks,
    behaviorToStates,
    behaviorToActions,
    behaviorToVerifications,
    behaviorToTests,
    decisionToConstraints,
    decisionToScopeRefs,
    decisionToScreens,
    decisionToElements,
    decisionToComponents,
    decisionToTasks,
    decisionToTests,
    decisionSupersession,
    ...spec.designContract?.intent?.type === "conformance" ? { designContractIntent: "conformance" } : {},
    baselineToDeltas,
    constraintToVerifications,
    deltaToTargets,
    deltaToVerifications
  };
}

// engine/src/build-artifacts.ts
function slug2(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
function projectAcceptanceCriteria(spec) {
  const criteria = [];
  const owners = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  const add = (criterion, ownerIds) => {
    if (seen.has(criterion.id)) throw new Error(`Duplicate acceptance criterion ID ${criterion.id}.`);
    seen.add(criterion.id);
    criteria.push(criterion);
    owners.set(criterion.id, new Set(ownerIds));
  };
  for (const need of spec.needs) {
    for (const ears of need.ears ?? []) {
      if (!ears.ears.trim()) throw new Error(`Acceptance criterion ${ears.id} must have a statement.`);
      add({ id: ears.id, statement: ears.ears }, [need.id]);
    }
  }
  for (const feature of spec.features) {
    for (const ears of feature.ears ?? []) {
      if (!ears.ears.trim()) throw new Error(`Acceptance criterion ${ears.id} must have a statement.`);
      add({ id: ears.id, statement: ears.ears }, [feature.id, ...feature.needIds]);
    }
    feature.acceptanceCriteria.forEach((statement, index) => {
      if (!statement.trim()) return;
      add({
        id: `acceptance-${slug2(feature.id)}-${index + 1}`,
        statement,
        testHint: `Verify feature ${feature.id}`
      }, [feature.id, ...feature.needIds]);
    });
  }
  return { criteria: criteria.sort((a, b) => a.id.localeCompare(b.id)), owners };
}
function projectBuildTasks(spec, tasks2, projection = projectAcceptanceCriteria(spec)) {
  const numberToId = new Map(tasks2.map((task) => [task.n, task.id]));
  const requirementIds = new Set(spec.needs.map((need) => need.id));
  return tasks2.map((task) => {
    const refs = refsForTask(spec, task);
    const satisfies = new Set(task.satisfies);
    const acceptanceCriterionIds = projection.criteria.filter((criterion) => [...projection.owners.get(criterion.id) ?? []].some((owner) => satisfies.has(owner))).map((criterion) => criterion.id);
    const ownership = (task.ownershipSource === "explicit" || task.plannedNewFiles.length) && task.ownedFiles.length ? { ownedFiles: task.ownedFiles } : {};
    return {
      id: task.id,
      title: task.title,
      componentRefs: refs.componentRefs,
      contractRefs: refs.contractRefs,
      requirementIds: task.satisfies.filter((id) => requirementIds.has(id)),
      dependsOn: task.deps.map((number) => numberToId.get(number)).filter(Boolean),
      acceptanceCriterionIds,
      ...ownership
    };
  });
}
function projectManualActions(spec) {
  const actions = [];
  for (const integration of spec.integrations) {
    for (const action of integration.externalManualActions) {
      const safeAction = validateExternalManualActionForPublication(action);
      actions.push({
        id: safeAction.id,
        location: safeAction.surface,
        action: safeAction.action,
        requiredValueName: safeAction.requiredValue,
        destination: safeAction.appDestination,
        verification: safeAction.verification
      });
    }
  }
  return actions.sort((a, b) => a.id.localeCompare(b.id));
}
function architectureArtifact(graph, specDigest) {
  return {
    contract: "groundwork.architecture/v1",
    rootSpecId: graph.root.id,
    specDigest,
    specs: [
      {
        specId: graph.root.id,
        role: "root",
        platformSurfaces: graph.root.platformSurfaces,
        architecture: graph.root.architecture
      },
      ...graph.dependencies.map((dependency) => ({
        specId: dependency.spec.id,
        role: "dependency",
        dependencyId: dependency.dependencyId,
        declaredBySpecId: dependency.declaredBySpecId,
        declaredPath: dependency.declaredPath,
        revision: dependency.revision,
        digest: dependency.digest,
        platformSurfaces: dependency.spec.platformSurfaces,
        architecture: dependency.spec.architecture
      }))
    ]
  };
}
function createBuildRequest(inputs) {
  const projection = projectAcceptanceCriteria(inputs.spec);
  const tasks2 = projectBuildTasks(inputs.spec, inputs.tasks, projection);
  const taskDigest = calculateTaskDigest(tasks2);
  const runId = inputs.runId || `run-${slug2(inputs.spec.id)}-${taskDigest.slice("sha256:".length, "sha256:".length + 12)}`;
  const draft = {
    contract: BUILD_REQUEST_CONTRACT,
    runId,
    specId: inputs.spec.id,
    platformSurfaces: inputs.spec.platformSurfaces,
    architecture: inputs.spec.architecture,
    tasks: tasks2,
    acceptanceCriteria: projection.criteria,
    manualActions: projectManualActions(inputs.spec),
    returnVersions: {
      implementationMap: [IMPLEMENTATION_MAP_CONTRACT],
      convergence: [CONVERGENCE_CONTRACT]
    },
    createdAt: inputs.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  };
  return bindBuildRequest(draft, inputs.canonicalSpecPacket);
}
function canonicalSpecPacket(spec, traceability) {
  return { ...spec, traceMatrix: traceability };
}

// engine/src/exporters/types.ts
function exportSlug(value) {
  return value.trim().replace(/['"]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/^-+|-+$/g, "").replace(/-+/g, "-") || "untitled";
}
function requireExportPrerequisites(governance, changeSet) {
  if (!governance.constraints.length && !governance.decisions.length && !governance.owners.length) {
    throw new Error("Derived exports require populated governance constraints, decisions, or owners.");
  }
  if (!changeSet.current.length && !changeSet.proposed.length && !changeSet.verified.length) {
    throw new Error("Derived exports require a populated current, proposed, or verified change set.");
  }
}
function sortedExportFiles(files) {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

// engine/src/exporters/spec-kit.ts
var SPEC_KIT_SOURCE = {
  repository: "https://github.com/github/spec-kit",
  retrievedDate: "2026-08-07",
  stableVersion: "v0.16.1",
  stableCommit: "ad4104b56c219b0a27bac06547d1a3c7d6a0dbd6",
  mainCommit: "684b3d8e05263a7c1948d3d0699ab1cb4f77c3d5",
  supportedPaths: [
    "specs/<NNN-slug>/spec.md",
    "specs/<NNN-slug>/plan.md",
    "specs/<NNN-slug>/tasks.md"
  ]
};
function list(values, empty) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}
function qualifiedRef(value) {
  return `${value.specId}:${value.kind}:${value.id}`;
}
function renderSpec(spec, branch) {
  const scenarios = spec.scenarios.length ? spec.scenarios.map((scenario, index) => [
    `### User Story ${index + 1} - ${scenario.goal} (Priority: P${Math.min(index + 1, 3)})`,
    "",
    scenario.context,
    "",
    `**Independent Test**: ${scenario.successSignal || `Verify ${scenario.goal.toLowerCase()} end to end.`}`,
    "",
    "**Acceptance Scenarios**:",
    "",
    `1. **Given** ${scenario.context}, **When** the user completes the flow, **Then** ${scenario.successSignal || scenario.goal}.`
  ].join("\n")).join("\n\n---\n\n") : "_No user scenario was captured; resolve this Groundwork gap before treating the projection as build-ready._";
  const requirements = spec.needs.flatMap((need) => {
    const statements = need.ears?.map((criterion) => criterion.ears) ?? [];
    return statements.length ? statements.map((statement) => `${need.id}: ${statement}`) : [`${need.id}: ${need.title}${need.description ? ` \u2014 ${need.description}` : ""}`];
  });
  const criteria = (spec.successMetrics ?? []).map((metric) => `${metric.metric}: ${metric.target}`);
  const assumptions = spec.assumptions.map((item) => `${item.text} (confidence: ${item.confidence})`);
  return [
    `# Feature Specification: ${spec.productName}`,
    "",
    `**Feature Branch**: \`${branch}\``,
    "",
    `**Created**: ${SPEC_KIT_SOURCE.retrievedDate}`,
    "",
    "**Status**: Draft \u2014 derived from Groundwork Spec v3",
    "",
    `**Input**: ${spec.productDescription}`,
    "",
    "## User Scenarios & Testing",
    "",
    scenarios,
    "",
    "## Requirements",
    "",
    "### Functional Requirements",
    "",
    list(requirements, "No requirement was captured."),
    "",
    "### Key Entities",
    "",
    list(spec.dataModel.map((entity) => `**${entity.name}** (\`${entity.id}\`): ${entity.description || "Groundwork entity"}`), "No persistent entity is declared."),
    "",
    "## Success Criteria",
    "",
    "### Measurable Outcomes",
    "",
    list(criteria, "Use Groundwork acceptance tests as the measurable completion evidence."),
    "",
    "## Assumptions",
    "",
    list(assumptions, "No unresolved assumption is declared."),
    ""
  ].join("\n");
}
function renderPlan(spec, branch) {
  const topology = spec.platformSurfaces.map((surface) => `${surface.platform} ${surface.role}`).join(" \xB7 ");
  const components = spec.architecture.components.map((item) => `- \`${item.id}\` ${item.name} (${item.kind}); owner ${item.owner}; features ${item.featureIds.join(", ") || "none"}${item.description ? `; ${item.description}` : ""}.`);
  const contracts = spec.architecture.contracts.map((item) => `- \`${item.id}\` ${item.name}; provider ${qualifiedRef(item.provider)}; consumers ${item.consumers.map(qualifiedRef).join(", ") || "none"}; transport ${item.transport}; ports ${item.ports.map((port) => `${port.id} ${port.direction} ${port.name}:${port.type}${port.required ? " required" : " optional"}`).join(", ")}; failures ${item.failureModes.join("; ")}; security ${item.securityNotes.join("; ")}.`);
  const relationships = spec.architecture.relationships.map((item) => `- \`${item.id}\` ${qualifiedRef(item.from)} -> ${qualifiedRef(item.to)}; ${item.direction}; ${item.criticality}; ${item.optional ? "optional" : "required"}${item.contractRef ? `; contract ${qualifiedRef(item.contractRef)}` : ""}; rationale: ${item.rationale}`);
  const flows = spec.architecture.flows.flatMap((flow) => [
    `- Flow \`${flow.id}\` ${flow.name}; trigger: ${flow.trigger}.`,
    ...flow.exchanges.map((exchange) => `  - ${exchange.order}. ${qualifiedRef(exchange.from)} -> ${qualifiedRef(exchange.to)}; contract ${qualifiedRef(exchange.contractRef)}; inputs ${exchange.inputRefs.map(qualifiedRef).join(", ") || "none"}; outputs ${exchange.outputRefs.map(qualifiedRef).join(", ") || "none"}; failures ${exchange.failurePaths.join("; ")}.`)
  ]);
  const dependencies = spec.architecture.specDependencies.map((item) => `- \`${item.id}\` ${item.relationship} ${item.specId} at ${item.location.kind === "local" ? item.location.path : item.location.uri}; revision ${item.revision}; digest ${item.digest}`);
  return [
    `# Implementation Plan: ${spec.productName}`,
    "",
    `**Branch**: \`${branch}\` | **Date**: ${SPEC_KIT_SOURCE.retrievedDate} | **Spec**: \`spec.md\``,
    "",
    `**Input**: Feature specification from \`specs/${branch}/spec.md\``,
    "",
    "## Summary",
    "",
    spec.productDescription,
    "",
    "## Technical Context",
    "",
    `**Target Platform**: ${topology || spec.platformTarget}`,
    "",
    `**Project Type**: ${spec.projectContext.startingPoint === "existing-app" ? "existing application" : "new application"}`,
    "",
    `**Constraints**: ${spec.governance.constraints.join("; ") || "None recorded"}`,
    "",
    `**Scale/Scope**: ${spec.features.length} features, ${spec.screens.length} screens, ${spec.architecture.components.length} components`,
    "",
    "## Constitution Check",
    "",
    list(spec.governance.constraints, "No explicit constraint."),
    "",
    `Decision references: ${spec.governance.decisions.map((id) => `\`${id}\``).join(", ") || "none"}. Owners: ${spec.governance.owners.join(", ") || "none"}.`,
    "",
    "## Logical Architecture",
    "",
    "### Components",
    "",
    components.join("\n") || "- No component declared.",
    "",
    "### Contracts and information flow",
    "",
    contracts.join("\n") || "- No contract declared.",
    "",
    "### Relationships",
    "",
    relationships.join("\n") || "- No relationship declared.",
    "",
    "### Ordered flows",
    "",
    flows.join("\n") || "- No ordered flow declared.",
    "",
    "### Cross-Spec dependencies",
    "",
    dependencies.join("\n") || "- No cross-Spec dependency declared.",
    "",
    "## Project Structure",
    "",
    "The Groundwork Spec and builder handoff remain authoritative. This directory is a one-way compatibility projection and does not initialize or own application source paths.",
    ""
  ].join("\n");
}
function renderTasksProjection(spec) {
  const tasks2 = compileTaskGraph(spec, deriveTasks(spec));
  const taskNumber = new Map(tasks2.map((task, index) => [task.id, `T${String(index + 1).padStart(3, "0")}`]));
  return [
    `# Tasks: ${spec.productName}`,
    "",
    "**Input**: Groundwork's dependency-ordered task graph.",
    "",
    "## Format: `[ID] [P?] Description`",
    "",
    ...tasks2.map((task) => {
      const parallel = task.deps.length === 0 ? " [P]" : "";
      const dependencies = task.deps.length ? ` Depends on Groundwork task numbers ${task.deps.join(", ")}.` : "";
      return `- [ ] ${taskNumber.get(task.id)}${parallel} ${task.title}.${dependencies} Files: ${task.ownedFiles.join(", ")}. Satisfies: ${task.satisfies.join(", ") || "baseline"}.`;
    }),
    "",
    "## Dependencies & Execution Order",
    "",
    "Groundwork's compiled graph is authoritative. Do not infer parallel work across a declared hard dependency.",
    ""
  ].join("\n");
}
function exportSpecKit(spec, options = {}) {
  requireExportPrerequisites(spec.governance, spec.changeSet);
  const featureNumber = options.featureNumber ?? 1;
  if (!Number.isSafeInteger(featureNumber) || featureNumber < 1 || featureNumber > 999) {
    throw new Error("Spec Kit featureNumber must be an integer from 1 through 999.");
  }
  const branch = `${String(featureNumber).padStart(3, "0")}-${exportSlug(spec.productName)}`;
  const root = `specs/${branch}`;
  const sourceStamp = {
    schema: "groundwork.export-source/v1",
    derivedFrom: { schema: "groundwork.spec/v3", specId: spec.id, digest: calculateSpecDigest(spec) },
    format: "spec-kit",
    exporterVersion: "1",
    upstream: SPEC_KIT_SOURCE,
    assumptions: [
      "Groundwork spec.json remains canonical.",
      "The exporter targets the stable/main portable intersection and does not invoke specify init.",
      "Additional Spec Kit research, data-model, quickstart, and contracts artifacts stay optional."
    ]
  };
  return {
    format: "spec-kit",
    exporterVersion: "1",
    source: SPEC_KIT_SOURCE,
    files: sortedExportFiles([
      { path: `${root}/groundwork-source.json`, content: `${JSON.stringify(sourceStamp, null, 2)}
` },
      { path: `${root}/plan.md`, content: renderPlan(spec, branch) },
      { path: `${root}/spec.md`, content: renderSpec(spec, branch) },
      { path: `${root}/tasks.md`, content: renderTasksProjection(spec) }
    ])
  };
}

// engine/src/exporters/openspec.ts
var OPENSPEC_SOURCE = {
  repository: "https://github.com/Fission-AI/OpenSpec",
  retrievedDate: "2026-08-07",
  stableVersion: "v1.8.0",
  stableCommit: "d57889664cab4f2f061d236ec3ff82a5578701bb",
  mainCommit: "e50bd0983dc8dc48250e3181f36e28450542f2ab",
  supportedPaths: [
    "openspec/config.yaml",
    "openspec/specs/<capability-path>/spec.md",
    "openspec/changes/<change-id>/.openspec.yaml",
    "openspec/changes/<change-id>/proposal.md",
    "openspec/changes/<change-id>/design.md",
    "openspec/changes/<change-id>/tasks.md",
    "openspec/changes/<change-id>/specs/<capability-path>/spec.md"
  ]
};
function ref(ref2) {
  return `${ref2.specId}:${ref2.kind}:${ref2.id}`;
}
function requirementBlock(title, body, scenario) {
  return [
    `### Requirement: ${title}`,
    `The system SHALL satisfy this Groundwork-defined behavior: ${body}`,
    "",
    "#### Scenario: Groundwork acceptance",
    `- **WHEN** ${scenario}`,
    `- **THEN** the system SHALL satisfy this Groundwork-defined behavior: ${body}`
  ].join("\n");
}
function currentSpec(spec) {
  if (!spec.changeSet.current.length) return void 0;
  return [
    `# ${spec.productName} current behavior`,
    "",
    "## Purpose",
    spec.productDescription,
    "",
    "## Requirements",
    "",
    ...spec.changeSet.current.map((record2) => requirementBlock(record2.id, record2.summary, `the ${ref(record2.target)} behavior is exercised`)),
    ""
  ].join("\n");
}
function deltaSpec(spec) {
  return [
    "# Groundwork change delta",
    "",
    "## ADDED Requirements",
    "",
    ...spec.changeSet.proposed.map((record2) => requirementBlock(record2.id, record2.summary, `the ${ref(record2.target)} change is implemented`)),
    ""
  ].join("\n");
}
function proposal(spec) {
  return [
    `# Change: ${spec.productName}`,
    "",
    "## Why",
    spec.productDescription,
    "",
    "## What Changes",
    "",
    ...spec.changeSet.proposed.map((record2) => `- ${record2.summary} (\`${ref(record2.target)}\`; ${record2.provenance})`),
    "",
    "## Capabilities",
    "",
    spec.changeSet.current.length ? "### Modified Capabilities" : "### New Capabilities",
    "",
    `- \`${exportSlug(spec.productName)}\`: ${spec.productDescription}`,
    "",
    "## Impact",
    "",
    `- Platforms: ${spec.platformSurfaces.map((surface) => `${surface.platform} ${surface.role}`).join(", ") || spec.platformTarget}`,
    `- Components: ${spec.architecture.components.map((item) => item.id).join(", ") || "none"}`,
    `- Contracts: ${spec.architecture.contracts.map((item) => item.id).join(", ") || "none"}`,
    ""
  ].join("\n");
}
function design(spec) {
  return [
    `# Design: ${spec.productName}`,
    "",
    "## Context",
    "",
    `Groundwork Spec \`${spec.id}\` is authoritative. This OpenSpec tree is a one-way compatibility projection.`,
    "",
    "## Goals / Non-Goals",
    "",
    ...spec.governance.constraints.map((value) => `- Goal/constraint: ${value}`),
    ...spec.nonGoals.map((value) => `- Non-goal: ${value.text} because ${value.because}`),
    "",
    "## Decisions",
    "",
    ...spec.adrs.map((adr) => `- \`${adr.id}\` ${adr.decision}${adr.consequences ? `; consequences: ${adr.consequences}` : ""}`),
    "",
    "## Components",
    "",
    ...spec.architecture.components.map((component) => `- \`${component.id}\` ${component.name} (${component.kind}); owner ${component.owner}; features ${component.featureIds.join(", ") || "none"}.`),
    "",
    "## Contracts and Information Flow",
    "",
    ...spec.architecture.contracts.map((contract) => `- \`${contract.id}\` ${contract.name}: ${ref(contract.provider)} -> ${contract.consumers.map(ref).join(", ") || "none"} over ${contract.transport}; ports ${contract.ports.map((port) => `${port.id} ${port.direction} ${port.name}:${port.type} ${port.required ? "required" : "optional"}`).join(", ")}; failures ${contract.failureModes.join("; ") || "none"}; security ${contract.securityNotes.join("; ") || "none"}.`),
    "",
    "## Relationships",
    "",
    ...spec.architecture.relationships.length ? spec.architecture.relationships.map((relationship) => `- \`${relationship.id}\` ${ref(relationship.from)} -> ${ref(relationship.to)}; ${relationship.direction}; ${relationship.criticality}; ${relationship.optional ? "optional" : "required"}${relationship.contractRef ? `; contract ${ref(relationship.contractRef)}` : ""}; rationale: ${relationship.rationale}.`) : ["- None declared."],
    "",
    "## Ordered Flows",
    "",
    ...spec.architecture.flows.flatMap((flow) => [
      `- Flow \`${flow.id}\` ${flow.name}; trigger: ${flow.trigger}.`,
      ...flow.exchanges.map((exchange) => `  - ${exchange.order}. ${ref(exchange.from)} -> ${ref(exchange.to)} via ${ref(exchange.contractRef)}; input ${exchange.inputRefs.map(ref).join(", ") || "none"}; output ${exchange.outputRefs.map(ref).join(", ") || "none"}; failures ${exchange.failurePaths.join("; ") || "none"}.`)
    ]),
    "",
    "## Cross-Spec Dependencies",
    "",
    ...spec.architecture.specDependencies.length ? spec.architecture.specDependencies.map((dependency) => `- \`${dependency.id}\` ${dependency.relationship} \`${dependency.specId}\`; revision ${dependency.revision}; digest ${dependency.digest}; location ${dependency.location.kind === "local" ? dependency.location.path : dependency.location.uri}.`) : ["- None declared."],
    "",
    "## Risks / Trade-offs",
    "",
    ...spec.risks.map((risk) => `- ${risk.text}; likelihood ${risk.likelihood}; impact ${risk.impact}; mitigation: ${risk.mitigation || "resolve before build completion"}.`),
    ""
  ].join("\n");
}
function tasks(spec) {
  const compiled = compileTaskGraph(spec, deriveTasks(spec));
  return [
    `# Tasks: ${spec.productName}`,
    "",
    ...compiled.map((task, index) => `- [ ] ${index + 1}.${task.deps.length ? ` (depends on ${task.deps.join(", ")})` : ""} ${task.title}; satisfies ${task.satisfies.join(", ") || "baseline"}; files ${task.ownedFiles.join(", ")}.`),
    ""
  ].join("\n");
}
function exportOpenSpec(spec, options = {}) {
  requireExportPrerequisites(spec.governance, spec.changeSet);
  if (!spec.changeSet.current.length && !spec.changeSet.proposed.length) {
    throw new Error("OpenSpec export requires current behavior or an intended proposed change; verified delivery evidence cannot substitute for intent.");
  }
  const capability = exportSlug(options.capability || spec.productName);
  const changeId = exportSlug(options.changeId || spec.changeSet.id);
  const current = currentSpec(spec);
  const sourceStamp = {
    schema: "groundwork.export-source/v1",
    derivedFrom: { schema: "groundwork.spec/v3", specId: spec.id, digest: calculateSpecDigest(spec) },
    format: "openspec",
    exporterVersion: "1",
    upstream: OPENSPEC_SOURCE,
    assumptions: [
      "Groundwork spec.json remains canonical.",
      "The exporter targets OpenSpec's spec-driven stable/main layout and does not invoke openspec init.",
      "Groundwork current records become the current capability spec; proposed records become ADDED delta requirements.",
      "Verified delivery evidence is intentionally not promoted into current or proposed behavior."
    ]
  };
  const changeRoot = `openspec/changes/${changeId}`;
  const files = [
    {
      path: "openspec/config.yaml",
      content: [
        "schema: spec-driven",
        "context: |",
        `  Derived from Groundwork Spec ${spec.id}.`,
        "  Groundwork spec.json is authoritative; edit it and regenerate this projection.",
        `  Platforms: ${spec.platformSurfaces.map((surface) => `${surface.platform} ${surface.role}`).join(", ") || spec.platformTarget}.`,
        "rules:",
        "  proposal:",
        "    - Preserve Groundwork trace IDs and scope boundaries.",
        "  specs:",
        "    - Keep Given/When/Then scenarios linked to Groundwork targets.",
        ""
      ].join("\n")
    },
    { path: "openspec/groundwork-source.json", content: `${JSON.stringify(sourceStamp, null, 2)}
` }
  ];
  if (current) files.push({ path: `openspec/specs/${capability}/spec.md`, content: current });
  if (spec.changeSet.proposed.length) {
    files.push(
      { path: `${changeRoot}/.openspec.yaml`, content: `schema: spec-driven
` },
      { path: `${changeRoot}/design.md`, content: design(spec) },
      { path: `${changeRoot}/proposal.md`, content: proposal(spec) },
      { path: `${changeRoot}/specs/${capability}/spec.md`, content: deltaSpec(spec) },
      { path: `${changeRoot}/tasks.md`, content: tasks(spec) }
    );
  }
  return {
    format: "openspec",
    exporterVersion: "1",
    source: OPENSPEC_SOURCE,
    files: sortedExportFiles(files)
  };
}

// engine/src/derived-export.ts
import * as crypto3 from "node:crypto";
import * as fs3 from "node:fs";
import * as path3 from "node:path";
var MANIFEST_NAME = ".groundwork-export-manifest.json";
var MAX_FILE_BYTES = 16 * 1024 * 1024;
var MAX_TREE_BYTES = 64 * 1024 * 1024;
function sha2562(value) {
  return crypto3.createHash("sha256").update(value).digest("hex");
}
function exactKeys2(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}
function asRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function safeRelative(value) {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.startsWith("//") || value === MANIFEST_NAME) {
    throw new Error(`Unsafe derived export path: ${JSON.stringify(value)}`);
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || path3.posix.normalize(value) !== value) {
    throw new Error(`Unsafe derived export path: ${JSON.stringify(value)}`);
  }
  return value;
}
function validateFiles(files) {
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const exact = /* @__PURE__ */ new Set();
  const folded = /* @__PURE__ */ new Set();
  let total = 0;
  for (const file of sorted) {
    const relative3 = safeRelative(file.path);
    if (relative3 !== file.path) throw new Error(`Derived export path is not canonical: ${file.path}`);
    if (exact.has(relative3) || folded.has(relative3.toLocaleLowerCase("en-US"))) {
      throw new Error(`Duplicate derived export path: ${relative3}`);
    }
    exact.add(relative3);
    folded.add(relative3.toLocaleLowerCase("en-US"));
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error(`Derived export file exceeds 16 MiB: ${relative3}`);
    total += bytes;
    if (total > MAX_TREE_BYTES) throw new Error("Derived export tree exceeds 64 MiB.");
  }
  const paths = sorted.map((file) => file.path);
  for (const file of paths) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++) {
      if (exact.has(parts.slice(0, index).join("/"))) {
        throw new Error(`Derived export file/directory prefix collision at ${file}.`);
      }
    }
  }
  return sorted;
}
function validateSourceStampBinding(sourceStamp, spec, exported) {
  let raw;
  try {
    raw = asRecord(JSON.parse(sourceStamp.content), "Derived export source stamp");
  } catch (error) {
    throw new Error("Derived export source stamp must be valid JSON.", { cause: error });
  }
  const derivedFrom = asRecord(raw.derivedFrom, "Derived export source stamp derivedFrom");
  const expectedDigest = calculateSpecDigest(spec);
  if (raw.schema !== "groundwork.export-source/v1" || raw.format !== exported.format || raw.exporterVersion !== exported.exporterVersion || derivedFrom.schema !== "groundwork.spec/v3" || derivedFrom.specId !== spec.id || derivedFrom.digest !== expectedDigest) {
    throw new Error("Derived export source stamp does not match the supplied canonical Spec and exporter.");
  }
}
function readNoFollow(file, label, maxBytes) {
  let descriptor;
  try {
    descriptor = fs3.openSync(file, fs3.constants.O_RDONLY | fs3.constants.O_NOFOLLOW);
    const stat = fs3.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("not a bounded regular file");
    return fs3.readFileSync(descriptor);
  } catch (error) {
    throw new Error(`${label} must be a bounded regular non-symlink file.`, { cause: error });
  } finally {
    if (descriptor !== void 0) fs3.closeSync(descriptor);
  }
}
function parseManifest2(value) {
  const raw = asRecord(value, "Derived export manifest");
  exactKeys2(raw, ["schema", "derivedFrom", "format", "exporterVersion", "spec", "upstreamSourceStamp", "files"], "Derived export manifest");
  if (raw.schema !== "groundwork.derived-export/v1" || raw.derivedFrom !== "Groundwork" || raw.format !== "spec-kit" && raw.format !== "openspec" || raw.exporterVersion !== "1" || typeof raw.upstreamSourceStamp !== "string" || !Array.isArray(raw.files)) {
    throw new Error("Derived export manifest has an invalid contract.");
  }
  safeRelative(raw.upstreamSourceStamp);
  const spec = asRecord(raw.spec, "Derived export manifest spec");
  exactKeys2(spec, ["id", "schemaVersion", "digest"], "Derived export manifest spec");
  if (typeof spec.id !== "string" || !spec.id || spec.schemaVersion !== 3 || typeof spec.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(spec.digest)) {
    throw new Error("Derived export manifest spec is invalid.");
  }
  const files = raw.files.map((value2, index) => {
    const entry = asRecord(value2, `Derived export manifest files[${index}]`);
    exactKeys2(entry, ["path", "sha256", "bytes"], `Derived export manifest files[${index}]`);
    if (typeof entry.path !== "string" || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_FILE_BYTES) {
      throw new Error(`Derived export manifest files[${index}] is invalid.`);
    }
    return { path: safeRelative(entry.path), sha256: entry.sha256, bytes: entry.bytes };
  });
  if (files.reduce((total, entry) => total + entry.bytes, 0) > MAX_TREE_BYTES) {
    throw new Error("Derived export manifest exceeds the 64 MiB tree limit.");
  }
  validateFiles(files.map((entry) => ({ path: entry.path, content: "" })));
  if (!files.some((entry) => entry.path === raw.upstreamSourceStamp)) {
    throw new Error("Derived export manifest source stamp is not a managed file.");
  }
  return {
    schema: "groundwork.derived-export/v1",
    derivedFrom: "Groundwork",
    format: raw.format,
    exporterVersion: "1",
    spec: { id: spec.id, schemaVersion: 3, digest: spec.digest },
    upstreamSourceStamp: raw.upstreamSourceStamp,
    files
  };
}
function walkTree(root, relative3 = "") {
  const files = [];
  for (const entry of fs3.readdirSync(path3.join(root, relative3), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative3 ? `${relative3}/${entry.name}` : entry.name;
    const absolute = path3.join(root, ...child.split("/"));
    const stat = fs3.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Derived export tree contains a symlink: ${child}`);
    if (stat.isDirectory()) files.push(...walkTree(root, child));
    else if (stat.isFile()) files.push(child);
    else throw new Error(`Derived export tree contains a special entry: ${child}`);
  }
  return files;
}
function verifyManagedTree(root) {
  const stat = fs3.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Derived export root must be a regular non-symlink directory.");
  const entries = walkTree(root);
  if (!entries.length) return { manifest: void 0, fingerprint: null };
  if (!entries.includes(MANIFEST_NAME)) throw new Error("Refusing to adopt a nonempty directory without a Groundwork derived export manifest.");
  const manifestBytes = readNoFollow(path3.join(root, MANIFEST_NAME), MANIFEST_NAME, 512 * 1024);
  const manifest = parseManifest2(JSON.parse(manifestBytes.toString("utf8")));
  const canonicalManifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}
`, "utf8");
  if (!manifestBytes.equals(canonicalManifestBytes)) {
    throw new Error("Refusing to replace modified derived export manifest bytes.");
  }
  const expected = [...manifest.files.map((entry) => entry.path), MANIFEST_NAME].sort();
  if (JSON.stringify(entries.sort()) !== JSON.stringify(expected)) {
    throw new Error("Derived export tree contains unmanaged or missing entries.");
  }
  for (const entry of manifest.files) {
    const data = readNoFollow(path3.join(root, ...entry.path.split("/")), entry.path, MAX_FILE_BYTES);
    if (data.byteLength !== entry.bytes || sha2562(data) !== entry.sha256) {
      throw new Error(`Refusing to replace modified derived export file: ${entry.path}`);
    }
  }
  return { manifest, fingerprint: sha2562(manifestBytes) };
}
function verifyExactManagedTree(root, expected, label) {
  const verified = verifyManagedTree(root);
  if (verified.fingerprint !== expected) {
    throw new Error(`${label} does not match the transaction generation.`);
  }
  return verified.manifest;
}
function canonicalProofMatches(proof) {
  if (!proof) return false;
  try {
    const rootStat = fs3.lstatSync(proof.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    const manifest = asRecord(
      JSON.parse(readNoFollow(path3.join(proof.root, "artifact-manifest.json"), "Canonical artifact manifest", 512 * 1024).toString("utf8")),
      "Canonical artifact manifest"
    );
    if (manifest.schema !== "groundwork.artifacts/v1" || !Array.isArray(manifest.files)) return false;
    const entry = manifest.files.find((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      return value.name === proof.fileName;
    });
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record2 = entry;
    if (record2.sha256 !== proof.sha256) return false;
    const data = readNoFollow(path3.join(proof.root, proof.fileName), `Canonical proof ${proof.fileName}`, MAX_FILE_BYTES);
    return sha2562(data) === proof.sha256;
  } catch {
    return false;
  }
}
function fsyncFile2(file) {
  const descriptor = fs3.openSync(file, "r");
  try {
    fs3.fsyncSync(descriptor);
  } finally {
    fs3.closeSync(descriptor);
  }
}
function fsyncDir2(dir) {
  const descriptor = fs3.openSync(dir, "r");
  try {
    fs3.fsyncSync(descriptor);
  } finally {
    fs3.closeSync(descriptor);
  }
}
function writeJournal(txDir, journal) {
  const next = path3.join(txDir, "journal.next.json");
  fs3.writeFileSync(next, `${JSON.stringify(journal, null, 2)}
`, { flag: "wx", mode: 384 });
  fsyncFile2(next);
  fs3.renameSync(next, path3.join(txDir, "journal.json"));
  fsyncDir2(txDir);
}
function parseJournal2(file) {
  const raw = asRecord(JSON.parse(readNoFollow(file, "Derived export journal", 64 * 1024).toString("utf8")), "Derived export journal");
  exactKeys2(raw, ["schema", "targetName", "phase", "expectedNewManifestSha256", "priorExisted", "priorManifestSha256", "canonicalProof"], "Derived export journal");
  if (raw.schema !== "groundwork.derived-export-transaction/v2" || typeof raw.targetName !== "string" || !raw.targetName || raw.targetName.includes("/") || raw.targetName.includes("\\") || raw.phase !== "staged" && raw.phase !== "backed-up" && raw.phase !== "installed" && raw.phase !== "committed" || typeof raw.expectedNewManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedNewManifestSha256) || typeof raw.priorExisted !== "boolean" || raw.priorManifestSha256 !== null && (typeof raw.priorManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.priorManifestSha256))) {
    throw new Error("Derived export journal has an invalid contract.");
  }
  let canonicalProof = null;
  if (raw.canonicalProof !== null) {
    const proof = asRecord(raw.canonicalProof, "Derived export journal canonicalProof");
    exactKeys2(proof, ["root", "fileName", "sha256"], "Derived export journal canonicalProof");
    if (typeof proof.root !== "string" || !path3.isAbsolute(proof.root) || typeof proof.fileName !== "string" || path3.basename(proof.fileName) !== proof.fileName || !proof.fileName || typeof proof.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(proof.sha256)) {
      throw new Error("Derived export journal canonicalProof is invalid.");
    }
    canonicalProof = { root: proof.root, fileName: proof.fileName, sha256: proof.sha256 };
  }
  return {
    schema: "groundwork.derived-export-transaction/v2",
    targetName: raw.targetName,
    phase: raw.phase,
    expectedNewManifestSha256: raw.expectedNewManifestSha256,
    priorExisted: raw.priorExisted,
    priorManifestSha256: raw.priorManifestSha256,
    canonicalProof
  };
}
function recoverTransactions(parent, targetName, key) {
  const prefix = `.groundwork-export-tx-${key}-`;
  for (const entry of fs3.readdirSync(parent).filter((name) => name.startsWith(prefix)).sort()) {
    const txDir = path3.join(parent, entry);
    const stat = fs3.lstatSync(txDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe derived export transaction: ${entry}`);
    const journalPath = path3.join(txDir, "journal.json");
    if (!fs3.existsSync(journalPath)) {
      const incompleteEntries = fs3.readdirSync(txDir).sort();
      if (incompleteEntries.some((name) => name !== "stage" && name !== "journal.next.json")) {
        throw new Error(`Journal-free derived export transaction contains unexpected state: ${entry}`);
      }
      const incompleteStage = path3.join(txDir, "stage");
      if (fs3.existsSync(incompleteStage)) {
        const stageStat = fs3.lstatSync(incompleteStage);
        if (!stageStat.isDirectory() || stageStat.isSymbolicLink()) {
          throw new Error(`Journal-free derived export transaction has an unsafe stage: ${entry}`);
        }
        walkTree(incompleteStage);
      }
      const nextJournal = path3.join(txDir, "journal.next.json");
      if (fs3.existsSync(nextJournal)) parseJournal2(nextJournal);
      fs3.rmSync(txDir, { recursive: true, force: true });
      fsyncDir2(parent);
      continue;
    }
    const journal = parseJournal2(journalPath);
    if (journal.targetName !== targetName) throw new Error(`Derived export transaction target mismatch: ${entry}`);
    const target = path3.join(parent, targetName);
    const backup = path3.join(txDir, "backup");
    const stage = path3.join(txDir, "stage");
    const hasTarget = fs3.existsSync(target);
    const hasBackup = fs3.existsSync(backup);
    if (hasBackup) {
      verifyExactManagedTree(backup, journal.priorManifestSha256, "Derived export backup");
    }
    let targetFingerprint;
    if (hasTarget) targetFingerprint = verifyManagedTree(target).fingerprint;
    const committed = journal.phase === "committed" || journal.phase === "installed" && canonicalProofMatches(journal.canonicalProof);
    if (committed && hasTarget && targetFingerprint === journal.expectedNewManifestSha256) {
      if (hasBackup) fs3.rmSync(backup, { recursive: true, force: true });
      if (fs3.existsSync(stage)) fs3.rmSync(stage, { recursive: true, force: true });
      fs3.rmSync(txDir, { recursive: true, force: true });
      fsyncDir2(parent);
      continue;
    }
    const targetIsPrior = hasTarget && journal.priorExisted && targetFingerprint === journal.priorManifestSha256;
    let conflict;
    if (!targetIsPrior && hasTarget) {
      if (targetFingerprint === journal.expectedNewManifestSha256) {
        fs3.rmSync(target, { recursive: true, force: true });
      } else {
        conflict = path3.join(parent, `.groundwork-export-conflict-${key}-${crypto3.randomUUID()}`);
        fs3.renameSync(target, conflict);
      }
    }
    if (!targetIsPrior && journal.priorExisted) {
      if (!hasBackup) {
        throw new Error(`Cannot recover prior derived export generation for ${entry}.`);
      }
      fs3.renameSync(backup, target);
    } else if (hasBackup) {
      fs3.rmSync(backup, { recursive: true, force: true });
    }
    if (fs3.existsSync(stage)) fs3.rmSync(stage, { recursive: true, force: true });
    fs3.rmSync(txDir, { recursive: true, force: true });
    fsyncDir2(parent);
    if (conflict) {
      throw new Error(`A conflicting derived export generation was preserved at ${conflict}; the prior generation was restored.`);
    }
  }
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function acquireLock(lock, targetName) {
  try {
    fs3.writeFileSync(lock, `${JSON.stringify({ pid: process.pid, targetName })}
`, { flag: "wx", mode: 384 });
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = fs3.lstatSync(lock);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Derived export lock is not a regular file.");
  const value = asRecord(JSON.parse(readNoFollow(lock, "Derived export lock", 16 * 1024).toString("utf8")), "Derived export lock");
  if (typeof value.pid !== "number" || value.targetName !== targetName || processAlive(value.pid)) {
    throw new Error("Another derived export publisher owns this output root.");
  }
  fs3.rmSync(lock);
  fs3.writeFileSync(lock, `${JSON.stringify({ pid: process.pid, targetName })}
`, { flag: "wx", mode: 384 });
}
function isContained(parent, child) {
  const relative3 = path3.relative(parent, child);
  return relative3 === "" || !relative3.startsWith(`..${path3.sep}`) && relative3 !== ".." && !path3.isAbsolute(relative3);
}
function canonicalCandidate(value) {
  let cursor = path3.resolve(value);
  const suffix = [];
  while (!fs3.existsSync(cursor)) {
    const parent = path3.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path3.basename(cursor));
    cursor = parent;
  }
  const resolved = fs3.existsSync(cursor) ? fs3.realpathSync(cursor) : cursor;
  return path3.join(resolved, ...suffix);
}
function assertDisjointArtifactRoots(coreRoot, exportRoot) {
  const core = canonicalCandidate(coreRoot);
  const derived = canonicalCandidate(exportRoot);
  if (isContained(core, derived) || isContained(derived, core)) {
    throw new Error("Canonical artifact and derived export roots must be disjoint.");
  }
}
function validateDerivedExportDestination(outputRoot, exported) {
  const files = validateFiles(exported.files);
  if (files.filter((file) => file.path.endsWith("groundwork-source.json")).length !== 1) {
    throw new Error("Derived export must contain exactly one groundwork-source.json stamp.");
  }
  const requested = path3.resolve(outputRoot);
  const parent = path3.dirname(requested);
  if (!fs3.existsSync(parent)) return;
  const realParent = fs3.realpathSync(parent);
  const target = path3.join(realParent, path3.basename(requested));
  if (fs3.existsSync(target)) verifyManagedTree(target);
}
function reserveDerivedExportDestination(outputRoot, exported, options = {}) {
  const files = validateFiles(exported.files);
  const sourceStamps = files.filter((file) => file.path.endsWith("groundwork-source.json"));
  if (sourceStamps.length !== 1) throw new Error("Derived export must contain exactly one groundwork-source.json stamp.");
  const requested = path3.resolve(outputRoot);
  fs3.mkdirSync(path3.dirname(requested), { recursive: true });
  const parent = fs3.realpathSync(path3.dirname(requested));
  const targetName = path3.basename(requested);
  const target = path3.join(parent, targetName);
  const key = sha2562(target).slice(0, 16);
  const lock = path3.join(parent, `.groundwork-export-lock-${key}`);
  acquireLock(lock, targetName);
  try {
    recoverTransactions(parent, targetName, key);
    const targetExisted = fs3.existsSync(target);
    const priorTree = targetExisted ? verifyManagedTree(target) : { manifest: void 0, fingerprint: null };
    let canonicalProof = null;
    if (options.canonicalRoot) {
      const canonicalRoot = canonicalCandidate(options.canonicalRoot);
      assertDisjointArtifactRoots(canonicalRoot, target);
      if (options.canonicalProof) {
        if (path3.basename(options.canonicalProof.fileName) !== options.canonicalProof.fileName || !options.canonicalProof.fileName || !/^[a-f0-9]{64}$/.test(options.canonicalProof.sha256)) {
          throw new Error("Canonical commit proof is invalid.");
        }
        canonicalProof = { root: canonicalRoot, ...options.canonicalProof };
      }
    } else if (options.canonicalProof) {
      throw new Error("Canonical commit proof requires a canonical root.");
    }
    return {
      files,
      sourceStamp: sourceStamps[0],
      parent,
      targetName,
      target,
      key,
      lock,
      targetExisted,
      priorManifestSha256: priorTree.fingerprint,
      canonicalProof
    };
  } catch (error) {
    if (fs3.existsSync(lock)) fs3.rmSync(lock);
    throw error;
  }
}
function publishReservedDerivedExport(reservation, spec, exported, commitCanonical) {
  const {
    files,
    sourceStamp,
    parent,
    targetName,
    target,
    key,
    targetExisted,
    priorManifestSha256,
    canonicalProof
  } = reservation;
  validateSourceStampBinding(sourceStamp, spec, exported);
  const manifest = {
    schema: "groundwork.derived-export/v1",
    derivedFrom: "Groundwork",
    format: exported.format,
    exporterVersion: exported.exporterVersion,
    spec: { id: spec.id, schemaVersion: 3, digest: calculateSpecDigest(spec) },
    upstreamSourceStamp: sourceStamp.path,
    files: files.map((file) => ({
      path: file.path,
      sha256: sha2562(file.content),
      bytes: Buffer.byteLength(file.content, "utf8")
    }))
  };
  parseManifest2(manifest);
  const expectedNewManifestSha256 = sha2562(`${JSON.stringify(manifest, null, 2)}
`);
  const txDir = fs3.mkdtempSync(path3.join(parent, `.groundwork-export-tx-${key}-`));
  const stage = path3.join(txDir, "stage");
  const backup = path3.join(txDir, "backup");
  fs3.mkdirSync(stage, { mode: 448 });
  let journal = {
    schema: "groundwork.derived-export-transaction/v2",
    targetName,
    phase: "staged",
    expectedNewManifestSha256,
    priorExisted: targetExisted,
    priorManifestSha256,
    canonicalProof
  };
  writeJournal(txDir, journal);
  for (const file of files) {
    const destination = path3.join(stage, ...file.path.split("/"));
    fs3.mkdirSync(path3.dirname(destination), { recursive: true, mode: 493 });
    fs3.writeFileSync(destination, file.content, { flag: "wx", mode: 420 });
    if (file.path.endsWith(".json")) JSON.parse(file.content);
    fsyncFile2(destination);
  }
  const manifestPath = path3.join(stage, MANIFEST_NAME);
  fs3.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, { flag: "wx", mode: 420 });
  fsyncFile2(manifestPath);
  fsyncDir2(stage);
  if (process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT === "after-staging") {
    fs3.rmSync(txDir, { recursive: true, force: true });
    throw new Error("Injected derived export failure after staging.");
  }
  let movedOld = false;
  let installedNew = false;
  let crossRootCommitted = false;
  try {
    if (process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT === "add-unmanaged" && fs3.existsSync(target)) {
      fs3.writeFileSync(path3.join(target, "user.txt"), "preserve", { flag: "wx" });
    }
    const existsAtCapture = fs3.existsSync(target);
    if (existsAtCapture !== targetExisted) {
      throw new Error("Derived export root changed after reservation; refusing a partial commit.");
    }
    if (existsAtCapture) {
      fs3.renameSync(target, backup);
      movedOld = true;
      verifyExactManagedTree(backup, priorManifestSha256, "Reserved prior derived export");
    }
    journal = { ...journal, phase: "backed-up" };
    writeJournal(txDir, journal);
    if (process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT === "after-backup") {
      throw new Error("Injected derived export failure after backup.");
    }
    if (fs3.existsSync(target)) {
      throw new Error("Derived export root reappeared during publication; refusing to overwrite it.");
    }
    fs3.renameSync(stage, target);
    installedNew = true;
    if (process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT === "add-unmanaged-after-install") {
      fs3.writeFileSync(path3.join(target, "user.txt"), "preserve", { flag: "wx" });
    }
    const replacement = process.env.GROUNDWORK_TEST_REPLACE_DERIVED_EXPORT_AFTER_INSTALL;
    if (replacement) {
      fs3.rmSync(target, { recursive: true, force: true });
      fs3.renameSync(replacement, target);
    }
    journal = { ...journal, phase: "installed" };
    writeJournal(txDir, journal);
    if (process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT === "after-install") {
      throw new Error("Injected derived export failure after install.");
    }
    verifyExactManagedTree(target, expectedNewManifestSha256, "Installed derived export");
    commitCanonical?.();
    crossRootCommitted = true;
    journal = { ...journal, phase: "committed" };
    writeJournal(txDir, journal);
    fsyncDir2(parent);
    if (movedOld) fs3.rmSync(backup, { recursive: true, force: true });
    fs3.rmSync(txDir, { recursive: true, force: true });
  } catch (error) {
    let failure = error;
    if (crossRootCommitted) {
      verifyExactManagedTree(target, expectedNewManifestSha256, "Committed derived export");
      fsyncDir2(parent);
      throw failure;
    }
    if (installedNew && fs3.existsSync(target)) {
      try {
        verifyExactManagedTree(target, expectedNewManifestSha256, "Installed derived export rollback candidate");
        fs3.rmSync(target, { recursive: true, force: true });
      } catch {
        const conflict = path3.join(parent, `.groundwork-export-conflict-${key}-${crypto3.randomUUID()}`);
        fs3.renameSync(target, conflict);
        failure = new Error(`${failure.message} Concurrent output bytes were preserved in a sibling conflict directory.`);
      }
    } else if (movedOld && fs3.existsSync(target)) {
      const conflict = path3.join(parent, `.groundwork-export-conflict-${key}-${crypto3.randomUUID()}`);
      fs3.renameSync(target, conflict);
      failure = new Error(`${failure.message} Concurrent output bytes were preserved in a sibling conflict directory.`);
    }
    if (movedOld && fs3.existsSync(backup)) fs3.renameSync(backup, target);
    fs3.rmSync(txDir, { recursive: true, force: true });
    fsyncDir2(parent);
    throw failure;
  }
  return [...files.map((file) => path3.join(target, ...file.path.split("/"))), path3.join(target, MANIFEST_NAME)];
}
function withDerivedExportReservation(outputRoot, exported, operation, options = {}) {
  const reservation = reserveDerivedExportDestination(outputRoot, exported, options);
  let published = false;
  try {
    return operation((spec, commitCanonical) => {
      if (published) throw new Error("A derived export reservation can publish only once.");
      published = true;
      return publishReservedDerivedExport(reservation, spec, exported, commitCanonical);
    });
  } finally {
    if (fs3.existsSync(reservation.lock)) fs3.rmSync(reservation.lock);
  }
}

// engine/src/cli.ts
var PACKAGE_JSON = path4.resolve(path4.dirname(fileURLToPath(import.meta.url)), "../..", "package.json");
function parseArgs(argv) {
  const positionals = [];
  const seen = /* @__PURE__ */ new Set();
  let out;
  const allowSpecRoots = [];
  let implementationMap;
  let runId;
  let createdAt;
  let exportFormat;
  let exportOut;
  let checkOwnedFiles = false;
  let repoRoot;
  const once = (name) => {
    if (seen.has(name)) throw new Error(`Duplicate ${name} argument.`);
    seen.add(name);
  };
  const nextValue = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      once("--out");
      out = nextValue(i, "--out");
      i += 1;
    } else if (arg.startsWith("--out=")) {
      once("--out");
      out = arg.slice("--out=".length);
    } else if (arg === "--allow-spec-root") {
      allowSpecRoots.push(nextValue(i, "--allow-spec-root"));
      i += 1;
    } else if (arg.startsWith("--allow-spec-root=")) {
      const value = arg.slice("--allow-spec-root=".length);
      if (!value) throw new Error("--allow-spec-root requires a value.");
      allowSpecRoots.push(value);
    } else if (arg === "--reconcile" || arg === "--implementation-map") {
      once("--reconcile");
      implementationMap = nextValue(i, arg);
      i += 1;
    } else if (arg.startsWith("--reconcile=")) {
      once("--reconcile");
      implementationMap = arg.slice("--reconcile=".length);
    } else if (arg.startsWith("--implementation-map=")) {
      once("--reconcile");
      implementationMap = arg.slice("--implementation-map=".length);
    } else if (arg === "--run-id") {
      once("--run-id");
      runId = nextValue(i, "--run-id");
      i += 1;
    } else if (arg.startsWith("--run-id=")) {
      once("--run-id");
      runId = arg.slice("--run-id=".length);
    } else if (arg === "--created-at") {
      once("--created-at");
      createdAt = nextValue(i, "--created-at");
      i += 1;
    } else if (arg.startsWith("--created-at=")) {
      once("--created-at");
      createdAt = arg.slice("--created-at=".length);
    } else if (arg === "--export") {
      once("--export");
      const value = nextValue(i, "--export");
      if (value !== "spec-kit" && value !== "openspec") throw new Error(`Unsupported export format: ${value}`);
      exportFormat = value;
      i += 1;
    } else if (arg.startsWith("--export=")) {
      once("--export");
      const value = arg.slice("--export=".length);
      if (value !== "spec-kit" && value !== "openspec") throw new Error(`Unsupported export format: ${value}`);
      exportFormat = value;
    } else if (arg === "--export-out") {
      once("--export-out");
      exportOut = nextValue(i, "--export-out");
      i += 1;
    } else if (arg.startsWith("--export-out=")) {
      once("--export-out");
      exportOut = arg.slice("--export-out=".length);
    } else if (arg === "--check-owned-files") {
      once("--check-owned-files");
      checkOwnedFiles = true;
    } else if (arg === "--repo-root") {
      once("--repo-root");
      repoRoot = nextValue(i, "--repo-root");
      i += 1;
    } else if (arg.startsWith("--repo-root=")) {
      once("--repo-root");
      repoRoot = arg.slice("--repo-root=".length);
    } else if (arg.startsWith("-") && arg !== "-") {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) throw new Error(`Unexpected positional argument: ${positionals[1]}`);
  for (const [name, value] of [
    ["--out", out],
    ["--reconcile", implementationMap],
    ["--run-id", runId],
    ["--created-at", createdAt],
    ["--export", exportFormat],
    ["--export-out", exportOut]
  ]) {
    if (seen.has(name) && !value) throw new Error(`${name} requires a value.`);
  }
  if (Boolean(exportFormat) !== Boolean(exportOut)) throw new Error("--export and --export-out must be supplied together.");
  if (implementationMap && (exportFormat || exportOut)) throw new Error("Reconciliation cannot run with a derived export.");
  if (checkOwnedFiles && !repoRoot) throw new Error("--check-owned-files requires --repo-root <root>.");
  return { source: positionals[0], out, allowSpecRoots, implementationMap, runId, createdAt, exportFormat, exportOut, checkOwnedFiles, repoRoot };
}
function allExplicitOwnedFiles(spec) {
  return [.../* @__PURE__ */ new Set([
    ...spec.projectContext.bootstrap?.ownedFiles ?? [],
    ...spec.features.flatMap((item) => item.ownedFiles ?? []),
    ...spec.screens.flatMap((item) => item.ownedFiles ?? []),
    ...spec.integrations.flatMap((item) => item.ownedFiles),
    ...spec.apiContracts.flatMap((item) => item.ownedFiles),
    ...spec.tests.flatMap((item) => item.ownedFiles),
    ...spec.dataModel.flatMap((item) => item.ownedFiles),
    ...spec.architecture.components.flatMap((item) => item.ownedFiles ?? []),
    ...spec.architecture.contracts.flatMap((item) => item.ownedFiles ?? [])
  ])];
}
function checkOwnedFilesAgainstRepo(spec, rootInput) {
  const root = fs4.realpathSync(path4.resolve(rootInput));
  if (!fs4.statSync(root).isDirectory()) throw new Error(`Repository root is not a directory: ${root}`);
  const planned = new Set((spec.projectContext.declaredNewFiles ?? []).map((item) => item.path));
  for (const relative3 of allExplicitOwnedFiles(spec)) {
    const candidate = path4.resolve(root, relative3);
    if (!candidate.startsWith(`${root}${path4.sep}`)) throw new Error(`Owned file escapes repository root: ${relative3}`);
    if (planned.has(relative3)) {
      if (fs4.existsSync(candidate)) throw new Error(`Declared-new file already exists: ${relative3}`);
      let current = root;
      for (const part of relative3.split("/").slice(0, -1)) {
        current = path4.join(current, part);
        if (!fs4.existsSync(current)) break;
        if (fs4.lstatSync(current).isSymbolicLink()) throw new Error(`Declared-new file has a symlink ancestor: ${relative3}`);
        if (!fs4.lstatSync(current).isDirectory()) throw new Error(`Declared-new file has a non-directory ancestor: ${relative3}`);
      }
      continue;
    }
    if (!fs4.existsSync(candidate)) throw new Error(`Expected-existing owned file is missing: ${relative3}`);
    const stat = fs4.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Expected-existing owned path is not a regular file: ${relative3}`);
    if (!fs4.realpathSync(candidate).startsWith(`${root}${path4.sep}`)) throw new Error(`Owned file resolves outside repository root: ${relative3}`);
  }
}
function readStdinSync() {
  try {
    return fs4.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
function kebab(name) {
  return name.trim().replace(/['"]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/^-+|-+$/g, "").replace(/-+/g, "-") || "untitled";
}
function fail(message) {
  process.stderr.write(`${message}
`);
  process.exit(1);
}
function reportZodError(err) {
  const lines = ["Spec validation failed. SpecSchema rejected the input:", ""];
  for (const issue of err.issues) {
    const where = issue.path.length ? issue.path.join(".") : "(root)";
    lines.push(`  \u2022 ${where}: ${issue.message}`);
  }
  lines.push("", `${err.issues.length} issue(s). No files were written.`);
  fail(lines.join("\n"));
}
function loadVisualEvidence(outDir) {
  const embedded = {};
  const steeringLines = [];
  const maxFileBytes = 2 * 1024 * 1024;
  const maxTotalBytes = 8 * 1024 * 1024;
  let totalBytes = 0;
  const readBoundedRegularFile = (file, label, limit = maxFileBytes) => {
    const stat = fs4.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${label} is not a safe regular file.`);
    }
    if (stat.size > limit) throw new Error(`${label} exceeds the ${limit}-byte embedding limit.`);
    totalBytes += stat.size;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Visual evidence exceeds the ${maxTotalBytes}-byte total embedding limit.`);
    }
    return fs4.readFileSync(file, "utf8");
  };
  const tokensPath = path4.join(outDir, "design-tokens.md");
  if (fs4.existsSync(tokensPath)) {
    embedded["design-tokens.md"] = readBoundedRegularFile(tokensPath, "design-tokens.md");
    steeringLines.push("- Confirmed token source: `design-tokens.md`.");
  }
  const mockupsRoot = path4.join(outDir, "mockups");
  const selectionPath = path4.join(mockupsRoot, "selection.json");
  const gallerySelectionsPath = path4.join(mockupsRoot, ".canvas", "gallery-selections.json");
  if (fs4.existsSync(gallerySelectionsPath)) {
    const rootStat = fs4.lstatSync(mockupsRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("mockups is not a safe owned directory.");
    }
    const realMockupsRoot = fs4.realpathSync(mockupsRoot);
    const realGallerySelections = fs4.realpathSync(gallerySelectionsPath);
    if (!realGallerySelections.startsWith(`${realMockupsRoot}${path4.sep}`)) {
      throw new Error("mockups/.canvas/gallery-selections.json escapes the owned mockups directory.");
    }
    const rawGallerySelections = readBoundedRegularFile(
      gallerySelectionsPath,
      "mockups/.canvas/gallery-selections.json",
      512 * 1024
    );
    const gallerySelections = JSON.parse(rawGallerySelections);
    embedded["mockups/.canvas/gallery-selections.json"] = rawGallerySelections;
    const annotations = gallerySelections.annotations;
    let openAnnotations = 0;
    if (annotations && typeof annotations === "object" && !Array.isArray(annotations)) {
      for (const value of Object.values(annotations)) {
        if (!Array.isArray(value)) continue;
        openAnnotations += value.filter((item) => {
          if (!item || typeof item !== "object") return false;
          return item.status === "open";
        }).length;
      }
    }
    if (openAnnotations) {
      steeringLines.push(
        `- Required visual feedback: ${openAnnotations} open element annotation${openAnnotations === 1 ? "" : "s"} in \`mockups/.canvas/gallery-selections.json\`; implement or explicitly disposition each one.`
      );
    }
  }
  if (fs4.existsSync(selectionPath)) {
    const rootStat = fs4.lstatSync(mockupsRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("mockups is not a safe owned directory.");
    }
    const realMockupsRoot = fs4.realpathSync(mockupsRoot);
    const rawSelection = readBoundedRegularFile(selectionPath, "mockups/selection.json", 256 * 1024);
    const selection = JSON.parse(rawSelection);
    embedded["mockups/selection.json"] = rawSelection;
    const rationale = typeof selection.rationale === "string" ? selection.rationale.trim() : "";
    if (rationale) steeringLines.push(`- Confirmed mockup rationale: ${rationale}`);
    const selections = Array.isArray(selection.selections) ? selection.selections : Array.isArray(selection.perScreen) ? selection.perScreen : [];
    for (const item of selections) {
      if (!item || typeof item !== "object") continue;
      const relative3 = item.html_path;
      if (typeof relative3 !== "string" || !relative3.trim()) continue;
      const candidate = path4.resolve(mockupsRoot, relative3);
      if (!candidate.startsWith(`${path4.resolve(mockupsRoot)}${path4.sep}`)) {
        throw new Error(`Unsafe selected mockup path: ${relative3}`);
      }
      if (!fs4.existsSync(candidate)) {
        throw new Error(`Selected mockup is missing: ${relative3}`);
      }
      const selectedStat = fs4.lstatSync(candidate);
      if (!selectedStat.isFile() || selectedStat.isSymbolicLink()) {
        throw new Error(`Selected mockup is not a safe regular file: ${relative3}`);
      }
      const realCandidate = fs4.realpathSync(candidate);
      if (!realCandidate.startsWith(`${realMockupsRoot}${path4.sep}`)) {
        throw new Error(`Selected mockup escapes the owned mockups directory: ${relative3}`);
      }
      embedded[`mockups/${relative3}`] = readBoundedRegularFile(candidate, `mockups/${relative3}`);
    }
  }
  if (!steeringLines.length) steeringLines.push("- No visual preference artifact has been confirmed yet.");
  return { embedded, steeringLines };
}
function sha2563(value) {
  return crypto4.createHash("sha256").update(value, "utf8").digest("hex");
}
function bundleBaselineArtifacts(spec, source) {
  const artifacts = spec.designContract?.baseline.artifacts ?? [];
  if (!artifacts.length) return void 0;
  if (!source || source === "-") throw new Error("A Spec with baseline artifacts must be read from a file so artifact paths have an authoritative root.");
  const sourceRoot = fs4.realpathSync(path4.dirname(path4.resolve(source)));
  const managedNames = /* @__PURE__ */ new Set(["spec.json", "steering.md", "requirements.md", "design.md", "design-system.md", "tasks.md", "builder-handoff.md", "traceability.json", "architecture.json", "build-request.json", "artifact-manifest.json", "baseline-artifacts.json"]);
  const seen = /* @__PURE__ */ new Set();
  const bundled = [];
  for (const artifact of artifacts) {
    const parts = artifact.path.split(/[\\/]+/).filter((part) => part && part !== ".");
    const relative3 = parts.join(path4.sep);
    if (!relative3 || path4.isAbsolute(artifact.path) || parts.includes("..")) throw new Error(`Baseline artifact path is unsafe: ${artifact.path}`);
    if (managedNames.has(parts.join("/"))) throw new Error(`Baseline artifact collides with managed packet artifact: ${artifact.path}`);
    if (seen.has(parts.join("/"))) throw new Error(`Duplicate baseline artifact destination: ${artifact.path}`);
    seen.add(parts.join("/"));
    const sourcePath = path4.resolve(sourceRoot, relative3);
    if (!sourcePath.startsWith(`${sourceRoot}${path4.sep}`)) throw new Error(`Baseline artifact escapes the Spec root: ${artifact.path}`);
    const stat = fs4.lstatSync(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Baseline artifact is not a safe regular file: ${artifact.path}`);
    const realSource = fs4.realpathSync(sourcePath);
    if (!realSource.startsWith(`${sourceRoot}${path4.sep}`)) throw new Error(`Baseline artifact resolves outside the Spec root: ${artifact.path}`);
    const actual = `sha256:${crypto4.createHash("sha256").update(fs4.readFileSync(realSource)).digest("hex")}`;
    if (actual !== artifact.digest) throw new Error(`Baseline artifact digest mismatch for ${artifact.id}: expected ${artifact.digest}, got ${actual}`);
    bundled.push({ id: artifact.id, path: artifact.path, type: artifact.type, digest: artifact.digest, encoding: "base64", bytes: fs4.readFileSync(realSource).toString("base64") });
  }
  return `${JSON.stringify({ schema: "groundwork.baseline-artifacts/v1", artifacts: bundled }, null, 2)}
`;
}
function assertNoBaselineDestinationSymlinks(spec, outDir) {
  for (const artifact of spec.designContract?.baseline.artifacts ?? []) {
    let current = path4.resolve(outDir);
    for (const part of artifact.path.split(/[\\/]+/).slice(0, -1)) {
      current = path4.join(current, part);
      if (!fs4.existsSync(current)) break;
      const stat = fs4.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Baseline artifact destination ancestor is a symlink: ${artifact.path}`);
      if (!stat.isDirectory()) throw new Error(`Baseline artifact destination ancestor is not a directory: ${artifact.path}`);
    }
  }
}
function readManagedArtifactSet(outDir) {
  recoverArtifactTransactions(outDir);
  const manifestPath = path4.join(outDir, "artifact-manifest.json");
  const manifestStat = fs4.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 512 * 1024) {
    throw new Error("artifact-manifest.json is not a safe Groundwork manifest.");
  }
  const manifest = JSON.parse(fs4.readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== "groundwork.artifacts/v1" || !Array.isArray(manifest.files)) {
    throw new Error("artifact-manifest.json is not a supported Groundwork artifact manifest.");
  }
  const files = {};
  for (const rawEntry of manifest.files) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) throw new Error("Artifact manifest entry is invalid.");
    const entry = rawEntry;
    const name = entry.name;
    if (typeof name !== "string" || !name || path4.isAbsolute(name) || path4.dirname(name) !== ".") {
      throw new Error("Artifact manifest contains an unsafe file name.");
    }
    const file = path4.join(outDir, name);
    const stat = fs4.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {
      throw new Error(`Managed artifact is not a safe bounded file: ${name}`);
    }
    const contents = fs4.readFileSync(file, "utf8");
    if (entry.sha256 !== sha2563(contents)) throw new Error(`Managed artifact hash mismatch: ${name}`);
    files[name] = contents;
  }
  return files;
}
function readBoundedJson(file, label) {
  const absolute = path4.resolve(file);
  const stat = fs4.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
    throw new Error(`${label} must be a regular, non-symlink JSON file under 4 MiB.`);
  }
  return JSON.parse(fs4.readFileSync(absolute, "utf8"));
}
function reconcile(outDir, implementationMapPath, calculatedAt) {
  const existing = readManagedArtifactSet(outDir);
  if (!existing["build-request.json"] || !existing["spec.json"]) {
    throw new Error("Reconciliation requires the committed build-request.json and spec.json artifacts.");
  }
  const specPacket = JSON.parse(existing["spec.json"]);
  const request = validateBuildRequest(JSON.parse(existing["build-request.json"]), specPacket);
  const implementationMap = validateImplementationMap(
    request,
    readBoundedJson(implementationMapPath, "implementation-map.json")
  );
  const packageJson = JSON.parse(fs4.readFileSync(PACKAGE_JSON, "utf8"));
  const convergence = calculateConvergence(request, implementationMap, {
    groundworkVersion: typeof packageJson.version === "string" ? packageJson.version : "unknown",
    calculatedAt: calculatedAt || (/* @__PURE__ */ new Date()).toISOString()
  });
  existing["convergence.json"] = JSON.stringify(convergence, null, 2) + "\n";
  for (const destination of writeArtifactSetAtomically(outDir, existing)) process.stdout.write(`${destination}
`);
}
function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(`Argument error: ${error.message}`);
  }
  const { source, out, allowSpecRoots, implementationMap, runId, createdAt, exportFormat, exportOut, checkOwnedFiles, repoRoot } = parsed;
  if (implementationMap) {
    if (!out) fail("Reconciliation requires --out <existing Groundwork artifact directory>.");
    try {
      reconcile(path4.resolve(out), implementationMap, createdAt);
    } catch (error) {
      fail(`Convergence reconciliation failed: ${error.message}`);
    }
    process.exit(0);
  }
  let rawText;
  if (!source || source === "-") {
    rawText = readStdinSync();
    if (!rawText.trim()) {
      fail(
        "No Spec provided. Pass a JSON file path, or pipe Spec JSON on stdin (use '-' or omit the argument)."
      );
    }
  } else {
    const specPath = path4.resolve(source);
    if (!fs4.existsSync(specPath)) {
      fail(`Spec file not found: ${specPath}`);
    }
    rawText = fs4.readFileSync(specPath, "utf8");
  }
  let rawObj;
  try {
    rawObj = JSON.parse(rawText);
  } catch (e) {
    fail(`Spec is not valid JSON: ${e.message}`);
  }
  let spec;
  try {
    spec = SpecSchema.parse(rawObj);
  } catch (e) {
    if (e instanceof external_exports.ZodError) reportZodError(e);
    throw e;
  }
  if (checkOwnedFiles) {
    try {
      checkOwnedFilesAgainstRepo(spec, repoRoot);
    } catch (error) {
      fail(`Owned-file validation failed: ${error.message}`);
    }
    process.stdout.write(`${JSON.stringify({ status: "pass", checked: allExplicitOwnedFiles(spec).length, repoRoot: fs4.realpathSync(path4.resolve(repoRoot)) })}
`);
    return;
  }
  let baselineArtifactBundle;
  try {
    baselineArtifactBundle = bundleBaselineArtifacts(spec, source);
  } catch (error) {
    fail(`Baseline artifact validation failed before publication: ${error.message}`);
  }
  let derivedExport;
  if (exportFormat) {
    try {
      derivedExport = exportFormat === "spec-kit" ? exportSpecKit(spec) : exportOpenSpec(spec);
    } catch (error) {
      fail(`Derived export generation failed: ${error.message}`);
    }
  }
  const slug3 = kebab(spec.productName);
  const outDir = out ? path4.resolve(out) : process.env.GROUNDWORK_OUT ? path4.resolve(process.env.GROUNDWORK_OUT) : path4.join(os.homedir(), "dev", "designs", slug3);
  if (exportOut) {
    try {
      assertDisjointArtifactRoots(outDir, exportOut);
      if (derivedExport) validateDerivedExportDestination(exportOut, derivedExport);
    } catch (error) {
      fail(`Derived export destination is invalid: ${error.message}`);
    }
  }
  try {
    assertNoBaselineDestinationSymlinks(spec, outDir);
  } catch (error) {
    fail(`Baseline artifact destination is unsafe before publication: ${error.message}`);
  }
  fs4.mkdirSync(outDir, { recursive: true });
  const canonicalOutDir = fs4.realpathSync(outDir);
  recoverArtifactTransactions(canonicalOutDir);
  const repoLayout = spec.projectContext.repoLayout;
  const hasRepoLayout = Boolean(
    repoLayout && Object.values(repoLayout).some((v) => typeof v === "string" && v.trim().length > 0)
  );
  if (spec.projectContext.startingPoint === "existing-app" && !hasRepoLayout) {
    process.stderr.write(
      "Warning: projectContext.startingPoint is 'existing-app' but no projectContext.repoLayout was supplied. Owned-file paths in tasks.md will be generic per-platform scaffolding (e.g. src/db/schema.ts, src/features/\u2026) and may not match this repository's real directory conventions. Supply repoLayout to preserve observed facts.\n"
    );
  }
  const docs = renderDocs(spec);
  let visualEvidence;
  try {
    visualEvidence = loadVisualEvidence(canonicalOutDir);
  } catch (error) {
    fail(`Visual evidence is invalid: ${error.message}`);
  }
  docs["steering.md"] += `
## Confirmed visual direction

${visualEvidence.steeringLines.join("\n")}
`;
  let resolvedGraph;
  try {
    resolvedGraph = resolveSpecGraph(spec, {
      sourcePath: source && source !== "-" ? path4.resolve(source) : void 0,
      allowedRoots: allowSpecRoots
    });
  } catch (error) {
    fail(`Spec dependency resolution failed: ${error.message}`);
  }
  const taskGraph = compileTaskGraph(spec, deriveTasks(spec));
  const tasks2 = renderTasks(spec, taskGraph);
  const traceability = TraceMatrixSchema.parse(buildTraceability(spec, taskGraph));
  const specPacket = canonicalSpecPacket(spec, traceability);
  let buildRequest;
  try {
    buildRequest = createBuildRequest({
      spec,
      canonicalSpecPacket: specPacket,
      tasks: taskGraph,
      runId,
      createdAt
    });
  } catch (error) {
    fail(`Build request generation failed: ${error.message}`);
  }
  const architecture = architectureArtifact(resolvedGraph, buildRequest.specDigest);
  const builderHandoff = renderBuilderHandoff(spec, {
    docs,
    tasks: tasks2,
    traceability,
    resolvedArchitecture: architecture,
    visualEvidence: visualEvidence.embedded
  });
  const files = {
    // Persist the validated source object beside its rendered projections so a
    // later mockup or design-token session can resume without relying on the
    // host agent's temporary input file.
    "spec.json": JSON.stringify(specPacket, null, 2) + "\n",
    "steering.md": docs["steering.md"],
    "requirements.md": docs["requirements.md"],
    "design.md": docs["design.md"],
    "design-system.md": docs["design-system.md"],
    "tasks.md": tasks2,
    "builder-handoff.md": builderHandoff,
    "traceability.json": JSON.stringify(traceability, null, 2) + "\n",
    "architecture.json": JSON.stringify(architecture, null, 2) + "\n",
    "build-request.json": JSON.stringify(buildRequest, null, 2) + "\n",
    ...baselineArtifactBundle ? { "baseline-artifacts.json": baselineArtifactBundle } : {}
  };
  const publishCanonical = () => {
    for (const dest of writeArtifactSetAtomically(canonicalOutDir, files)) process.stdout.write(`${dest}
`);
  };
  try {
    if (derivedExport && exportOut) {
      withDerivedExportReservation(exportOut, derivedExport, (publish) => {
        const destinations = publish(spec, publishCanonical);
        for (const destination of destinations) process.stdout.write(`${destination}
`);
        process.stderr.write(`${JSON.stringify({
          event: "derived_export_written",
          operation: "publish",
          outcome: "passed",
          schema: "groundwork.derived-export/v1",
          format: derivedExport.format,
          exporterVersion: derivedExport.exporterVersion,
          sourceCommit: derivedExport.source.stableCommit,
          fileCount: derivedExport.files.length
        })}
`);
      }, {
        canonicalRoot: canonicalOutDir,
        canonicalProof: { fileName: "spec.json", sha256: sha2563(files["spec.json"]) }
      });
    } else {
      publishCanonical();
    }
  } catch (error) {
    fail(`Artifact publication failed; previous managed output restored: ${error.message}`);
  }
  process.exitCode = 0;
}
main();
