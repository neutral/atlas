#!/usr/bin/env python3
"""A separately written reader of the Atlas format, using only Python's standard library.

Authority: spec/spec/FORMAT.md and spec/SPEC.md. Each rule below
names the section of FORMAT.md it follows. No Library code is imported or
executed here. Its JSON and Markdown helpers began in an earlier reader whose
author had seen Library code, and its later authors have read the Library too,
so agreement between the two readers shows that the contract states enough to
reach the same results; it does not show that the two were written apart.

FORMAT.md defines Markdown by CommonMark and remote source URIs by the WHATWG
URL Standard. This reader approximates both: headings, inline text content and
explanations by line rules and regular expressions, URLs by urllib. A file that
depends on a CommonMark or WHATWG detail the approximation lacks can be read
differently here; the committed cases stay within what it covers.

It prints one view as JSON (FORMAT, Normalized view). It captures every file
the contract names, then validates the captured files and stops at the first
broken rule, which FORMAT, Diagnostics and status allows.
"""

import base64
import collections
import decimal
import errno
import hashlib
import html.entities
import json
import math
import os
import re
import stat
import sys
import unicodedata
import urllib.parse


# FORMAT, Bounds.
MAX_FILE = 2 * 1024 * 1024
MAX_FILES = 10000
MAX_TOTAL = 64 * 1024 * 1024
MAX_DEPTH = 64
MAX_TRAVERSAL = 4 * MAX_FILES
# FORMAT, Text and JSON; Atlas manifest; Tree and outline.
MAX_TEXT = 4 * 1024 * 1024
MAX_JSON_DEPTH = 128
MAX_JSON_VALUES = 100000
MAX_ENTRIES = 10000
MAX_INTEGER = 2 ** 53 - 1
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,99}\Z")
FORMAT = "atlas/1.2"
WHITE = "\t\n\x0b\x0c\r   " + "".join(map(chr, range(0x2000, 0x200B))) + "    　﻿"
MANIFEST = ["format", "id", "title", "trees"]
TREE = ["id", "title", "scope", "base", "children"]
POINT = ["id", "type", "status", "observedAt", "sources", "uncertainty"]
FACET = ["id", "on", "via", "targets", "sources", "uncertainty"]
CHECK = ["id", "status", "level"]
SOURCE = ["uri", "title", "role", "revision", "locator", "sha256"]
ROLES = ["evidence", "background", "example", "implementation", "history"]
DECISION = ["open", "proposed", "selected", "rejected", "superseded"]
TYPES = ["decision", "observation"]
CHECK_STATUS = ["draft", "active", "retired"]
CHECK_LEVEL = ["required", "advisory"]
CHECK_SECTIONS = ["Requirement", "Verification", "Failure"]
CHECK_OPTIONAL = "Exceptions"
RESERVED_TREE = ["atlas.json", "style.md", ".checks"]
# FORMAT, Diagnostics and status: these, and a platform's error name, make a view incomplete.
INCOMPLETE = {"READ_LIMIT", "READ_CHANGED", "READ_DENIED", "READ_ERROR"} | set(errno.errorcode.values())


class Broken(Exception):
    def __init__(self, code, path, message):
        super().__init__(message)
        self.diagnostic = {"code": code, "path": path, "message": message}


def broken(code, path, message):
    raise Broken(code, path, message)


# FORMAT, Text and JSON: comparison, white space, lowercasing.
def order(text):
    return text.encode("utf-16-be", "surrogatepass")


def units(text):
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def trim(text):
    return text.strip(WHITE)


def nonblank(value):
    return isinstance(value, str) and trim(value) != ""


def folded(text):
    return unicodedata.normalize("NFC", text).lower()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(text, path):
    """FORMAT, Text and JSON."""
    if text is None:
        broken("JSON_SYNTAX", path, "JSON input must be text.")
    if units(text) > MAX_TEXT:
        broken("JSON_LIMIT", path, "JSON input exceeds the text limit.")

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                broken("JSON_DUPLICATE_KEY", path, "Duplicate decoded JSON key.")
            result[key] = value
        return result

    def integer(token):
        digits = token.lstrip("-").lstrip("0")
        if len(digits) > 16 or abs(int(token)) > MAX_INTEGER:
            broken("JSON_NUMBER", path, "Integer is outside the safe range.")
        return int(token)

    def fraction(token):
        converted = float(decimal.Decimal(token))
        if not math.isfinite(converted) or (converted.is_integer() and abs(converted) > MAX_INTEGER):
            broken("JSON_NUMBER", path, "JSON numbers must be finite and integers must be safe.")
        return converted

    def constant(_token):
        broken("JSON_SYNTAX", path, "NaN and Infinity are not JSON values.")

    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_int=integer,
                           parse_float=fraction, parse_constant=constant)
    except Broken:
        raise
    except RecursionError:
        broken("JSON_LIMIT", path, "JSON input exceeds the nesting limit.")
    except json.JSONDecodeError as error:
        broken("JSON_UNICODE" if "uXXXX" in error.msg else "JSON_SYNTAX", path, "Malformed JSON: " + error.msg + ".")
    except (ValueError, decimal.InvalidOperation, OverflowError):
        broken("JSON_SYNTAX", path, "Malformed JSON.")

    def surrogate(item):
        if any(0xD800 <= ord(character) <= 0xDFFF for character in item):
            broken("JSON_UNICODE", path, "Unpaired Unicode surrogate.")

    count, pending = 0, [(value, 0)]
    while pending:
        item, depth = pending.pop()
        count += 1
        if count > MAX_JSON_VALUES:
            broken("JSON_LIMIT", path, "JSON input exceeds the value limit.")
        if isinstance(item, str):
            surrogate(item)
        elif isinstance(item, (dict, list)):
            if depth >= MAX_JSON_DEPTH:
                broken("JSON_LIMIT", path, "JSON input exceeds the nesting limit.")
            if isinstance(item, dict):
                for key in item:
                    surrogate(key)
            pending.extend((member, depth + 1) for member in (item.values() if isinstance(item, dict) else item))
    return value


