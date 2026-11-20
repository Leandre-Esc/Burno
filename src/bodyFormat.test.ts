import { describe, expect, it } from "vitest";
import { checkJson, formatJson, formatXml, fromBulk, locateXmlError, toBulk } from "./bodyFormat";

describe("checkJson", () => {
  it("accepts valid JSON and empty bodies", () => {
    expect(checkJson("")).toBeNull();
    expect(checkJson('{"a": [1, -2.5e3, true, null, "x\\"y"], "b": {}}')).toBeNull();
    expect(checkJson("[]")).toBeNull();
  });

  it("accepts {{variables}} as values, keys and inside strings", () => {
    expect(checkJson('{"id": {{userId}}, "name": "{{first}} {{ last }}", {{dynKey}}: [{{$randomInt}}]}')).toBeNull();
  });

  it("points at the faulty token", () => {
    const text = '{\n  "a": 1\n  "b": 2\n}';
    const issue = checkJson(text)!;
    expect(issue.message).toMatch(/Expected ',' or '}'/);
    expect(text.slice(issue.from, issue.to)).toBe('"b"');
  });

  it("explains common mistakes", () => {
    expect(checkJson('{"a": 1,}')!.message).toBe("Trailing comma");
    expect(checkJson("[1, 2,]")!.message).toBe("Trailing comma");
    expect(checkJson("{'a': 1}")!.message).toMatch(/double quotes/);
    expect(checkJson("{a: 1}")!.message).toMatch(/quotes/);
    expect(checkJson('{"a": 1')!.message).toBe("Unexpected end of JSON");
    expect(checkJson('{"a": "oops}')!.message).toBe("Unterminated string");
    expect(checkJson("{} {}")!.message).toMatch(/after the end/);
    expect(checkJson('{"a": truex}')).not.toBeNull();
  });
});

describe("formatJson", () => {
  it("pretty-prints with variables kept as-is", () => {
    expect(formatJson('{"id":{{userId}},"tags":[],"o":{},"list":[1,"{{x}}"]}')).toBe(
      '{\n  "id": {{userId}},\n  "tags": [],\n  "o": {},\n  "list": [\n    1,\n    "{{x}}"\n  ]\n}',
    );
  });

  it("minifies", () => {
    expect(formatJson('{\n  "a": [ 1, 2 ],\n  "b": "x y"\n}', 0)).toBe('{"a":[1,2],"b":"x y"}');
  });

  it("returns null for invalid JSON", () => {
    expect(formatJson('{"a": }')).toBeNull();
  });

  it("matches JSON.stringify on plain JSON", () => {
    const value = { a: [1, { b: "c", d: [] }], e: null, f: { g: true } };
    expect(formatJson(JSON.stringify(value))).toBe(JSON.stringify(value, null, 2));
  });
});

describe("formatXml", () => {
  it("indents nested elements and keeps text inline", () => {
    expect(formatXml('<?xml version="1.0"?><root a="x>y"><item id="1">Hello {{name}}</item><empty/><e></e><!-- note --></root>')).toBe(
      '<?xml version="1.0"?>\n<root a="x>y">\n  <item id="1">Hello {{name}}</item>\n  <empty/>\n  <e></e>\n  <!-- note -->\n</root>',
    );
  });

  it("re-indents already formatted XML the same way", () => {
    const pretty = "<a>\n  <b>\n    <c>1</c>\n  </b>\n</a>";
    expect(formatXml(pretty)).toBe(pretty);
    expect(formatXml("<a>\n<b>\n        <c>1</c></b></a>")).toBe(pretty);
  });
});

describe("locateXmlError", () => {
  it("maps line and column to an offset", () => {
    const text = "<a>\n  <b></c>\n</a>";
    const issue = locateXmlError(text, "This page contains the following errors:error on line 2 at column 10: Opening and ending tag mismatch: b line 2 and c\nBelow is a rendering…");
    expect(issue.message).toBe("Opening and ending tag mismatch: b line 2 and c");
    expect(text.slice(0, issue.to).split("\n").length).toBe(2);
  });
});

describe("bulk edit", () => {
  it("round-trips rows", () => {
    const rows = [
      { key: "a", value: "1", enabled: true },
      { key: "b", value: "x: y", enabled: false },
    ];
    expect(toBulk(rows)).toBe("a: 1\n// b: x: y");
    expect(fromBulk(toBulk(rows))).toEqual(rows);
  });

  it("handles files with @ and skips blank lines", () => {
    const rows = fromBulk("avatar: @/tmp/me.png\n\nname: Ann\nflag", true);
    expect(rows).toEqual([
      { key: "avatar", value: "/tmp/me.png", enabled: true, isFile: true },
      { key: "name", value: "Ann", enabled: true, isFile: false },
      { key: "flag", value: "", enabled: true, isFile: false },
    ]);
    expect(toBulk(rows, true)).toBe("avatar: @/tmp/me.png\nname: Ann\nflag: ");
  });
});
