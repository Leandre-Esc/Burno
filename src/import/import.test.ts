import { describe, expect, it } from "vitest";
import { newRequest } from "../types";
import { parseImport, planFiles, safeName } from "./index";
import { tokenize } from "./curl";
import { search, type SearchItem } from "../search";

const only = (text: string) => parseImport(text).requests[0].request;
const rows = (list: { key: string; value: string }[]) => list.filter((r) => r.key).map((r) => [r.key, r.value]);

describe("cURL", () => {
  it("reads a multi-line command with quotes", () => {
    const req = only(`curl -X POST 'https://api.test/users?a=1' \\
      -H 'Content-Type: application/json' \\
      -H "X-Trace: abc" \\
      --data-raw '{"name":"Ann"}' --compressed`);
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.test/users?a=1");
    expect(rows(req.params)).toEqual([["a", "1"]]);
    expect(rows(req.headers)).toEqual([["Content-Type", "application/json"], ["X-Trace", "abc"]]);
    expect(req.body).toMatchObject({ mode: "json", json: '{"name":"Ann"}' });
  });

  it("survives a paste into a single-line field", () => {
    const req = only(`curl https://api.test/a \\  -H 'X-A: 1' \\  -H 'X-B: 2'`);
    expect(rows(req.headers)).toEqual([["X-A", "1"], ["X-B", "2"]]);
  });

  it("defaults to POST with data, reads a form", () => {
    const req = only(`curl api.test/login -d 'user=ann&city=New%20York'`);
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://api.test/login");
    expect(req.body.mode).toBe("form");
    expect(rows(req.body.form)).toEqual([["user", "ann"], ["city", "New York"]]);
  });

  it("reads short flags glued together and multipart", () => {
    const req = only(`curl -sSLk -XPUT https://a.test -F 'doc=@/tmp/a.pdf;type=application/pdf' -F 'title=hello'`);
    expect(req.method).toBe("PUT");
    expect(req.settings.verifySsl).toBe(false);
    expect(req.body.mode).toBe("multipart");
    expect(req.body.multipart.slice(0, 2)).toMatchObject([
      { key: "doc", value: "/tmp/a.pdf", isFile: true },
      { key: "title", value: "hello", isFile: false },
    ]);
  });

  it("moves credentials to the auth tab", () => {
    const bearer = only(`curl https://a.test -H 'Authorization: Bearer s3cret'`);
    expect(bearer.auth.type).toBe("bearer");
    expect(bearer.auth.bearer.token).toBe("s3cret");
    expect(rows(bearer.headers)).toEqual([]);

    const basic = only(`curl -u ann:pw https://a.test`);
    expect(basic.auth).toMatchObject({ type: "basic", basic: { username: "ann", password: "pw" } });

    const b64 = only(`curl https://a.test -H 'Authorization: Basic ${btoa("ann:pw")}'`);
    expect(b64.auth).toMatchObject({ type: "basic", basic: { username: "ann", password: "pw" } });

    const key = only(`curl https://a.test -H 'X-API-Key: abc'`);
    expect(key.auth).toMatchObject({ type: "apikey", apikey: { key: "X-API-Key", value: "abc" } });
  });

  it("warns about credentials it can't move", () => {
    const bundle = parseImport(`curl 'https://a.test?api_key=abc' -b 'session=1'`);
    expect(bundle.warnings.join()).toMatch(/Cookie header/);
    expect(bundle.warnings.join()).toMatch(/api_key query param/);
    expect(parseImport(`curl 'https://a.test' -H 'Cookie: {{c}}'`).warnings).toEqual([]);
  });

  it("-G sends data in the query", () => {
    const req = only(`curl -G https://a.test/s -d q=1 -d r=2`);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://a.test/s?q=1&r=2");
    expect(req.body.mode).toBe("none");
  });

  it("tokenizes shell quoting", () => {
    expect(tokenize(`a 'b c' "d \\"e" f\\ g $'h\\ni'`)).toEqual(["a", "b c", 'd "e', "f", "g", "h\ni"]);
  });

  it("refuses a command with no URL", () => {
    expect(() => parseImport("curl -X POST")).toThrow(/no URL/);
  });
});