# FORMAT, Markdown records, Text content. An approximation of CommonMark inline parsing.
ASCII_PUNCTUATION = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
ENTITY = re.compile(r"&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{0,31}));")
AUTOLINK = re.compile(r"<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\x00-\x20<>]*)>")
EMAIL = re.compile(r"<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>")
COMMENT = re.compile(r"<!--.*?-->", re.S)
TAG = re.compile(r"</?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s\"'=<>`]+|'[^']*'|\"[^\"]*\"))?)*\s*/?>")


def punctuation(character):
    return character in ASCII_PUNCTUATION or unicodedata.category(character)[0] in "PS"


def space(character):
    return character in "\t\n\x0b\x0c\r " or unicodedata.category(character) == "Zs"


def reference(match):
    if match[1] or match[2]:
        code = int(match[1], 16) if match[1] else int(match[2])
        return "�" if code == 0 or code > 0x10FFFF or 0xD800 <= code <= 0xDFFF else chr(code)
    return html.entities.html5.get(match[3] + ";")


def link_at(text, start):
    """An inline link or image body at text[start] == '[': (text, end) or None."""
    depth, index = 0, start
    while index < len(text):
        character = text[index]
        if character == "\\":
            index += 2
            continue
        if character == "[":
            depth += 1
        elif character == "]":
            depth -= 1
            if depth == 0:
                break
        index += 1
    else:
        return None
    if not text.startswith("(", index + 1):
        return None
    inner, depth, cursor = text[start + 1:index], 0, index + 1
    while cursor < len(text):
        character = text[cursor]
        if character == "\\":
            cursor += 2
            continue
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return inner, cursor + 1
        cursor += 1
    return None


class Delimiter:
    def __init__(self, character, count, can_open, can_close):
        self.character, self.count, self.original = character, count, count
        self.can_open, self.can_close = can_open, can_close


def emphasis(stack):
    """CommonMark's process emphasis: matched delimiters are removed, the rest stay as text."""
    index = 0
    while index < len(stack):
        closer = stack[index]
        if not closer.can_close:
            index += 1
            continue
        position = index - 1
        while position >= 0:
            opener = stack[position]
            if opener.character == closer.character and opener.can_open:
                odd = ((opener.can_close or closer.can_open) and (opener.original + closer.original) % 3 == 0
                       and not (opener.original % 3 == 0 and closer.original % 3 == 0))
                if not odd:
                    break
            position -= 1
        if position < 0:
            if closer.can_open:
                index += 1
            else:
                del stack[index]
            continue
        opener = stack[position]
        used = 2 if opener.count >= 2 and closer.count >= 2 else 1
        opener.count -= used
        closer.count -= used
        del stack[position + 1:index]
        index = position + 1
        if opener.count == 0:
            del stack[position]
            index -= 1
        if closer.count == 0:
            del stack[index]


