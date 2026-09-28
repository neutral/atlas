#!/usr/bin/env python3
"""A separately written Atlas reader using only Python's standard library.

Authority: spec/SPEC.md, spec/FORMAT.md and spec/OPERATIONS.md.
The author previously implemented the JavaScript JSON/Markdown helper and saw
Library code. This is implementation independence, not blind author independence.
No Library code or helper is imported, executed, or used to construct this reader.
Acceptance checks encoding and structure, not explanation quality or source truth.
"""

import calendar
import collections
import decimal
import json
import math
import os
import pathlib
import re
import stat
import sys
import unicodedata
import urllib.parse


MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_ENTRIES = 10000
MAX_INTEGER = 9007199254740991
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,99}\Z")


class Rejected(Exception):
    def __init__(self, code, filename, message, incomplete=False):
        super().__init__(message)
        self.diagnostic = {"code": code, "path": filename, "message": message}
        self.incomplete = incomplete


def reject(code, filename, message, incomplete=False):
    raise Rejected(code, filename, message, incomplete)


def strict_json(text, filename):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                reject("I_JSON_DUPLICATE", filename, "Duplicate decoded JSON key.")
            result[key] = value
        return result

    def integer(token):
        digits = token.lstrip("-").lstrip("0")
        if len(digits) > 16 or abs(int(token)) > MAX_INTEGER:
            reject("I_JSON_NUMBER", filename, "Integer is outside the safe range.")
        return int(token)

    def fraction(token):
        number = decimal.Decimal(token)
        converted = float(number)
        if not math.isfinite(converted):
            reject("I_JSON_NUMBER", filename, "JSON number must be finite.")
        if converted.is_integer() and abs(converted) > MAX_INTEGER:
            reject("I_JSON_NUMBER", filename, "Integer is outside the safe range.")
        return converted

    def constant(_token):
        reject("I_JSON_NUMBER", filename, "Nonstandard numeric constant.")

    def inspect(value, depth=0):
        if depth > 128:
            reject("I_LIMIT", filename, "JSON nesting exceeds 128.", True)
        if isinstance(value, str):
            if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
                reject("I_JSON_UNICODE", filename, "Unpaired Unicode surrogate.")
        elif isinstance(value, dict):
            for key, item in value.items():
                inspect(key, depth + 1)
                inspect(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                inspect(item, depth + 1)

    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_int=integer,
                           parse_float=fraction, parse_constant=constant)
        inspect(value)
        return value
    except Rejected:
        raise
    except RecursionError:
        reject("I_LIMIT", filename, "JSON nesting exceeds the reader limit.", True)
    except (ValueError, decimal.InvalidOperation, OverflowError):
        reject("I_JSON_SYNTAX", filename, "Malformed JSON.")


def exact(value, allowed, required, filename):
    if not isinstance(value, dict):
        reject("I_RECORD", filename, "Record must be a JSON object.")
    if set(value) - set(allowed) or set(required) - set(value):
        reject("I_FIELDS", filename, "Unknown or missing record fields.")


def identifier(value, filename):
    if not isinstance(value, str) or not ID.fullmatch(value):
        reject("I_ID", filename, "Invalid identity.")


def prose(value, filename):
    if not isinstance(value, str) or not value.strip():
        reject("I_TEXT", filename, "Expected nonblank text.")


def array(value, filename, nonempty=False):
    if not isinstance(value, list) or (nonempty and not value):
        reject("I_ARRAY", filename, "Expected an array of the required cardinality.")
    if len(value) > MAX_ENTRIES:
        reject("I_LIMIT", filename, "Array exceeds the entry limit.", True)