const postman = {
  info: { name: "Shop", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{tok}}" }] },
  variable: [{ key: "host", value: "a.test" }, { key: "adminPassword", value: "pw" }],
  event: [{ listen: "test", script: { exec: ["pm.test()"] } }],
  item: [
    {
      name: "Users",
      item: [
        {
          name: "Get user",
          request: {
            method: "GET",
            url: {
              raw: "https://{{host}}/users/:id?verbose=1",
              query: [{ key: "verbose", value: "1" }, { key: "off", value: "2", disabled: true }],
              variable: [{ key: "id", value: "42" }],
            },
            header: [{ key: "Accept", value: "application/json" }, { key: "X-Off", value: "1", disabled: true }],
          },
        },
        {
          name: "Login",
          request: {
            method: "POST",
            url: "https://{{host}}/login",
            auth: { type: "basic", basic: { username: "ann", password: "literal" } },
            body: { mode: "urlencoded", urlencoded: [{ key: "a", value: "1" }] },
          },
        },
        {
          name: "Query",
          request: {
            method: "POST",
            url: { host: ["{{host}}"], path: ["graphql"], protocol: "https" },
            auth: { type: "noauth" },
            body: { mode: "graphql", graphql: { query: "{ me }", variables: '{"a":1}' } },
          },
        },
      ],
    },
    {
      name: "Upload",
      request: { method: "POST", url: "https://a.test/u", body: { mode: "formdata", formdata: [{ key: "f", type: "file", src: "/tmp/a" }, { key: "t", type: "text", value: "x" }] } },
    },
  ],
};

describe("Postman", () => {
  const bundle = parseImport(JSON.stringify(postman));
  const by = (name: string) => bundle.requests.find((r) => r.request.name === name)!;

  it("keeps the folder tree and turns path variables into {{variables}}", () => {
    expect(bundle.format).toBe("Postman collection");
    expect(by("Get user").folder).toEqual(["Users"]);
    const req = by("Get user").request;
    expect(req.url).toBe("https://{{host}}/users/{{id}}?verbose=1");
    expect(rows(req.vars)).toEqual([["id", "42"]]);
    expect(req.params.filter((p) => p.key).map((p) => [p.key, p.enabled])).toEqual([["verbose", true], ["off", false]]);
    expect(req.headers[1]).toMatchObject({ key: "X-Off", enabled: false });
  });

  it("inherits auth, honours noauth and overrides", () => {
    expect(by("Get user").request.auth).toMatchObject({ type: "bearer", bearer: { token: "{{tok}}" } });
    expect(by("Login").request.auth).toMatchObject({ type: "basic", basic: { password: "literal" } });
    expect(by("Query").request.auth.type).toBe("none");
  });

  it("reads every body type", () => {
    expect(by("Login").request.body.mode).toBe("form");
    expect(JSON.parse(by("Query").request.body.json)).toEqual({ query: "{ me }", variables: { a: 1 } });
    expect(by("Query").request.url).toBe("https://{{host}}/graphql");
    expect(by("Upload").request.body.multipart[0]).toMatchObject({ key: "f", value: "/tmp/a", isFile: true });
  });

  it("marks credential-like variables as secrets and warns about scripts", () => {
    expect(bundle.variables).toEqual([
      { key: "host", value: "a.test", enabled: true },
      { key: "adminPassword", value: "pw", enabled: true, secret: true },
    ]);
    expect(bundle.warnings.join()).toMatch(/1 pre-request or test script/);
  });

  it("reads an environment export", () => {
    const env = parseImport(JSON.stringify({ name: "Prod", _postman_variable_scope: "environment", values: [{ key: "a", value: "1", enabled: true }, { key: "k", value: "2", enabled: false, type: "secret" }] }));
    expect(env.environments).toEqual([{ name: "Prod", variables: [{ key: "a", value: "1", enabled: true }, { key: "k", value: "2", enabled: false, secret: true }] }]);
  });
});