def inline_text(text):
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    nodes, buffer, delimiters = [], [], []

    def flush():
        if buffer:
            nodes.append("".join(buffer))
            buffer.clear()

    index, length = 0, len(text)
    while index < length:
        character = text[index]
        if character == "\\" and index + 1 < length and (text[index + 1] == "\n" or text[index + 1] in ASCII_PUNCTUATION):
            buffer.append(" " if text[index + 1] == "\n" else text[index + 1])
            index += 2
            continue
        if character == "\n":
            buffer.append(" ")
            index += 1
            continue
        if character == "`":
            run = len(re.match(r"`+", text[index:])[0])
            closing = re.compile(r"(?<!`)" + "`" * run + r"(?!`)").search(text, index + run)
            if closing:
                content = text[index + run:closing.start()].replace("\n", " ")
                if len(content) >= 2 and content[0] == " " and content[-1] == " " and content.strip(" "):
                    content = content[1:-1]
                buffer.append(content)
                index = closing.end()
            else:
                buffer.append("`" * run)
                index += run
            continue
        if character == "&":
            match = ENTITY.match(text, index)
            decoded = reference(match) if match else None
            if decoded is not None:
                buffer.append(decoded)
                index = match.end()
                continue
        if character == "<":
            match = AUTOLINK.match(text, index) or EMAIL.match(text, index)
            if match:
                buffer.append(match[1])
                index = match.end()
                continue
            match = COMMENT.match(text, index) or TAG.match(text, index)
            if match:
                index = match.end()
                continue
        if character in "![" and (character == "[" or text.startswith("[", index + 1)):
            found = link_at(text, index + (character == "!"))
            if found:
                buffer.append(inline_text(found[0]))
                index = found[1]
                continue
        if character in "*_":
            run = len(re.match(re.escape(character) + "+", text[index:])[0])
            before = text[index - 1] if index > 0 else "\n"
            after = text[index + run] if index + run < length else "\n"
            left = not space(after) and (not punctuation(after) or space(before) or punctuation(before))
            right = not space(before) and (not punctuation(before) or space(after) or punctuation(after))
            if character == "*":
                delimiter = Delimiter(character, run, left, right)
            else:
                delimiter = Delimiter(character, run, left and (not right or punctuation(before)), right and (not left or punctuation(after)))
            flush()
            nodes.append(delimiter)
            delimiters.append(delimiter)
            index += run
            continue
        buffer.append(character)
        index += 1
    flush()
    emphasis(delimiters)
    return "".join(node if isinstance(node, str) else node.character * node.count for node in nodes)


# FORMAT, Markdown records: headings, by line rules.
FENCE = re.compile(r"(`{3,}|~{3,})(.*)\Z")
ATX = re.compile(r"(#{1,6})(?:[ \t]+(.*))?\Z")
SETEXT = re.compile(r"(=+|-+)[ \t]*\Z")
THEMATIC = re.compile(r"(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})\Z")
CONTAINER = re.compile(r" {0,3}(?:>[ ]?|[-+*](?:[ \t]+|\Z)|[0-9]{1,9}[.)](?:[ \t]+|\Z))")
DEFINITION = re.compile(r"\[[^\]]+\]:[ \t]*\S")


def headings(lines):
    """Top-level ATX and Setext headings outside fenced and indented code (FORMAT, Markdown records, Title)."""
    found, paragraph = [], []
    fence_character, fence_length = None, 0
    for index, line in enumerate(lines):
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)
        if fence_character:
            if indent <= 3 and re.fullmatch(re.escape(fence_character) + "{" + str(fence_length) + r",}[ \t]*", stripped):
                fence_character = None
            continue
        fence = FENCE.match(stripped) if indent <= 3 else None
        if fence and not (fence[1][0] == "`" and "`" in fence[2]):
            fence_character, fence_length = fence[1][0], len(fence[1])
            paragraph = []
            continue
        atx = ATX.match(stripped) if indent <= 3 else None
        if atx:
            source = re.sub(r"(?:^|[ \t]+)#+[ \t]*$", "", atx[2] or "")
            found.append({"level": len(atx[1]), "title": trim(inline_text(source)), "start": index, "end": index})
            paragraph = []
            continue
        underline = SETEXT.match(stripped) if indent <= 3 else None
        if underline and paragraph:
            source = "\n".join(lines[number] for number in paragraph)
            found.append({"level": 1 if underline[1][0] == "=" else 2, "title": trim(inline_text(source)),
                          "start": paragraph[0], "end": index})
            paragraph = []
            continue
        block = re.match(r"(?:>|[-+*][ \t]|[0-9]+[.)][ \t])", stripped)
        if not line.strip() or indent >= 4 or line.startswith("\t") or block or THEMATIC.match(stripped):
            paragraph = []
        else:
            paragraph.append(index)
    return found


def explains(lines):
    """FORMAT, Markdown records, Explanation: a letter or digit (L or N) outside headings and markup."""
    kept, paragraph = [], []
    fence_character, fence_length = None, 0
    for line in lines:
        inner = line
        while not THEMATIC.match(inner.strip()):
            match = CONTAINER.match(inner)
            if not match or not match[0]:
                break
            inner = inner[match.end():]
        stripped = inner.lstrip(" ")
        indent = len(inner) - len(stripped)
        if fence_character:
            if indent <= 3 and re.fullmatch(re.escape(fence_character) + "{" + str(fence_length) + r",}[ \t]*", stripped):
                fence_character = None
            else:
                kept.append(inner)
            continue
        fence = FENCE.match(stripped) if indent <= 3 else None
        if fence and not (fence[1][0] == "`" and "`" in fence[2]):
            fence_character, fence_length = fence[1][0], len(fence[1])
            paragraph = []
            continue
        if indent <= 3 and ATX.match(stripped):
            paragraph = []
            continue
        if indent <= 3 and paragraph and SETEXT.match(stripped):
            del kept[paragraph[0]:]
            paragraph = []
            continue
        if not paragraph and indent <= 3 and DEFINITION.match(stripped):
            continue
        if not stripped.strip() or (indent <= 3 and THEMATIC.match(stripped)):
            paragraph = []
            continue
        if indent < 4 or paragraph:
            paragraph.append(len(kept))
        kept.append(inner)
    text = inline_text("\n".join(kept))
    return any(unicodedata.category(character)[0] in "LN" for character in text)