def headings(lines):
    """Locate top-level ATX and Setext headings outside fenced/indented code."""
    found, paragraph = [], []
    fence_character, fence_length = None, 0
    for index, line in enumerate(lines):
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)
        if fence_character:
            if indent <= 3 and re.fullmatch(re.escape(fence_character) + "{" + str(fence_length) + r",}[ \t]*", stripped):
                fence_character = None
            continue
        fence = re.match(r"(`{3,}|~{3,})(.*)\Z", stripped) if indent <= 3 else None
        if fence and not (fence[1][0] == "`" and "`" in fence[2]):
            fence_character, fence_length = fence[1][0], len(fence[1])
            paragraph = []
            continue
        atx = re.fullmatch(r"(#{1,6})(?:[ \t]+(.*))?", stripped) if indent <= 3 else None
        if atx:
            title = re.sub(r"(?:^|[ \t]+)#+[ \t]*$", "", atx[2] or "").strip()
            found.append({"level": len(atx[1]), "title": title, "start": index, "end": index})
            paragraph = []
            continue
        underline = re.fullmatch(r"(=+|-+)[ \t]*", stripped) if indent <= 3 else None
        if underline and paragraph:
            found.append({"level": 1 if underline[1][0] == "=" else 2,
                          "title": " ".join(lines[n].strip() for n in paragraph),
                          "start": paragraph[0], "end": index})
            paragraph = []
            continue
        block = re.match(r"(?:>|[-+*][ \t]|[0-9]+[.)][ \t])", stripped)
        thematic = re.fullmatch(r"(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,}", stripped)
        if not line.strip() or indent >= 4 or line.startswith("\t") or block or thematic:
            paragraph = []
        else:
            paragraph.append(index)
    return found


def markdown(text, filename):
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0] != "---":
        reject("I_HEADER", filename, "Missing exact opening delimiter.")
    try:
        end = lines.index("---", 1)
    except ValueError:
        reject("I_HEADER", filename, "Missing exact closing delimiter.")
    header = strict_json("\n".join(lines[1:end]), filename)
    if not isinstance(header, dict):
        reject("I_HEADER", filename, "Markdown header must be an object.")
    content = lines[end + 1:]
    titles = headings(content)
    if not titles or titles[0]["level"] != 1 or not titles[0]["title"]:
        reject("I_TITLE", filename, "The first Markdown heading must be a nonblank H1.")
    if sum(item["level"] == 1 for item in titles) != 1:
        reject("I_TITLE", filename, "Expected exactly one H1 title.")
    title = titles[0]
    body = "\n".join(content[:title["start"]] + content[title["end"] + 1:]).strip()
    prose(body, filename)
    return header, title["title"], body


def source_reference(source, filename):
    exact(source, ["uri", "title", "role", "revision", "locator", "sha256"], ["uri"], filename)
    for field in ["uri", "title", "revision", "locator"]:
        if field in source:
            prose(source[field], filename)
    if "role" in source and source["role"] not in ["evidence", "background", "example", "implementation", "history"]:
        reject("I_SOURCE", filename, "Unknown source role.")
    if "sha256" in source and (not isinstance(source["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", source["sha256"])):
        reject("I_SOURCE", filename, "Invalid source digest.")
    uri = source["uri"]
    if any(ord(character) <= 32 or ord(character) == 127 for character in uri) or "\\" in uri:
        reject("I_SOURCE", filename, "Malformed source URI.")
    if re.match(r"https?://", uri, re.I):
        try:
            parsed = urllib.parse.urlsplit(uri)
            if not parsed.hostname or parsed.username is not None or parsed.password is not None:
                raise ValueError()
            parsed.port
        except ValueError:
            reject("I_SOURCE", filename, "Malformed HTTP(S) source or embedded credentials.")
    else:
        local = uri.split("#", 1)[0]
        if not local or local.startswith("/") or "?" in local or re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", local):
            reject("I_SOURCE", filename, "Expected HTTP(S) or an Atlas-root-relative source path.")
        if re.search(r"%(?![0-9a-fA-F]{2})", local) or re.search(r"%(?:2f|5c)", local, re.I):
            reject("I_SOURCE", filename, "Invalid or ambiguous path encoding.")
        try:
            decoded = urllib.parse.unquote_to_bytes(local).decode("utf-8", "strict")
        except UnicodeError:
            reject("I_SOURCE", filename, "Invalid source path encoding.")
        if decoded.startswith("/") or re.match(r"[A-Za-z]:", decoded) or "\\" in decoded or any(ord(c) < 32 or ord(c) == 127 for c in decoded):
            reject("I_SOURCE", filename, "Unsafe source path.")


def references(header, filename):
    if "uncertainty" in header:
        prose(header["uncertainty"], filename)
    if "sources" in header:
        array(header["sources"], filename)
        for source in header["sources"]:
            source_reference(source, filename)


def observation_date(value):
    if not isinstance(value, str):
        return False
    match = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2}))?", value)
    if not match:
        return False
    year, month, day = map(int, match.group(1, 2, 3))
    if not 1 <= month <= 12 or not 1 <= day <= calendar.monthrange(year, month)[1]:
        return False
    if match[4] is not None and (int(match[4]) > 23 or int(match[5]) > 59 or int(match[6]) > 59):
        return False
    zone = match[7]
    return not zone or zone == "Z" or int(zone[1:3]) <= 23 and int(zone[4:6]) <= 59