describe("Insomnia", () => {
  const v4 = {
    _type: "export",
    __export_format: 4,
    resources: [
      { _id: "wrk", _type: "workspace", name: "Team" },
      { _id: "fld", _type: "request_group", parentId: "wrk", name: "Admin" },
      {
        _id: "r1", _type: "request", parentId: "fld", name: "List", method: "GET", url: "{{ _.base }}/items",
        parameters: [{ name: "page", value: "1" }, { name: "off", value: "2", disabled: true }],
        headers: [{ name: "Accept", value: "*/*" }],
        authentication: { type: "bearer", token: "{{ _.tok }}" },
        body: {},
      },
      {
        _id: "r2", _type: "request", parentId: "wrk", name: "Create", method: "POST", url: "https://a.test",
        body: { mimeType: "application/json", text: '{"a":1}' },
        authentication: { type: "apikey", key: "X-K", value: "literal", addTo: "header" },
      },
      { _id: "r3", _type: "request", parentId: "wrk", name: "Tag", method: "GET", url: "https://a.test/{% now 'iso' %}" },
      { _id: "ws", _type: "websocket_request", parentId: "wrk", name: "Socket" },
      { _id: "base", _type: "environment", parentId: "wrk", name: "Base", data: { base: "https://a.test", nested: { apiToken: "x" } } },
      { _id: "dev", _type: "environment", parentId: "base", name: "Dev", data: { base: "https://dev.test" } },
    ],
  };

  it("reads a v4 export", () => {
    const b = parseImport(JSON.stringify(v4));
    expect(b.name).toBe("Team");
    const list = b.requests.find((r) => r.request.name === "List")!;
    expect(list.folder).toEqual(["Admin"]);
    expect(list.request.url).toBe("{{base}}/items?page=1");
    expect(list.request.params.filter((p) => p.key).map((p) => [p.key, p.enabled])).toEqual([["page", true], ["off", false]]);
    expect(list.request.auth).toMatchObject({ type: "bearer", bearer: { token: "{{tok}}" } });
    const create = b.requests.find((r) => r.request.name === "Create")!.request;
    expect(create.body).toMatchObject({ mode: "json", json: '{"a":1}' });
    expect(create.auth).toMatchObject({ type: "apikey", apikey: { key: "X-K", value: "literal" } });
    expect(b.variables).toEqual([
      { key: "base", value: "https://a.test", enabled: true },
      { key: "nested.apiToken", value: "x", enabled: true, secret: true },
    ]);
    expect(b.environments.map((e) => e.name)).toEqual(["Dev"]);
    expect(b.warnings.join()).toMatch(/1 gRPC or WebSocket/);
    expect(b.warnings.join()).toMatch(/template tags/);
  });

  it("reads a v5 YAML export", () => {
    const b = parseImport(`type: collection.insomnia.rest/5.0
name: Team
collection:
  - name: Admin
    children:
      - name: List
        url: "{{ _.base }}/items"
        method: GET
        headers:
          - name: Accept
            value: "*/*"
environments:
  name: Base
  data:
    base: https://a.test
  subEnvironments:
    - name: Dev
      data:
        base: https://dev.test
`);
    expect(b.requests[0].folder).toEqual(["Admin"]);
    expect(b.requests[0].request.url).toBe("{{base}}/items");
    expect(b.environments[0].name).toBe("Dev");
  });
});