def markdown(text, path, header=True):
    """FORMAT, Markdown records; checks in the order FORMAT, Diagnostics and status gives."""
    if text is None:
        broken("MARKDOWN_HEADER", path, "Markdown input must be text.")
    if units(text) > MAX_TEXT:
        broken("JSON_LIMIT", path, "Markdown input exceeds the text limit.")
    if re.search(r"\r(?!\n)", text):  # FORMAT, Text and JSON, Line endings
        broken("MARKDOWN_LINE_ENDING", path, "A CR not followed by LF is not allowed.")
    lines = text.replace("\r\n", "\n").split("\n")
    value = None
    if header:
        if lines[0] != "---":
            broken("MARKDOWN_HEADER", path, "Missing exact opening delimiter.")
        try:
            end = lines.index("---", 1)
        except ValueError:
            broken("MARKDOWN_HEADER", path, "Missing exact closing delimiter.")
        value = strict_json("\n".join(lines[1:end]), path)
        if not isinstance(value, dict):
            broken("MARKDOWN_HEADER", path, "Markdown header must be an object.")
        content = lines[end + 1:]
    else:
        if lines[0] == "---":  # FORMAT, Markdown records, Header: the Style has no header
            broken("MARKDOWN_HEADER", path, "A Style does not begin with a --- line.")
        content = lines
    titles = headings(content)
    if not titles or titles[0]["level"] != 1 or not titles[0]["title"]:
        broken("MARKDOWN_TITLE", path, "The first Markdown heading must be a nonblank H1.")
    if sum(item["level"] == 1 for item in titles) != 1:
        broken("MARKDOWN_TITLE", path, "Expected exactly one H1 title.")
    title = titles[0]
    body = trim("\n".join(content[:title["start"]] + content[title["end"] + 1:]))
    if not body or not explains(body.split("\n")):
        broken("MARKDOWN_BODY", path, "The record needs an explanation.")
    return value, title["title"], body


def source_issue(source):
    """FORMAT, Source reference. Remote URIs are checked with urllib, not a WHATWG parser."""
    if not isinstance(source, dict):
        return "A source must be an object."
    if set(source) - set(SOURCE):
        return "A source has an unknown field."
    uri = source.get("uri")
    if not nonblank(uri) or re.search(r"[\x00-\x20\x7f\\]", uri):
        return "A source URI must be nonblank, with no spaces, controls or backslashes."
    for field in ["title", "revision", "locator"]:
        if field in source and not nonblank(source[field]):
            return "Source " + field + " must be nonblank text."
    if "role" in source and source["role"] not in ROLES:
        return "Unknown source role."
    if "sha256" in source and (not isinstance(source["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", source["sha256"])):
        return "Invalid source stamp."
    if re.match(r"https?://", uri, re.I):
        try:
            parsed = urllib.parse.urlsplit(uri)
            if not parsed.hostname or parsed.username or parsed.password:
                return "HTTP(S) sources need a host and no credentials."
            parsed.port
        except ValueError:
            return "Malformed HTTP(S) source."
        return None
    if re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", uri) or uri.startswith("/") or "?" in uri:
        return "Expected HTTP(S) or an Atlas-root-relative source path."
    local = uri.split("#", 1)[0]
    if not local:
        return "A local source URI must identify a path."
    if re.search(r"%(?![0-9a-fA-F]{2})", local):
        return "Malformed percent encoding."
    try:
        decoded = urllib.parse.unquote_to_bytes(local).decode("utf-8", "strict")
    except UnicodeError:
        return "Percent encoding is not UTF-8."
    if decoded.startswith("/") or re.match(r"[A-Za-z]:", decoded) or re.search(r"[\\\x00-\x1f\x7f]", decoded):
        return "Unsafe local source path."
    if re.search(r"%(?:2f|5c)", local, re.I):
        return "Encoded path separators are not allowed."
    return None


def valid_date(value):
    """FORMAT, Point: the date profile."""
    if not isinstance(value, str):
        return False
    match = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2}))?", value)
    if not match:
        return False
    year, month, day = map(int, match.group(1, 2, 3))
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if not 1 <= month <= 12 or not 1 <= day <= days[month - 1]:
        return False
    if match[4] is not None and (int(match[4]) > 23 or int(match[5]) > 59 or int(match[6]) > 59):
        return False
    zone = match[7]
    return not zone or zone == "Z" or (int(zone[1:3]) <= 23 and int(zone[4:6]) <= 59)


