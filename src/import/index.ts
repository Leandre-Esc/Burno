import { parse as parseYaml } from "yaml";
import type { ImportBundle } from "./common";
import { looksLikeCurl, parseCurl } from "./curl";
import { isInsomniaV4, isInsomniaV5, parseInsomniaV4, parseInsomniaV5 } from "./insomnia";
import { isOpenApi, parseOpenApi } from "./openapi";
import { isPostmanCollection, isPostmanEnvironment, parsePostmanCollection, parsePostmanEnvironment } from "./postman";

export type { ImportBundle } from "./common";
export { planFiles, safeName } from "./common";
export { looksLikeCurl, parseCurl } from "./curl";

const UNKNOWN = "Not recognized. Burno imports cURL commands, Postman collections and environments, Insomnia exports and OpenAPI or Swagger documents.";

/** Reads a cURL command or an exported document. Throws a readable error otherwise. */
export function parseImport(text: string): ImportBundle {
  if (looksLikeCurl(text)) {
    const bundle = parseCurl(text);
    if (!bundle) throw new Error("This cURL command has no URL.");
    return bundle;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = parseYaml(text);
    } catch {
      throw new Error(UNKNOWN);
    }
  }
  if (isOpenApi(doc)) return parseOpenApi(doc);
  if (isPostmanCollection(doc)) return parsePostmanCollection(doc);
  if (isPostmanEnvironment(doc)) return parsePostmanEnvironment(doc);
  if (isInsomniaV4(doc)) return parseInsomniaV4(doc);
  if (isInsomniaV5(doc)) return parseInsomniaV5(doc);
  throw new Error(UNKNOWN);
}