const openapi = `
openapi: 3.0.3
info: { title: Pets, version: "1" }
servers:
  - url: https://{region}.pets.test/v1
    description: Production
    variables: { region: { default: eu } }
  - url: http://localhost:3000
    description: Local
security: [{ bearer: [] }]
paths:
  /pets/{id}:
    parameters:
      - { name: id, in: path, required: true, schema: { type: integer } }
    get:
      tags: [pets]
      summary: Get a pet
      parameters:
        - { name: fields, in: query, schema: { type: string } }
        - { name: lang, in: query, required: true, schema: { type: string, enum: [fr, en] } }
        - { name: X-Trace, in: header, schema: { type: string } }
        - { name: Accept, in: header, schema: { type: string } }
    put:
      tags: [pets]
      operationId: updatePet
      security: [{ key: [] }]
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Pet" }
  /upload:
    post:
      security: []
      requestBody:
        content:
          multipart/form-data:
            schema:
              properties:
                file: { type: string, format: binary }
                title: { type: string, example: Hi }
  /login:
    post:
      security: [{ oauth: [read, write] }]
      requestBody:
        content:
          application/x-www-form-urlencoded:
            schema:
              properties:
                user: { type: string, example: ann }
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
    key: { type: apiKey, in: header, name: X-Key }
    oauth:
      type: oauth2
      flows:
        clientCredentials: { tokenUrl: "https://a.test/token", scopes: {} }
  schemas:
    Pet:
      type: object
      properties:
        name: { type: string, example: Rex }
        age: { type: integer }
        parent: { $ref: "#/components/schemas/Pet" }
        tags: { type: array, items: { type: string } }
`;

describe("OpenAPI", () => {
  const b = parseImport(openapi);
  const by = (name: string) => b.requests.find((r) => r.request.name === name)!;

  it("turns servers into a base URL and environments", () => {
    expect(b.format).toBe("OpenAPI 3.0.3");
    expect(b.variables[0]).toEqual({ key: "baseUrl", value: "https://eu.pets.test/v1", enabled: true });
    expect(b.environments.map((e) => e.name)).toEqual(["Production", "Local"]);
  });

  it("builds URLs, params and headers without making up values", () => {
    const get = by("Get a pet");
    expect(get.folder).toEqual(["pets"]);
    expect(get.request.url).toBe("{{baseUrl}}/pets/{{id}}?lang=fr");
    expect(get.request.vars[0]).toEqual({ key: "id", value: "", enabled: false });
    expect(get.request.params.filter((p) => p.key).map((p) => [p.key, p.enabled])).toEqual([["lang", true], ["fields", false]]);
    expect(get.request.headers.filter((h) => h.key).map((h) => h.key)).toEqual(["X-Trace"]);
  });

  it("uses variables for auth, never literal values", () => {
    expect(by("Get a pet").request.auth).toMatchObject({ type: "bearer", bearer: { token: "{{token}}" } });
    expect(by("updatePet").request.auth).toMatchObject({ type: "apikey", apikey: { key: "X-Key", value: "{{apiKey}}" } });
    expect(by("POST /upload").request.auth.type).toBe("none");
    expect(by("POST /login").request.auth).toMatchObject({
      type: "oauth2",
      oauth2: { grantType: "client_credentials", accessTokenUrl: "https://a.test/token", clientId: "{{clientId}}", scope: "read write" },
    });
    expect(b.variables.find((v) => v.key === "token")).toEqual({ key: "token", value: "", enabled: true, secret: true });
    expect(b.variables.find((v) => v.key === "clientId")).toEqual({ key: "clientId", value: "", enabled: true });
  });

  it("samples bodies from schemas, including recursive ones", () => {
    expect(JSON.parse(by("updatePet").request.body.json)).toEqual({ name: "Rex", age: 0, tags: ["string"] });
    expect(by("POST /upload").request.body.multipart.slice(0, 2)).toMatchObject([
      { key: "file", isFile: true, value: "" },
      { key: "title", value: "Hi", isFile: false },
    ]);
    expect(rows(by("POST /login").request.body.form)).toEqual([["user", "ann"]]);
  });

  it("reads Swagger 2", () => {
    const s = parseImport(JSON.stringify({
      swagger: "2.0",
      info: { title: "Old" },
      host: "old.test",
      basePath: "/api",
      schemes: ["http", "https"],
      securityDefinitions: { basic: { type: "basic" } },
      paths: {
        "/a": { post: { security: [{ basic: [] }], parameters: [{ name: "body", in: "body", schema: { type: "object", properties: { x: { type: "string", example: "y" } } } }] } },
        "/b": { post: { consumes: ["multipart/form-data"], parameters: [{ name: "f", in: "formData", type: "file" }] } },
      },
    }));
    expect(s.variables[0].value).toBe("https://old.test/api");
    expect(s.requests[0].request.auth).toMatchObject({ type: "basic", basic: { password: "{{password}}" } });
    expect(JSON.parse(s.requests[0].request.body.json)).toEqual({ x: "y" });
    expect(s.requests[1].request.body.multipart[0]).toMatchObject({ key: "f", isFile: true });
  });

  it("does not hang on a $ref loop", () => {
    const loop = parseImport(JSON.stringify({ openapi: "3.0.0", paths: { "/a": { post: { requestBody: { $ref: "#/components/x" } } } }, components: { x: { $ref: "#/components/x" } } }));
    expect(loop.requests.length).toBe(1);
  });
});