def record_path(value):
    """FORMAT, Record paths."""
    return (isinstance(value, str) and 0 < units(value) <= 4096 and unicodedata.normalize("NFC", value) == value
            and not value.startswith("/") and not re.search(r"[\\\x00-\x1f\x7f:#?]", value)
            and all(part not in ("", ".", "..") and not folded(part).startswith(".atlas-") for part in value.split("/")))


def reserved_tree(directory):
    """FORMAT, Atlas manifest: a Tree directory is not, and is not inside, another record location."""
    key = folded(directory)
    return any(key == reserved or key.startswith(reserved + "/") for reserved in RESERVED_TREE)


def signature(record):
    return (record.st_dev, record.st_ino, record.st_mode, record.st_size, record.st_mtime_ns, record.st_ctime_ns)


class Capture:
    """FORMAT, Capture, Bounds and Changes during capture."""

    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.files = collections.OrderedDict()
        self.observed = collections.OrderedDict()
        self.diagnostics = []
        self.total = 0
        self.traversed = 0

    def add(self, code, path, message):
        self.diagnostics.append({"code": code, "path": path, "message": message})

    def located(self, relative):
        """No component is a symbolic link, and each is spelled as its directory holds it."""
        current = self.root
        if stat.S_ISLNK(os.lstat(current).st_mode):
            broken("PATH_SYMLINK", relative, "Symbolic links are not accepted for this read.")
        parts = [part for part in relative.split("/") if part]
        for part in parts:
            current = os.path.join(current, part)
            if stat.S_ISLNK(os.lstat(current).st_mode):
                broken("PATH_SYMLINK", relative, "Symbolic links are not accepted for this read.")
        current = self.root
        for part in parts:
            if part not in os.listdir(current):
                broken("PATH_ALIAS", relative, "Path case or Unicode spelling does not match the filesystem.")
            current = os.path.join(current, part)
        return current

    @staticmethod
    def failure(error):
        if isinstance(error, FileNotFoundError):
            return "FILE_MISSING"
        if error.errno in (errno.EACCES, errno.EPERM):
            return "READ_DENIED"
        return errno.errorcode.get(error.errno, "READ_ERROR")

    def read(self, relative, bound):
        target = self.located(relative)
        real = os.path.realpath(target)
        expected = os.lstat(target)
        if not stat.S_ISREG(expected.st_mode):
            broken("FILE_KIND", relative, "Expected a regular file.")
        if expected.st_size > bound:
            broken("READ_LIMIT", relative, "File exceeds %d bytes." % bound)
        descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as handle:
            before = os.fstat(handle.fileno())
            if signature(before) != signature(expected):
                broken("READ_CHANGED", relative, "File changed before capture.")
            data = handle.read(bound + 1)
            after = os.fstat(handle.fileno())
        if len(data) > bound:
            broken("READ_LIMIT", relative, "File exceeds %d bytes." % bound)
        self.located(relative)
        final = os.lstat(target)
        if signature(before) != signature(after) or signature(after) != signature(final) or os.path.realpath(target) != real:
            broken("READ_CHANGED", relative, "File changed during capture.")
        return data, signature(final)

    def take(self, relative, optional=False):
        if relative in self.files:
            return
        if len(self.files) >= MAX_FILES:
            self.add("READ_LIMIT", relative, "Authored file count exceeds %d." % MAX_FILES)
            return
        if self.total >= MAX_TOTAL:
            self.add("READ_LIMIT", relative, "Captured content exceeds %d bytes." % MAX_TOTAL)
            return
        try:
            data, observed = self.read(relative, min(MAX_FILE, MAX_TOTAL - self.total))
        except Broken as error:
            self.diagnostics.append(error.diagnostic)
            return
        except OSError as error:
            if not (optional and isinstance(error, FileNotFoundError)):
                self.add(self.failure(error), relative, str(error))
            return
        self.total += len(data)
        self.files[relative] = data
        self.observed[relative] = observed

    def directory(self, relative, optional=False, depth=0):
        if depth > MAX_DEPTH:
            self.add("READ_LIMIT", relative, "Directory depth exceeds %d." % MAX_DEPTH)
            return
        try:
            target = self.located(relative)
            before = os.lstat(target)
            if not stat.S_ISDIR(before.st_mode):
                self.add("FILE_KIND", relative, "Expected an authored record directory.")
                return
            self.observed[relative + "/"] = signature(before)
            entries = []
            with os.scandir(target) as listing:
                for entry in listing:
                    self.traversed += 1
                    if self.traversed > MAX_TRAVERSAL:
                        self.add("READ_LIMIT", relative, "Authored directory traversal exceeds its entry bound.")
                        break
                    entries.append(entry)
            for entry in sorted(entries, key=lambda item: order(item.name)):
                if entry.is_file(follow_symlinks=False) and entry.name.startswith(".atlas-write-"):
                    continue
                child = relative + "/" + entry.name
                if not record_path(child):
                    self.add("PATH_UNSAFE", child, "Unsafe authored record path.")
                elif entry.is_symlink():
                    self.add("PATH_SYMLINK", child, "Symbolic links are not accepted for authored records.")
                elif entry.is_dir(follow_symlinks=False):
                    self.directory(child, False, depth + 1)
                else:
                    self.take(child)
        except Broken as error:
            self.diagnostics.append(error.diagnostic)
        except OSError as error:
            if not (optional and isinstance(error, FileNotFoundError)):
                self.add("FILE_MISSING" if isinstance(error, FileNotFoundError) else errno.errorcode.get(error.errno, "READ_ERROR"), relative, str(error))

    def run(self):
        self.take("atlas.json")
        manifest = None
        text = decoded(self.files.get("atlas.json"))
        if text is not None:
            try:
                manifest = strict_json(text, "atlas.json")
            except Broken:
                manifest = None
            self.take("style.md", optional=True)
        if isinstance(manifest, dict) and isinstance(manifest.get("trees"), list) and len(manifest["trees"]) <= MAX_ENTRIES:
            seen = set()
            for folder in manifest["trees"]:
                if not record_path(folder) or reserved_tree(folder) or folder in seen:
                    continue
                seen.add(folder)
                self.take(folder + "/tree.json")
                self.directory(folder + "/points", True)
                self.directory(folder + "/facets", True)
        self.directory(".checks", True)
        for relative, before in self.observed.items():
            try:
                if signature(os.lstat(self.located(relative.rstrip("/")))) != before:
                    self.add("READ_CHANGED", relative, "Authored content changed during this reading observation.")
            except (Broken, OSError):
                self.add("READ_CHANGED", relative, "Authored content disappeared or changed during this reading observation.")
        return self


