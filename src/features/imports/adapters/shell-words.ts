import { CollectionImportError } from "../domain";

function decodeAnsiEscape(character: string, input: string, index: number) {
  if (character === "n") return { value: "\n", consumed: 0 };
  if (character === "r") return { value: "\r", consumed: 0 };
  if (character === "t") return { value: "\t", consumed: 0 };
  if (character === "b") return { value: "\b", consumed: 0 };
  if (character === "f") return { value: "\f", consumed: 0 };
  if (character === "v") return { value: "\v", consumed: 0 };
  if (character === "x") {
    const hex = input.slice(index + 1, index + 3);
    if (/^[\da-f]{2}$/i.test(hex)) {
      return {
        value: String.fromCodePoint(Number.parseInt(hex, 16)),
        consumed: 2,
      };
    }
  }
  return { value: character, consumed: 0 };
}

export function parseShellWords(source: string) {
  if (source.length > 256_000) {
    throw new CollectionImportError("Command imports are limited to 256 KiB.");
  }
  const input = source.replace(/\\\r?\n/g, " ").trim();
  const words: string[] = [];
  let word = "";
  let state: "plain" | "single" | "double" | "ansi" = "plain";
  let active = false;

  const finish = () => {
    if (active) words.push(word);
    word = "";
    active = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (state === "single") {
      if (character === "'") state = "plain";
      else word += character;
      active = true;
      continue;
    }
    if (state === "double") {
      if (character === '"') {
        state = "plain";
      } else if (
        character === "`" ||
        (character === "$" && input[index + 1] === "(")
      ) {
        throw new CollectionImportError(
          "Shell command substitutions are not imported.",
          "IMPORT_SHELL_CONTROL_BLOCKED",
        );
      } else if (character === "\\") {
        const next = input[index + 1];
        if (next && ['"', "\\", "$", "`"].includes(next)) {
          word += next;
          index += 1;
        } else {
          word += character;
        }
      } else {
        word += character;
      }
      active = true;
      continue;
    }
    if (state === "ansi") {
      if (character === "'") {
        state = "plain";
      } else if (character === "\\") {
        const next = input[index + 1];
        if (next) {
          const decoded = decodeAnsiEscape(next, input, index + 1);
          word += decoded.value;
          index += 1 + decoded.consumed;
        }
      } else {
        word += character;
      }
      active = true;
      continue;
    }

    if (/\s/.test(character)) {
      finish();
      continue;
    }
    if (character === "#" && !active) break;
    if (character === "'") {
      state = "single";
      active = true;
      continue;
    }
    if (character === '"') {
      state = "double";
      active = true;
      continue;
    }
    if (character === "$" && input[index + 1] === "'") {
      state = "ansi";
      active = true;
      index += 1;
      continue;
    }
    if (character === "\\") {
      const next = input[index + 1];
      if (next) {
        word += next;
        active = true;
        index += 1;
      }
      continue;
    }
    if ([";", "|", "&", ">", "<", "`"].includes(character)) {
      throw new CollectionImportError(
        "Shell pipelines, redirects, substitutions, and multiple commands are not imported.",
        "IMPORT_SHELL_CONTROL_BLOCKED",
      );
    }
    if (character === "$" && input[index + 1] === "(") {
      throw new CollectionImportError(
        "Shell command substitutions are not imported.",
        "IMPORT_SHELL_CONTROL_BLOCKED",
      );
    }
    word += character;
    active = true;
  }
  if (state !== "plain") {
    throw new CollectionImportError(
      "The command contains an unterminated quote.",
    );
  }
  finish();
  if (words.length > 10_000) {
    throw new CollectionImportError("The command contains too many arguments.");
  }
  return words;
}