describe("parseImport", () => {
  it("rejects anything else with a readable error", () => {
    expect(() => parseImport("hello")).toThrow(/Not recognized/);
    expect(() => parseImport('{"a":1}')).toThrow(/Not recognized/);
    expect(() => parseImport("a: [")).toThrow(/Not recognized/);
  });
});

describe("planFiles", () => {
  const req = (name: string) => ({ ...newRequest(), name });

  it("resolves name clashes and reuses folders", () => {
    const plan = planFiles(
      [
        { folder: ["Users"], request: req("Get") },
        { folder: ["Users"], request: req("get") },
        { folder: ["Users", "Deep"], request: req("A") },
        { folder: [], request: req("Existing") },
      ],
      "",
      ["existing.json", "Users"],
    );
    expect(plan.folders).toEqual(["Users 2", "Users 2/Deep"]);
    expect(plan.files.map((f) => f.path)).toEqual(["Users 2/Get.json", "Users 2/get 2.json", "Users 2/Deep/A.json", "Existing 2.json"]);
  });

  it("avoids names the collection reader treats specially", () => {
    const plan = planFiles(
      [{ folder: [], request: req("burno") }, { folder: ["environments"], request: req("A") }, { folder: ["target"], request: req("burno") }],
      "",
      [],
    );
    expect(plan.files.map((f) => f.path)).toEqual(["burno 2.json", "environments 2/A.json", "target 2/burno.json"]);
  });

  it("nests under the base folder", () => {
    expect(planFiles([{ folder: ["F"], request: req("A") }], "Imported", []).files[0].path).toBe("Imported/F/A.json");
  });

  it("can't escape through a name", () => {
    expect(safeName("../../etc/passwd")).toBe("-..-etc-passwd");
    expect(safeName("..")).toBe("Untitled");
    expect(safeName(".git")).toBe("git");
    expect(safeName("a".repeat(300)).length).toBe(80);
  });
});

describe("search", () => {
  const items: SearchItem[] = [
    { key: "1", kind: "request", label: "Delete user", method: "DELETE", detail: "Shop / users", keywords: "https://a.test/users/1" },
    { key: "2", kind: "request", label: "Get user", method: "GET", detail: "Shop / users", keywords: "https://a.test/users" },
    { key: "3", kind: "request", label: "User settings", method: "GET", detail: "Shop", keywords: "/settings" },
  ];
  const keys = (q: string) => search(items, q).map((i) => i.key);

  it("matches words in any order, across fields", () => {
    expect(keys("user delete")).toEqual(["1"]);
    expect(keys("get shop users")).toEqual(["2"]);
    expect(keys("nothing")).toEqual([]);
  });

  it("ranks by how well the name matches", () => {
    expect(keys("user")[0]).toBe("3");
    expect(keys("")).toEqual(["1", "2", "3"]);
  });
});