class Reader:
    def __init__(self, root):
        given = pathlib.Path(os.path.abspath(root))
        if given.is_symlink() or not given.is_dir():
            reject("I_ROOT", "", "Atlas root must be a nonsymlink directory.", True)
        self.root = given.resolve()
        self.aliases = {}
        self.captured = {}
        self.directories = {}
        self.total = 0
        self.entries = 0

    def relative(self, value):
        if not isinstance(value, str) or not value or len(value) > 4096:
            reject("I_PATH", str(value), "Invalid record path.")
        parts = value.split("/")
        if (value.startswith("/") or "\\" in value or any(ord(c) < 32 or ord(c) == 127 for c in value)
                or re.match(r"[A-Za-z]:", value) or any(part in ["", ".", ".."] for part in parts)
                or unicodedata.normalize("NFC", value) != value or any(part.lower().startswith(".atlas-") for part in parts)):
            reject("I_PATH", value, "Record path is not normalized or uses a reserved component.")
        for index in range(1, len(parts) + 1):
            prefix = "/".join(parts[:index])
            key = prefix.casefold()
            if key in self.aliases and self.aliases[key] != prefix:
                reject("I_PATH_ALIAS", value, "Case or Unicode path alias.")
            self.aliases[key] = prefix
        return value

    def checked(self, relative):
        self.relative(relative)
        current = self.root
        parts = relative.split("/")
        for index, part in enumerate(parts):
            current = current / part
            record = current.lstat()
            if stat.S_ISLNK(record.st_mode):
                reject("I_SYMLINK", relative, "Authored paths cannot traverse symlinks.")
            if index < len(parts) - 1 and not stat.S_ISDIR(record.st_mode):
                reject("I_PATH", relative, "An authored parent is not a directory.")
        return current, record

    @staticmethod
    def signature(record):
        return (record.st_dev, record.st_ino, record.st_mode, record.st_size, record.st_mtime_ns, record.st_ctime_ns)

    def read(self, filename):
        try:
            target, original = self.checked(filename)
            if not stat.S_ISREG(original.st_mode):
                reject("I_FILE", filename, "Authored records must be regular files.")
            if original.st_size > MAX_FILE or len(self.captured) >= MAX_ENTRIES:
                reject("I_LIMIT", filename, "File size or inventory limit exceeded.", True)
            descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
            with os.fdopen(descriptor, "rb") as handle:
                before = os.fstat(handle.fileno())
                if self.signature(before) != self.signature(original):
                    reject("I_CHANGED", filename, "Authored record changed before capture.", True)
                data = handle.read(MAX_FILE + 1)
                after = os.fstat(handle.fileno())
            _target, final = self.checked(filename)
            if not self.signature(original) == self.signature(before) == self.signature(after) == self.signature(final):
                reject("I_CHANGED", filename, "Authored record changed during capture.", True)
            if len(data) > MAX_FILE or self.total + len(data) > MAX_TOTAL:
                reject("I_LIMIT", filename, "Captured bytes exceed the reader bound.", True)
            self.total += len(data)
            self.captured[filename] = self.signature(final)
            return data.decode("utf-8", "strict")
        except UnicodeError:
            reject("I_UTF8", filename, "Authored record is not strict UTF-8.")
        except OSError as error:
            reject("I_READ", filename, "Cannot capture authored record: " + str(error), True)

    def inventory(self, directory, depth=0):
        if depth > 64:
            reject("I_LIMIT", directory, "Directory depth exceeds 64.", True)
        try:
            target, record = self.checked(directory)
        except FileNotFoundError:
            return []
        if not stat.S_ISDIR(record.st_mode):
            reject("I_DIRECTORY", directory, "Expected an authored record directory.")
        result = []
        with os.scandir(target) as entries:
            children = []
            for entry in entries:
                self.entries += 1
                if self.entries > MAX_ENTRIES:
                    reject("I_LIMIT", directory, "Traversal exceeds 10000 entries.", True)
                children.append(entry.name)
        _target, current = self.checked(directory)
        if self.signature(current) != self.signature(record):
            reject("I_CHANGED", directory, "Authored directory changed during traversal.", True)
        self.directories[directory] = self.signature(current)
        for name in sorted(children):
            relative = directory + "/" + name
            item = (target / name).lstat()
            if name.startswith(".atlas-write-") and stat.S_ISREG(item.st_mode):
                continue
            self.relative(relative)
            if stat.S_ISLNK(item.st_mode):
                reject("I_SYMLINK", relative, "Authored records cannot be symlinks.")
            if stat.S_ISDIR(item.st_mode):
                result.extend(self.inventory(relative, depth + 1))
            elif stat.S_ISREG(item.st_mode):
                if not name.endswith(".md"):
                    reject("I_EXTENSION", relative, "Markdown records require .md files.")
                result.append(relative)
            else:
                reject("I_FILE", relative, "Authored records must be regular files.")
        return sorted(result)

    def finish(self):
        for filename, expected in sorted({**self.directories, **self.captured}.items()):
            try:
                _target, actual = self.checked(filename)
                if self.signature(actual) != expected:
                    reject("I_CHANGED", filename, "An authored record changed before reading completed.", True)
            except OSError:
                reject("I_CHANGED", filename, "An authored record disappeared before reading completed.", True)

    def load(self):
        manifest = strict_json(self.read("atlas.json"), "atlas.json")
        exact(manifest, ["format", "id", "title", "trees"], ["format", "id", "title", "trees"], "atlas.json")
        if manifest["format"] != "atlas/1":
            reject("I_FORMAT", "atlas.json", "Only atlas/1 is supported.")
        identifier(manifest["id"], "atlas.json")
        prose(manifest["title"], "atlas.json")
        array(manifest["trees"], "atlas.json")
        directories = []
        for directory in manifest["trees"]:
            self.relative(directory)
            key = directory.casefold()
            if key == "atlas.json" or key == ".checks" or key.startswith(".checks/"):
                reject("I_TREE_PATH", "atlas.json", "Tree directory overlaps a reserved record location.")
            if any(key == prior or key.startswith(prior + "/") or prior.startswith(key + "/") for prior in directories):
                reject("I_TREE_OVERLAP", "atlas.json", "Tree directories overlap.")
            directories.append(key)

        atlas = {"id": manifest["id"], "title": manifest["title"], "trees": [], "points": [], "branches": [], "facets": [], "checks": []}
        trees, points, branches = {}, {}, {}
        for directory in manifest["trees"]:
            filename = directory + "/tree.json"
            tree = strict_json(self.read(filename), filename)
            exact(tree, ["id", "title", "scope", "base", "children"], ["id", "title", "scope", "base", "children"], filename)
            identifier(tree["id"], filename)
            identifier(tree["base"], filename)
            prose(tree["title"], filename)
            prose(tree["scope"], filename)
            array(tree["children"], filename)
            if tree["id"] in trees:
                reject("I_TREE_ID", filename, "Tree identity is not unique.")
            tree = {**tree, "path": filename}
            trees[tree["id"]] = tree
            atlas["trees"].append(tree)
            for kind, folder in [("point", "points"), ("facet", "facets")]:
                for filename in self.inventory(directory + "/" + folder):
                    header, title, body = markdown(self.read(filename), filename)
                    allowed = ["id", "type", "status", "observedAt", "sources", "uncertainty"] if kind == "point" else ["id", "on", "via", "targets", "sources", "uncertainty"]
                    required = ["id"] if kind == "point" else ["id", "on", "via", "targets"]
                    exact(header, allowed, required, filename)
                    identifier(header["id"], filename)
                    references(header, filename)
                    record = {**header, "tree": tree["id"], "path": filename, "title": title, "body": body}
                    if kind == "facet":
                        atlas["facets"].append(record)
                        continue
                    if "type" in header and header["type"] not in ["decision", "observation"]:
                        reject("I_TYPE", filename, "Unsupported Point Type.")
                    if header.get("type") == "decision":
                        if header.get("status") not in ["open", "proposed", "selected", "rejected", "superseded"]:
                            reject("I_DECISION", filename, "A decision requires a supported status.")
                    elif "status" in header:
                        reject("I_DECISION", filename, "Only decisions carry status.")
                    if header.get("type") == "observation":
                        if not observation_date(header.get("observedAt")) or not header.get("sources"):
                            reject("I_OBSERVATION", filename, "Observation date and at least one source are required.")
                    elif "observedAt" in header:
                        reject("I_OBSERVATION", filename, "Only observations carry observedAt.")
                    if header["id"] in points:
                        reject("I_POINT_ID", filename, "Point identity is not Atlas-wide unique.")
                    record["ancestors"] = []
                    points[header["id"]] = record
                    atlas["points"].append(record)

        homes = collections.Counter()
        placement_count = 0

        def place(point_id, tree, ancestry):
            identifier(point_id, tree["path"])
            if point_id not in points:
                reject("I_POINT_MISSING", tree["path"], "Outline references a missing Point.")
            if points[point_id]["tree"] != tree["id"]:
                reject("I_OWNER", tree["path"], "A Point placement belongs to another Tree.")
            homes[point_id] += 1
            if homes[point_id] != 1:
                reject("I_HOME", tree["path"], "A Point has more than one structural home.")
            points[point_id]["ancestors"] = ancestry

        for tree in atlas["trees"]:
            place(tree["base"], tree, [])
            pending = [(node, [{"kind": "point", "id": tree["base"], "tree": tree["id"]}], 0) for node in reversed(tree["children"])]
            while pending:
                node, ancestry, depth = pending.pop()
                placement_count += 1
                if depth > 64 or placement_count > MAX_ENTRIES:
                    reject("I_LIMIT", tree["path"], "Outline exceeds traversal bounds.", True)
                if not isinstance(node, dict) or ("point" in node) == ("branch" in node):
                    reject("I_PLACEMENT", tree["path"], "Placement needs exactly one Point or Branch selector.")
                if "point" in node:
                    exact(node, ["point", "children"], ["point"], tree["path"])
                    place(node["point"], tree, ancestry)
                    kind, node_id = "point", node["point"]
                else:
                    exact(node, ["branch", "title", "children"], ["branch", "title", "children"], tree["path"])
                    identifier(node["branch"], tree["path"])
                    prose(node["title"], tree["path"])
                    array(node["children"], tree["path"], True)
                    kind, node_id = "branch", node["branch"]
                    key = (tree["id"], node_id)
                    if key in branches:
                        reject("I_BRANCH_ID", tree["path"], "Branch identity is not Tree-local unique.")
                    record = {"id": node_id, "tree": tree["id"], "title": node["title"], "children": node["children"], "ancestors": ancestry}
                    branches[key] = record
                    atlas["branches"].append(record)
                children = node.get("children", [])
                array(children, tree["path"])
                descendants = ancestry + [{"kind": kind, "id": node_id, "tree": tree["id"]}]
                pending.extend((child, descendants, depth + 1) for child in reversed(children))
        for point in atlas["points"]:
            if homes[point["id"]] != 1:
                reject("I_HOME", point["path"], "A discovered Point has no structural home.")

        def pointer(value, permitted, filename):
            if not isinstance(value, dict) or len(value) != 1 or next(iter(value)) not in permitted:
                reject("I_POINTER", filename, "Invalid structural pointer.")
            kind, identity = next(iter(value.items()))
            identifier(identity, filename)
            return kind, identity

        def exists(kind, identity, tree_id):
            if kind == "tree":
                return identity == tree_id and identity in trees
            if kind == "point":
                return identity in points and points[identity]["tree"] == tree_id
            return (tree_id, identity) in branches

        facet_ids = set()
        for facet in atlas["facets"]:
            filename = facet["path"]
            key = (facet["tree"], facet["id"])
            if key in facet_ids:
                reject("I_FACET_ID", filename, "Facet identity is not Tree-local unique.")
            facet_ids.add(key)
            identifier(facet["via"], filename)
            if facet["via"] not in trees or facet["via"] == facet["tree"]:
                reject("I_FACET_TREE", filename, "Facet must identify a different existing Tree.")
            kind, identity = pointer(facet["on"], ["point", "branch"], filename)
            if not exists(kind, identity, facet["tree"]):
                reject("I_FACET_HOST", filename, "Facet attachment is outside its owning Tree.")
            array(facet["targets"], filename, True)
            for target in facet["targets"]:
                kind, identity = pointer(target, ["point", "branch", "tree"], filename)
                if not exists(kind, identity, facet["via"]):
                    reject("I_FACET_TARGET", filename, "Facet target does not belong to the via Tree.")

        check_ids = set()
        for filename in self.inventory(".checks"):
            header, title, body = markdown(self.read(filename), filename)
            exact(header, ["id", "status", "level"], ["id", "status", "level"], filename)
            identifier(header["id"], filename)
            if header["id"] in check_ids:
                reject("I_CHECK_ID", filename, "Check identity is not unique.")
            check_ids.add(header["id"])
            if header["status"] not in ["draft", "active", "retired"] or header["level"] not in ["required", "advisory"]:
                reject("I_CHECK", filename, "Unsupported Check status or level.")
            sections = [item["title"] for item in headings(body.split("\n")) if item["level"] == 2]
            if (any(sections.count(name) != 1 for name in ["Requirement", "Verification", "Failure"])
                    or sections.count("Exceptions") > 1 or set(sections) - {"Requirement", "Verification", "Failure", "Exceptions"}):
                reject("I_CHECK_SECTIONS", filename, "Check requires its named H2 sections exactly once.")
            atlas["checks"].append({**header, "title": title, "body": body, "path": filename})

        self.finish()
        for kind in ["points", "branches", "facets", "checks"]:
            atlas[kind].sort(key=lambda item: (item.get("tree", ""), item["id"]))
        return atlas


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"status": "invalid", "diagnostics": [{"code": "I_USAGE", "path": "", "message": "Usage: independent-reader.py ROOT"}]}))
        return 2
    try:
        result = Reader(sys.argv[1]).load()
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0
    except Rejected as error:
        print(json.dumps({"status": "incomplete" if error.incomplete else "invalid", "diagnostics": [error.diagnostic]}, ensure_ascii=True))
        return 1
    except OSError as error:
        print(json.dumps({"status": "incomplete", "diagnostics": [{"code": "I_READ", "path": "", "message": str(error)}]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