def decoded(data):
    if data is None:
        return None
    try:
        return data.decode("utf-8", "strict")
    except UnicodeError:
        return None


class Validation:
    """Every rule of FORMAT.md over the captured files, stopping at the first that is broken."""

    def __init__(self, text):
        self.text = text
        self.recognized = {"atlas.json", "style.md"}

    @staticmethod
    def fields(record, allowed, required, path):
        if not isinstance(record, dict):
            broken("RECORD_OBJECT", path, "Expected an object.")
        for key in record:
            if key not in allowed:
                broken("FIELD_UNKNOWN", path, "Unknown field: " + key + ".")
        for key in required:
            if key not in record:
                broken("FIELD_REQUIRED", path, "Missing field: " + key + ".")

    @staticmethod
    def identifier(value, path, field="id"):
        if not isinstance(value, str) or not ID.match(value):
            broken("ID_INVALID", path, field + " must be a lowercase ID of at most 100 characters.")

    @staticmethod
    def prose(value, path, field):
        if not nonblank(value):
            broken("TEXT_REQUIRED", path, field + " must be nonblank text.")

    @staticmethod
    def array(value, path, field, nonempty=False):
        if not isinstance(value, list) or len(value) > MAX_ENTRIES or (nonempty and not value):
            broken("ARRAY_INVALID", path, field + " must be an array of the required size.")

    def parse(self, path, header=None):
        if path not in self.text:
            broken("FILE_MISSING", path, "Required authored file is missing.")
        return strict_json(self.text[path], path) if header is None else markdown(self.text[path], path, header)

    def references(self, header, path):
        if "uncertainty" in header:
            self.prose(header["uncertainty"], path, "uncertainty")
        if "sources" in header:
            self.array(header["sources"], path, "sources")
            for source in header["sources"]:
                issue = source_issue(source)
                if issue:
                    broken("SOURCE_INVALID", path, issue)

    def run(self):
        # FORMAT, Atlas manifest.
        manifest = self.parse("atlas.json")
        if not isinstance(manifest, dict):
            broken("RECORD_OBJECT", "atlas.json", "The manifest must be a JSON object.")
        self.fields(manifest, MANIFEST, MANIFEST, "atlas.json")
        if manifest["format"] != FORMAT:
            broken("FORMAT_UNSUPPORTED", "atlas.json", "The supported format is atlas/1.2.")
        self.identifier(manifest["id"], "atlas.json")
        self.prose(manifest["title"], "atlas.json", "title")
        self.array(manifest["trees"], "atlas.json", "trees")
        # FORMAT, Style.
        style = None
        if "style.md" not in self.text or (self.text["style.md"] is not None and not trim(self.text["style.md"])):
            broken("STYLE_REQUIRED", "style.md", "An Atlas keeps its Style in style.md.")
        if self.text["style.md"] is not None:
            _none, title, body = markdown(self.text["style.md"], "style.md", header=False)
            style = {"title": title, "body": body, "path": "style.md"}
        atlas = {"format": manifest["format"], "id": manifest["id"], "title": manifest["title"], "style": style,
                 "trees": [], "points": [], "facets": [], "checks": []}
        directories = []
        for directory in manifest["trees"]:
            if not record_path(directory) or reserved_tree(directory):
                broken("TREE_PATH", "atlas.json", "Tree folders must be record paths outside reserved locations.")
            key = folded(directory)
            if any(key == folded(prior) or key.startswith(folded(prior) + "/") or folded(prior).startswith(key + "/") for prior in directories):
                broken("TREE_OVERLAP", "atlas.json", "Tree directories overlap or alias: " + directory + ".")
            directories.append(directory)

        # FORMAT, Tree and outline; Point; Facet.
        trees, points = {}, {}
        paths = sorted(self.text, key=order)
        for directory in directories:
            filename = directory + "/tree.json"
            self.recognized.add(filename)
            tree = self.parse(filename)
            self.fields(tree, TREE, TREE, filename)
            self.identifier(tree["id"], filename)
            self.identifier(tree["base"], filename, "base")
            self.prose(tree["title"], filename, "title")
            self.prose(tree["scope"], filename, "scope")
            self.array(tree["children"], filename, "children")
            if tree["id"] in trees:
                broken("TREE_DUPLICATE", filename, "Duplicate Tree ID: " + tree["id"] + ".")
            tree = {**tree, "path": filename}
            trees[tree["id"]] = tree
            atlas["trees"].append(tree)
            for path in paths:
                kind = "point" if path.startswith(directory + "/points/") else "facet" if path.startswith(directory + "/facets/") else None
                if not kind:
                    continue
                self.recognized.add(path)
                if not path.endswith(".md"):
                    broken("RECORD_EXTENSION", path, "Point and Facet records use .md files.")
                header, title, body = self.parse(path, True)
                if kind == "point":
                    self.fields(header, POINT, ["id"], path)
                else:
                    self.fields(header, FACET, ["id", "on", "via", "targets"], path)
                self.identifier(header["id"], path)
                self.references(header, path)
                record = {**header, "tree": tree["id"], "path": path, "title": title, "body": body}
                if kind == "facet":
                    atlas["facets"].append(record)
                    continue
                if "type" in header and header["type"] not in TYPES:
                    broken("TYPE_UNSUPPORTED", path, "Supported Point Types are decision and observation.")
                if header.get("type") == "decision":
                    if header.get("status") not in DECISION:
                        broken("DECISION_STATUS", path, "A decision requires a supported status.")
                elif "status" in header:
                    broken("STATUS_TYPE", path, "Only a decision may have status.")
                if header.get("type") == "observation":
                    if not valid_date(header.get("observedAt")):
                        broken("OBSERVATION_DATE", path, "An observation requires a valid date.")
                    if not isinstance(header.get("sources"), list) or not header["sources"]:
                        broken("OBSERVATION_SOURCE", path, "An observation requires at least one source.")
                elif "observedAt" in header:
                    broken("DATE_TYPE", path, "Only an observation may have observedAt.")
                if header["id"] in points:
                    broken("POINT_DUPLICATE", path, "Duplicate Point ID: " + header["id"] + ".")
                record["ancestors"] = []
                points[header["id"]] = record
                atlas["points"].append(record)

        homes = collections.Counter()
        placements = 0

        def place(point_id, tree, ancestry):
            if point_id not in points:
                broken("POINT_MISSING", tree["path"], "Point does not exist: " + point_id + ".")
            if points[point_id]["tree"] != tree["id"]:
                broken("POINT_OWNER", tree["path"], "Point " + point_id + " belongs to another Tree.")
            homes[point_id] += 1
            if homes[point_id] > 1:
                broken("POINT_MULTIPLE_HOME", tree["path"], "Point " + point_id + " has more than one structural home.")
            points[point_id]["ancestors"] = ancestry

        for tree in atlas["trees"]:
            place(tree["base"], tree, [])
            pending = [(node, [{"id": tree["base"], "tree": tree["id"]}]) for node in reversed(tree["children"])]
            while pending:
                node, ancestry = pending.pop()
                placements += 1
                if placements > MAX_ENTRIES:
                    broken("OUTLINE_LIMIT", tree["path"], "Atlas outline exceeds %d placements." % MAX_ENTRIES)
                self.fields(node, ["point", "children"], ["point"], tree["path"])
                self.identifier(node["point"], tree["path"], "point")
                place(node["point"], tree, ancestry)
                if "children" in node:
                    self.array(node["children"], tree["path"], "children")
                    descendants = ancestry + [{"id": node["point"], "tree": tree["id"]}]
                    pending.extend((child, descendants) for child in reversed(node["children"]))
        for point in atlas["points"]:
            if not homes[point["id"]]:
                broken("POINT_UNPLACED", point["path"], "Point " + point["id"] + " has no structural home in its owning Tree.")

        facet_ids = set()
        for facet in atlas["facets"]:
            path = facet["path"]
            if (facet["tree"], facet["id"]) in facet_ids:
                broken("FACET_DUPLICATE", path, "Duplicate Facet ID: " + facet["id"] + ".")
            facet_ids.add((facet["tree"], facet["id"]))
            self.identifier(facet["via"], path, "via")
            if facet["via"] not in trees:
                broken("FACET_TREE", path, "Facet Tree does not exist.")
            if facet["via"] == facet["tree"]:
                broken("FACET_SELF", path, "A Facet interprets through a different Tree.")
            self.identifier(facet["on"], path, "on")
            if facet["on"] not in points or points[facet["on"]]["tree"] != facet["tree"]:
                broken("FACET_HOST", path, "A Facet attaches to a Point of its owning Tree.")
            self.array(facet["targets"], path, "targets", True)
            seen = set()
            for target in facet["targets"]:
                self.identifier(target, path, "target")
                if target in seen:
                    broken("TARGET_DUPLICATE", path, "Duplicate Facet target: " + target + ".")
                seen.add(target)
                if target not in points or points[target]["tree"] != facet["via"]:
                    broken("FACET_TARGET", path, "Every Facet target is a Point of its via Tree.")

        # FORMAT, Check.
        check_ids = set()
        for path in paths:
            if not path.startswith(".checks/"):
                continue
            self.recognized.add(path)
            if not path.endswith(".md"):
                broken("RECORD_EXTENSION", path, "Check records use .md files.")
            header, title, body = self.parse(path, True)
            self.fields(header, CHECK, CHECK, path)
            self.identifier(header["id"], path)
            if header["id"] in check_ids:
                broken("CHECK_DUPLICATE", path, "Duplicate Check ID: " + header["id"] + ".")
            check_ids.add(header["id"])
            if header["status"] not in CHECK_STATUS:
                broken("CHECK_STATUS", path, "Unsupported Check status.")
            if header["level"] not in CHECK_LEVEL:
                broken("CHECK_LEVEL", path, "Unsupported Check level.")
            lines = body.split("\n")
            found = [item for item in headings(lines) if item["level"] == 2]
            expected = CHECK_SECTIONS + ([CHECK_OPTIONAL] if len(found) == 4 else [])
            if [item["title"] for item in found] != expected:
                broken("CHECK_SECTION", path, "Check sections must be Requirement, Verification, Failure, and optional Exceptions, in that order.")
            for index, item in enumerate(found):
                end = found[index + 1]["start"] if index + 1 < len(found) else len(lines)
                if item["title"] in CHECK_SECTIONS and not explains(lines[item["end"] + 1:end]):
                    broken("CHECK_SECTION", path, "The " + item["title"] + " section requires explanatory content.")
            data = self.text[path].encode("utf-8")
            atlas["checks"].append({**header, "path": path, "title": title, "body": body, "revision": sha256(data)})

        for path in self.text:
            if path not in self.recognized:
                broken("RECORD_UNEXPECTED", path, "This file is outside the authored record inventory.")
        return atlas


