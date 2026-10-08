"""Speakable text normalization for the Koda voice gateway.

TTS voices mangle engineering speech — file extensions (``.py``, ``.yml``), paths,
version strings, and acronyms all come out wrong or inconsistent. The neural voice
itself is fixed (we can't retrain it, and the free Edge endpoint ignores SSML), but
we *do* control the text it receives. So we rewrite those tokens into spoken forms
**before** synthesis.

This runs at the top of :meth:`EdgeTTSService.run_tts`, where Pipecat hands us a
full, sentence-aggregated string — never a token split across streamed chunks (e.g.
``config.toml`` always arrives intact). The pass is deterministic and voice-agnostic.

Pronunciations are *coined spellings*, tuned by ear — edit :data:`EXTENSIONS` to taste.
``.toml`` -> "tomml" and ``.yml``/``.yaml`` -> "yamml" were chosen deliberately.
"""

from __future__ import annotations

import re

# Coined spoken spellings for file extensions (tuned by ear; edit freely).
EXTENSIONS: dict[str, str] = {
    "py": "pie", "pyc": "pie see", "pyi": "pie eye",
    "js": "jay ess", "mjs": "em jay ess", "cjs": "see jay ess",
    "ts": "tee ess", "tsx": "tee ess ex", "jsx": "jay ess ex",
    "md": "em dee", "mdx": "em dee ex", "rst": "are ess tee", "txt": "text",
    "json": "jason", "jsonl": "jason ell",
    "yml": "yamml", "yaml": "yamml", "toml": "tomml",
    "ini": "eye en eye", "cfg": "config", "conf": "config", "env": "e en vee",
    "sh": "ess aitch", "bash": "bash", "zsh": "zee ess aitch", "fish": "fish",
    "rs": "are ess", "go": "go", "rb": "ruby", "java": "java", "kt": "kay tee",
    "swift": "swift", "c": "see", "cc": "see see", "cpp": "see plus plus",
    "h": "aitch", "hpp": "aitch plus plus",
    "css": "see ess ess", "scss": "sass", "sass": "sass", "less": "less",
    "html": "aitch tee em ell", "htm": "aitch tee em", "xml": "ex em ell",
    "csv": "see ess vee", "tsv": "tee ess vee",
    "sql": "sequel", "sqlite": "sequel light", "db": "dee bee",
    "log": "log", "lock": "lock",
    "png": "pee en gee", "jpg": "jay peg", "jpeg": "jay peg", "gif": "gif",
    "svg": "ess vee gee", "webp": "web pee", "pdf": "pee dee eff",
    "wav": "wave", "mp3": "em pee three", "mp4": "em pee four",
}

# True initialisms to spell out letter-by-letter (case-sensitive, whole-word).
# NB: deliberately excludes JSON/YAML/SQL — those are spoken as words ("jason",
# "yamml", "sequel"), handled via EXTENSIONS or read fine by the voice.
ACRONYMS: frozenset[str] = frozenset({
    "ACP", "LSP", "TTS", "STT", "VPS", "API", "CLI", "SDK", "URL", "URI",
    "HTTP", "HTTPS", "CI", "CD", "PR", "VAD", "PCM", "RPC", "GPU", "CPU",
    "RAM", "SSH", "UI", "UX", "ID", "OS", "IDE", "JWT", "CORS", "DNS", "TLS",
})

# Multi-token literals fixed up before the generic passes (order matters:
# longer / more specific first).
_LITERALS: tuple[tuple[str, str], ...] = (
    (".env.example", " dot e en vee dot example "),
    (".github", " dot github "),
    (".gitignore", " dot git-ignore "),
    ("JSON-RPC", " jason are pee see "),
)

_VERSION_RE = re.compile(r"\b(?:version\s+)?v(\d+)\.(\d+)(?:\.(\d+))?(?:-rc(\d+))?\b", re.IGNORECASE)
_ENV_RE = re.compile(r"\.env\b")
_UNDERSCORE_RE = re.compile(r"(?<=\w)_(?=\w)")
_PATH_RE = re.compile(r"(?<=\w)/(?=\w)")
_EXT_RE = re.compile(r"\.([A-Za-z0-9]+)\b")
_ACRONYM_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]{1,5}\b")
_WS_RE = re.compile(r"\s{2,}")


def _version_sub(m: re.Match) -> str:
    major, minor, patch, rc = m.groups()
    out = f"version {major} point {minor}"
    if patch is not None:
        out += f" point {patch}"
    if rc is not None:
        out += f", are see {rc}"
    return out


def _ext_sub(m: re.Match) -> str:
    ext = m.group(1).lower()
    if ext in EXTENSIONS:
        return " dot " + EXTENSIONS[ext]
    return m.group(0)  # leave unknown tokens & prose (e.g. "e.g.", "3.14") untouched


def _acronym_sub(m: re.Match) -> str:
    tok = m.group(0)
    return " ".join(tok) if tok in ACRONYMS else tok


def speakable(text: str) -> str:
    """Rewrite engineering tokens into TTS-friendly spoken forms.

    Safe on ordinary prose: only known file extensions and an explicit acronym
    allowlist are rewritten, so words like "e.g." or "U.S." pass through unchanged.
    """
    if not text:
        return text
    t = text
    for needle, spoken in _LITERALS:
        t = t.replace(needle, spoken)
    t = _ENV_RE.sub(" dot e en vee ", t)
    t = _VERSION_RE.sub(_version_sub, t)
    t = _UNDERSCORE_RE.sub(" ", t)        # tts_edge -> tts edge
    t = _PATH_RE.sub(" slash ", t)        # src/main -> src slash main
    t = _EXT_RE.sub(_ext_sub, t)          # .py -> dot pie  (known exts only)
    t = _ACRONYM_RE.sub(_acronym_sub, t)  # ACP -> A C P    (allowlist only)
    return _WS_RE.sub(" ", t).strip()


if __name__ == "__main__":
    # Self-test = the Verification Gate for this module. Run: python text_normalize.py
    cases = {
        "tts_edge.py": "tts edge dot pie",
        "main.py": "main dot pie",
        "requirements.txt": "requirements dot text",
        "config.toml": "config dot tomml",
        "ci.yml": "ci dot yamml",
        "deploy.yaml": "deploy dot yamml",
        "README.md": "README dot em dee",
        "theme.scss": "theme dot sass",
        "schema.sql": "schema dot sequel",
        ".gitignore": "dot git-ignore",
        "v2.0.0-rc1": "version 2 point 0 point 0, are see 1",
        "v1.2.3": "version 1 point 2 point 3",
        "version v3.4": "version 3 point 4",
        "the ACP seam": "the A C P seam",
        "JSON-RPC calls": "jason are pee see calls",
        "src/main.py": "src slash main dot pie",
        # prose must survive untouched:
        "e.g. the end.": "e.g. the end.",
        "It cost 3.14 dollars.": "It cost 3.14 dollars.",
    }
    failures = []
    for src, want in cases.items():
        got = speakable(src)
        ok = got == want
        print(f"{'ok  ' if ok else 'FAIL'} {src!r:34} -> {got!r}")
        if not ok:
            failures.append((src, want, got))
    if failures:
        print(f"\n{len(failures)} FAILED:")
        for src, want, got in failures:
            print(f"  {src!r}\n    want {want!r}\n    got  {got!r}")
        raise SystemExit(1)
    print(f"\nAll {len(cases)} cases passed.")
