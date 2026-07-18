export class JsonPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonPathError";
  }
}

type Segment = string | number | "*";

function parseJsonPath(path: string): Segment[] {
  const source = path.trim();
  if (!source.startsWith("$")) {
    throw new JsonPathError("JSONPath must start with $.");
  }

  const segments: Segment[] = [];
  let index = 1;
  while (index < source.length) {
    if (source[index] === ".") {
      index += 1;
      if (source[index] === "*") {
        segments.push("*");
        index += 1;
        continue;
      }
      const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(index));
      if (!match)
        throw new JsonPathError(
          `Invalid JSONPath near ${source.slice(index)}.`,
        );
      segments.push(match[0]);
      index += match[0].length;
      continue;
    }

    if (source[index] === "[") {
      const end = source.indexOf("]", index + 1);
      if (end === -1)
        throw new JsonPathError("JSONPath bracket is not closed.");
      const content = source.slice(index + 1, end).trim();
      if (content === "*") {
        segments.push("*");
      } else if (/^\d+$/.test(content)) {
        segments.push(Number(content));
      } else {
        const quoted = /^(?:'([^']*)'|"([^"]*)")$/.exec(content);
        if (!quoted)
          throw new JsonPathError(`Unsupported JSONPath segment [${content}].`);
        segments.push(quoted[1] ?? quoted[2] ?? "");
      }
      index = end + 1;
      continue;
    }

    throw new JsonPathError(`Invalid JSONPath near ${source.slice(index)}.`);
  }
  return segments;
}

export function evaluateJsonPath(document: unknown, path: string): unknown {
  let values: unknown[] = [document];
  let wildcard = false;
  for (const segment of parseJsonPath(path)) {
    const next: unknown[] = [];
    for (const value of values) {
      if (segment === "*") {
        wildcard = true;
        if (Array.isArray(value)) next.push(...value);
        else if (value && typeof value === "object")
          next.push(...Object.values(value));
        continue;
      }
      if (typeof segment === "number") {
        if (Array.isArray(value) && segment < value.length)
          next.push(value[segment]);
        continue;
      }
      if (value && typeof value === "object" && Object.hasOwn(value, segment)) {
        next.push((value as Record<string, unknown>)[segment]);
      }
    }
    values = next;
  }
  if (wildcard) return values;
  return values[0];
}

export function outputValueToString(value: unknown): string {
  if (value === undefined)
    throw new JsonPathError("JSONPath did not match a value.");
  if (typeof value === "string") return value;
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}