def read(root):
    capture = Capture(root).run()
    diagnostics = list(capture.diagnostics)
    # FORMAT, Record paths (aliases among captured paths) and Text and JSON (encoding).
    aliases, accepted = {}, collections.OrderedDict()
    for path, data in capture.files.items():
        parts, alias = path.split("/"), False
        for length in range(1, len(parts) + 1):
            prefix = "/".join(parts[:length])
            key = folded(prefix)
            if key in aliases and aliases[key] != prefix:
                diagnostics.append({"code": "PATH_ALIAS", "path": path, "message": "Authored path component aliases " + aliases[key] + "."})
                alias = True
                break
            aliases[key] = prefix
        if alias:
            continue
        accepted[path] = data
        if decoded(data) is None:
            diagnostics.append({"code": "FILE_UTF8", "path": path, "message": "File is not valid UTF-8; exact bytes are retained for repair."})
    files, identity = [], hashlib.sha256()
    for path in sorted(accepted, key=order):  # FORMAT, View identity
        data = accepted[path]
        text = decoded(data)
        entry = {"path": path, "content": text, "sha256": sha256(data), "bytes": len(data)}
        if text is None:
            entry["rawBase64"] = base64.b64encode(data).decode("ascii")
        files.append(entry)
        identity.update(b"%d:" % len(path.encode("utf-8")) + path.encode("utf-8") + b"%d:" % len(data) + data)
    atlas = None
    try:
        atlas = Validation({path: decoded(data) for path, data in accepted.items()}).run()
    except Broken as error:
        diagnostics.append(error.diagnostic)
    diagnostics.sort(key=lambda item: (order(item["path"]), order(item["code"]), order(item["message"])))
    status = "incomplete" if any(item["code"] in INCOMPLETE for item in diagnostics) else "invalid" if diagnostics else "ready"
    return {"format": "atlas.view/1", "status": status, "root": capture.root, "identity": identity.hexdigest(),
            "files": files, "diagnostics": diagnostics, "atlas": atlas if status == "ready" else None}


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"status": "invalid", "diagnostics": [{"code": "USAGE", "path": "", "message": "Usage: independent-reader.py ROOT"}]}))
        return 2
    view = read(sys.argv[1])
    print(json.dumps(view, ensure_ascii=True, separators=(",", ":")))
    return 0 if view["status"] == "ready" else 1


if __name__ == "__main__":
    sys.exit(main())
