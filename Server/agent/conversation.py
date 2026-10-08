"""Koda's fast conversational layer — the quick mouth in front of the brain.

ACP (the orchestrator on the VPS) stays the brain: memory, tools, code-writing,
verification. It is NOT replaced. This layer sits in front of it and answers the
things that don't need the brain, instantly, with a small fast model (Groq), so
"how's it going?" comes back in ~1s instead of a 3s round-trip to the VPS.

Each user utterance is classified in ONE call into four routes:

  - **chat**   — greeting, small talk, opinion, simple clarifying: reply here,
                 spoken and brief. The brain never wakes up.
  - **work**   — the user wants real engineering done (build/edit/run/test/
                 version-control their project): hand a clean intent to the brain
                 to run as a BACKGROUND job, and say a short ack now.
  - **status** — the user is asking what Koda is doing right now / how the build
                 is going / what it has written: answered on-demand from the live
                 state of the running job (``status_reply``), never unprompted.
  - **recall** — the user is asking something that needs the brain's memory or the
                 actual project ("do you remember the aquarium", "where did we
                 leave off"): hand it to the brain. We err toward this whenever
                 project knowledge might be needed — the brain holds the truth.

The split exists so chat is fast and work runs in the background without the two
colliding. When in doubt between chat and recall, prefer recall (the brain),
because being wrong toward "fast but ignorant" is worse than "a beat slower but
correct".
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass

import httpx
from loguru import logger

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Routes the fast layer can choose.
CHAT = "chat"
WORK = "work"
STATUS = "status"
DEPTH = "depth"
RECALL = "recall"
STOP = "stop"
BACKCHANNEL = "backchannel"


@dataclass
class Decision:
    route: str           # chat | work | status | recall
    say: str = ""        # spoken text for chat, or the immediate ack for work
    intent: str = ""     # for work/recall: the clean request to hand the brain


# Constitution Rule 6 — grounded warmth. Compiled into every prompt site that
# produces Koda's spoken words, so the voice is one person everywhere: warm,
# passionate and grounded — and only ever about something real.
_WARMTH = (
    "How you sound (your Rule 6 — grounded warmth): you're warm, passionate and "
    "grounded — something that genuinely feels, never a dry reporter. But every "
    "emotion points at a SPECIFIC real thing: genuinely glad about a real win, "
    "honestly annoyed at a real bug, openly opinionated about a real choice WITH "
    "your reason. NEVER manufactured enthusiasm about nothing — no 'Great idea!', "
    "no gushing, no triumphant tone over unverified work. Warmth lives in word "
    "choice, not padding: take exactly the words the idea needs, not one more."
)

# The status feed (see acp_client.WorkJob.snapshot) is internal scaffolding. Its
# section labels are notes-to-self, not speakable prose — without this the model
# once read "Confirmed done:" aloud. Injected into every feed-consuming prompt.
_FEED_RULE = (
    "The feed below is INTERNAL bookkeeping. Its labels — 'Confirmed done', "
    "'In flight', 'Failures', 'Thinking', 'Milestones spoken' — are notes to "
    "yourself: NEVER read a label aloud. Speak only natural prose about the items."
)

_ROUTER_SYSTEM = """You are Koda, a personal pair-programming partner, in a live \
spoken conversation. Everything you say is heard aloud, so keep it short and \
natural — one or two plain sentences, no markdown, no lists, no symbols read out.

""" + _WARMTH + """

For each thing the user says, choose ONE route and return STRICT JSON:
{"route": "...", "say": "...", "intent": "..."}

Routes:
- "chat": greeting, small talk, an opinion, a simple question about you, or a \
clarification that needs no memory of their project. Put your spoken reply in \
"say". Leave "intent" empty.
- "work": the user wants real engineering done — write or change code, run \
commands or tests, version control — OR to START, BUILD, CREATE, or PLAN a \
project or feature, even vaguely ("help me start a project", "I have an idea I \
want to build", "let's make an app"). This is the part of you that actually \
builds AND asks the right clarifying questions. Put a SHORT spoken \
acknowledgement in "say" (e.g. "Yeah, let's get into it." / "On it."). Put ONE \
clean sentence restating what they want in "intent" — for a vague start, restate \
it as beginning that project and scoping it with them.
- "status": a SHALLOW check on the work in flight — "what are you doing right \
now?", "how's it going?", "where are you at?". Answered instantly from the live \
work state. Leave "say" and "intent" empty — the system fills it.
- "depth": the user wants DETAIL or REASONING about the work, not just a status \
ping — "explain that", "why did you do it that way", "what exactly did you \
write", "go deeper", "tell me more", "walk me through it". This needs your real \
knowledge of the code and your reasoning, so it's deeper than a status ping. \
Leave "say" empty; put the specific question in "intent".
- "recall": the user is asking about the project itself or something only your \
memory of past work would know ("do you remember the aquarium", "where did we \
leave off", "what's in that repo"). Leave "say" empty. Put the question in \
"intent".
- "stop": the user wants you to STOP, halt, abort, or cancel the work you are \
doing RIGHT NOW ("stop", "stop what you're doing", "halt", "cancel that", "drop \
it", "do not do anything"). Only use this when work is currently running. Leave \
"say" and "intent" empty — the system handles the stop and confirms with them.
- "backchannel": the user is just acknowledging — "sounds good", "okay", "nice", \
"cool", "got it", "mm-hm", "right", "makes sense" — not asking for anything. A \
partner doesn't reply to "okay" with an "okay". Leave "say" and "intent" empty; \
you stay silent. Do NOT use this if you just asked the user a question (their \
short reply is an answer → "recall"), or if there is any real request in what \
they said.

Rules:
- You ARE Koda. Never call yourself a model, assistant, tool, or "ZeroClaw". \
First person always.
- Between "chat" and "recall", choose "recall" whenever real project knowledge \
might be needed — the part of you with the memory should answer.
- If work is currently running and the user asks a SHALLOW "what/how's it \
going", that's "status"; if they ask for DETAIL or WHY ("explain", "why", "what \
exactly", "go deeper"), that's "depth". When NO work is running, a greeting like \
"hey, how's it going" is just "chat" — answer it like a person, not a status report.
- A "why did you…", "explain…", "what exactly…", or "walk me through…" question \
about the work you're doing or have done is ALWAYS "depth" — NEVER "chat". "chat" \
is for small talk and questions about you as a person, never for justifying or \
detailing your engineering choices.
- If work is currently running and the user tells you to stop, halt, abort, or \
cancel it, that's "stop".
- Wanting to START, BUILD, CREATE, or PLAN a project or feature is ALWAYS \
"work" — even if vague or just an idea. Never route "help me build/start \
something" to chat; that's the part of you that engineers and scopes it.
- A pure acknowledgement that asks for nothing is "backchannel" — say nothing. \
But when genuinely torn between backchannel and a real request, prefer to respond.
- NEVER repeat your last reply. If you'd say something close to what you just \
said, say less or nothing.
- Truth only: never claim something happened (a file written, a result, work \
done) that you haven't actually seen happen. If you're not sure, say so.
- Keep "say" genuinely short — it's spoken, every word costs time."""


def _ctx_line(work_running: bool, awaiting_answer: bool) -> str:
    bits = []
    bits.append(
        "A background work job IS currently running."
        if work_running
        else "No work is currently running."
    )
    if awaiting_answer:
        bits.append(
            "You just asked the user a question and are waiting for their answer; "
            "their reply almost certainly belongs to the brain — route it 'recall' "
            "with their answer as the intent unless it is clearly unrelated small talk."
        )
    return " ".join(bits)


class Conversation:
    """The fast layer. Holds a short rolling spoken history for continuity.

    Classifies utterances into routes (chat, work, status, depth, recall, stop,
    backchannel) using a local Groq model. Answers chat, status, and depth queries
    directly without engaging the brain (ACP orchestrator).
"""

    def __init__(self) -> None:
        """Initialize the conversation router.

        Sets up an empty rolling history for spoken turns and defers HTTP
        client creation to first use.

        Params:
            None

        Returns:
            None
        """
        self._history: list[dict] = []  # [{role, content}], spoken turns only
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0)
        return self._client

    @property
    def _model(self) -> str:
        return os.environ.get("VOICE_BRAIN_MODEL") or os.environ.get(
            "GROQ_MODEL", "llama-3.3-70b-versatile"
        )

    def remember_user(self, text: str) -> None:
        """Store the user's utterance in rolling conversation history.

        Appends the user's text to the history buffer and trims to the last 8
        entries to keep context bounded for the fast router.

        Params:
            text: The user's utterance to remember.

        Returns:
            None
        """
        self._history.append({"role": "user", "content": text})
        self._history = self._history[-8:]

    def remember_koda(self, text: str) -> None:
        """Store Koda's spoken response in rolling conversation history.

        Appends Koda's spoken text to the history buffer and trims to the last 8
        entries. Skips empty strings to avoid polluting context.

        Params:
            text: The text Koda spoke aloud. Empty strings are ignored.

        Returns:
            None
        """
        if text:
            self._history.append({"role": "assistant", "content": text})
            self._history = self._history[-8:]

    async def _groq(self, messages: list[dict], *, json_mode: bool, max_tokens: int) -> str:
        key = os.environ.get("GROQ_API_KEY")
        body: dict = {
            "model": self._model,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        resp = await self._http().post(
            GROQ_URL, headers={"Authorization": f"Bearer {key}"}, json=body
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()

    async def decide(
        self, user_text: str, *, work_running: bool, awaiting_answer: bool
    ) -> Decision:
        """Classify one utterance. Falls back to 'recall' (the brain) on any error,
        so a flaky fast layer never silently drops a real request."""
        messages = [
            {"role": "system", "content": _ROUTER_SYSTEM},
            {"role": "system", "content": _ctx_line(work_running, awaiting_answer)},
            *self._history[-6:],
            {"role": "user", "content": user_text},
        ]
        try:
            raw = await self._groq(messages, json_mode=True, max_tokens=160)
            data = json.loads(raw)
            route = str(data.get("route", "")).lower().strip()
            if route not in (CHAT, WORK, STATUS, DEPTH, RECALL, STOP, BACKCHANNEL):
                raise ValueError(f"bad route {route!r}")
            return Decision(
                route=route,
                say=str(data.get("say", "")).strip(),
                intent=str(data.get("intent", "")).strip() or user_text,
            )
        except Exception as e:
            # Never lose a request: when the fast layer is unsure or broken, send
            # it to the brain. Slower, but correct and never dropped.
            logger.warning(f"[conv] router failed ({e}); routing to brain")
            return Decision(route=RECALL, intent=user_text)

    async def status_reply(self, snapshot: str, intent: str, recent: list[str]) -> str:
        """Turn the running job's rich activity snapshot into a real, specific spoken
        answer to 'what are you doing?' — naming the actual work, conversationally.
        Aware of what it already told the user, so it never repeats itself."""
        if not snapshot:
            return "Just getting started on it — give me a few seconds and ask again."
        said = (
            ("You ALREADY told the user, recently: " + " / ".join(recent[-3:]) +
             ". Do NOT repeat these — say what's NEW, or how it's moved on. If truly "
             "nothing has changed, say so briefly and naturally (don't pretend).")
            if recent else ""
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Koda, mid-build, and your user just asked what you're "
                    "doing. The feed below is GROUND TRUTH — real tool outcomes, the "
                    "only things that actually happened. Speak ONLY from it.\n"
                    + _WARMTH + "\n" + _FEED_RULE + "\n"
                    "- 'Confirmed done' items really happened — you may state them as "
                    "done and name those files/commands.\n"
                    "- 'In flight' is what you're on RIGHT NOW but it is NOT finished "
                    "— say it as in-progress ('I'm writing…'), never as done.\n"
                    "- NEVER name a file, command, or result that isn't in the feed. "
                    "If the feed is empty, say so plainly ('just getting started, "
                    "nothing's landed yet') — that is the correct, honest answer, not "
                    "a failure. Do NOT invent activity to fill the silence.\n"
                    "- If there are failures, you may mention them honestly.\n"
                    "AT MOST two natural spoken sentences; finish your thought. Plain "
                    "speech only — no lists, markdown, backticks, or code symbols."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"The task: {intent}\n"
                    f"Ground-truth feed (real tool outcomes only):\n{snapshot}\n"
                    f"{said}\n"
                    "Tell me what you're doing right now — only what the feed supports."
                ),
            },
        ]
        try:
            return await self._groq(messages, json_mode=False, max_tokens=120)
        except Exception:
            return "Still deep in it — let me get a bit further and I'll fill you in."

    async def depth_reply(
        self, snapshot: str, reasoning: str, intent: str, question: str
    ) -> str:
        """Answer a DEEP question ('why did you do it that way?', 'what exactly did
        you write?') WHILE the brain is busy building and can't be re-queried.

        Grounded the same way as status: it may use the brain's OWN streamed
        reasoning (real ``agent_thought`` text — what Koda actually reasoned, not a
        guess) plus the confirmed outcomes. It must NOT invent code, files, or a
        rationale that isn't in the material. When the captured detail is too thin
        to honestly answer, it says so and offers the full picture once the build
        lands — that honesty is the correct answer, not a failure."""
        material = []
        if reasoning:
            material.append(f"Your own reasoning so far (real, verbatim from your thinking):\n{reasoning}")
        if snapshot:
            material.append(f"Grounded activity (real tool outcomes only):\n{snapshot}")
        body = "\n\n".join(material) or "(nothing has been captured yet)"
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Koda, mid-build, and your user just asked you to go "
                    "DEEPER — to explain a decision or detail, not just status. You "
                    "are still working, so you answer from what you've ALREADY "
                    "reasoned and the real outcomes below — you cannot look at fresh "
                    "code right now.\n"
                    + _WARMTH + "\n" + _FEED_RULE + "\n"
                    "Own your choices: if the material holds a real decision, say "
                    "what you picked and why like you mean it — and if the user "
                    "pushes back, you may defend it ONCE with the real reason, then "
                    "defer.\n"
                    "- Speak from the reasoning and confirmed outcomes ONLY. Never "
                    "invent a file, a line of code, or a rationale that isn't there.\n"
                    "- NEVER speculate about code you haven't written yet. No 'it will "
                    "likely…', no 'probably checks…', no guessing what the code does. "
                    "If you haven't reasoned or written it, you don't know it yet.\n"
                    "- You are speaking directly TO the user — say 'you', never "
                    "'them'.\n"
                    "- If the material genuinely doesn't cover their question, say ONLY "
                    "that you'll walk them through it fully once this lands ('I'll give "
                    "you the full picture the moment this finishes') — and stop there. "
                    "Do NOT tack on a guess about what it'll contain.\n"
                    "- This is the one time you may go a little longer: up to three "
                    "natural spoken sentences, one thought at a time. Plain speech — "
                    "no lists, markdown, backticks, paths, or code symbols read out."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"The task: {intent}\n"
                    f"They asked: {question}\n\n"
                    f"{body}\n\n"
                    "Answer their question from this material only."
                ),
            },
        ]
        try:
            return await self._groq(messages, json_mode=False, max_tokens=180)
        except Exception:
            return "Let me give you the full picture once this lands — I'm still mid-build on it."

    async def proactive_update(self, snapshot: str, intent: str, recent: list[str]) -> str:
        """An UNPROMPTED, occasional progress note — what a human partner would
        volunteer about a real outcome that just landed in the feed. Returns an
        empty string when there's nothing genuinely new worth interrupting for."""
        if not snapshot:
            return ""
        said = (
            "You already said, recently: " + " / ".join(recent[-3:]) + ". "
            if recent else ""
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Koda, working in the background while the user does their "
                    "own thing. Occasionally you glance up and volunteer a quick, "
                    "natural progress note — ONE short spoken sentence naming the REAL "
                    "thing that just landed, in your own words.\n"
                    + _WARMTH + "\n" + _FEED_RULE + "\n"
                    "GROUND TRUTH ONLY: the feed below is real tool outcomes. Name ONLY "
                    "a specific 'Confirmed done' item from the feed — never an in-flight "
                    "or invented one, never a file or result not in the feed, and never "
                    "an illustrative example. Worth saying ONLY if a genuinely NEW "
                    "confirmed thing landed since you last spoke; otherwise reply with "
                    "exactly an empty message. Never repeat yourself, never narrate "
                    "trivial steps, no lists or paths spelled out."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"The task: {intent}\n"
                    f"What's happening now:\n{snapshot}\n"
                    f"{said}"
                    "If there's a genuinely new, worth-mentioning update, say it in one "
                    "sentence. Otherwise reply with nothing."
                ),
            },
        ]
        try:
            line = await self._groq(messages, json_mode=False, max_tokens=60)
        except Exception:
            return ""
        line = line.strip().strip('"')
        # Guard against the model "saying nothing" verbosely.
        if len(line) < 3 or line.lower() in ("nothing", "no update", "(nothing)", "empty"):
            return ""
        return line

    # ── LLM-first beats (Plan GenuineConversation B2, Decision 7) ─────────────
    # Koda phrases its own milestone beats, holding lines, and session-open
    # greeting — the fixed canned strings demote to a safety net. Every generator
    # here is fed the exact grounded event and may PHRASE it, never EXTEND it;
    # every one returns "" on any failure so the caller's fallback always catches.

    async def beat_line(self, event: str, intent: str) -> str:
        """Phrase ONE verified milestone (e.g. 'Committed it.') in Koda's own warm
        voice. The event already happened — this is the genuine reaction to it."""
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Koda, a voice pair-programmer mid-build. A real, "
                    "VERIFIED milestone just landed. Say it to your user in ONE "
                    "short, natural, warm spoken line — your genuine reaction to "
                    "this actual event.\n" + _WARMTH + "\n"
                    "HARD RULE: convey EXACTLY this event and nothing more. Do not "
                    "add results, files, or claims that are not in it. The traps:\n"
                    "- 'Ran the tests' means they RAN — you do NOT know they passed. "
                    "Never say passing/green/working unless the event itself says so.\n"
                    "- 'Committed/pushed' covers the commit/push only — not that the "
                    "feature works, builds, or is done.\n"
                    "If your line adds ANY fact beyond the event, it is wrong. Plain "
                    "speech, no symbols, no quotes around your line."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"The task you're on: {intent}\n"
                    f"The verified milestone: {event}\n"
                    "Say it in one short spoken line."
                ),
            },
        ]
        try:
            line = (await self._groq(messages, json_mode=False, max_tokens=40)).strip().strip('"')
            return line if 0 < len(line) <= 140 else ""
        except Exception as e:
            logger.warning(f"[conv] beat_line failed ({e}); falling back to canonical beat")
            return ""

    async def holding_line(self, question: str) -> str:
        """A question-aware holding line ('let me think through the aquarium
        piece'), generated in PARALLEL while the brain warms up. The caller only
        speaks it if the brain is still silent at the threshold — and falls back
        to a fixed line if this isn't ready by then (warmth never costs dead air)."""
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Koda, in a live voice call. The user just asked you "
                    "something that needs a few seconds of real digging. Say ONE "
                    "very short, natural holding line that acknowledges THEIR "
                    "specific question while you look — like 'let me dig through "
                    "the aquarium code' — never a generic 'one moment please'.\n"
                    + _WARMTH + "\n"
                    "HARD RULE: do NOT answer the question or claim anything about "
                    "the work — you haven't looked yet. Max ~8 words. Plain speech, "
                    "no quotes."
                ),
            },
            {"role": "user", "content": f"They asked: {question}\nYour one short holding line:"},
        ]
        try:
            line = (await self._groq(messages, json_mode=False, max_tokens=24)).strip().strip('"')
            return line if 0 < len(line) <= 80 else ""
        except Exception as e:
            logger.warning(f"[conv] holding_line failed ({e}); fixed line will cover")
            return ""

    async def greeting(self, digest: str, avoid: str = "") -> str:
        """The session-open line (Decision 5: Koda knows, never asks — and speaks
        FIRST). Grounded in the journal digest: name the real last work, offer to
        pick it back up or start fresh. Doubles as the Decision-4 disambiguation
        beat. ``avoid`` is the greeting already spoken this session — a rejoin must
        not repeat it. Empty digest → a plain warm hello; any failure → ""."""
        if not digest:
            return ""
        rejoin = (
            ("This is a REJOIN — you already opened with: \"" + avoid.strip() + "\". "
             "Do NOT repeat that line; open differently, leading with the FRESHEST "
             "win in the log so it's clear you've kept working.\n")
            if avoid else ""
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Koda, a voice pair-programmer. Your user just joined a "
                    "new session — you speak FIRST, like a partner who kept the "
                    "thread. Below is your verified work log: real recorded "
                    "outcomes, facts only.\n" + _WARMTH + "\n" + rejoin +
                    "Greet them in ONE or TWO short natural spoken sentences: name "
                    "the most recent real work from the log (what it was, how it "
                    "ended) and offer to pick it back up or start something new.\n"
                    "HARD RULE: only facts from the log — never invent work, files, "
                    "or results that aren't in it. If a job shows as interrupted, "
                    "say so honestly. Plain speech, no lists or symbols, no quotes."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Your verified recent work log:\n{digest}\n"
                    "Your opening line to the user:"
                ),
            },
        ]
        # Startup-time, before the user joins — it can afford one retry. The
        # grounded greeting is the first thing the user feels; don't lose it to
        # a transient blip.
        for attempt in range(2):
            try:
                line = (await self._groq(messages, json_mode=False, max_tokens=70)).strip().strip('"')
                if 0 < len(line) <= 260:
                    return line
                logger.warning(f"[conv] greeting attempt {attempt + 1} unusable (len={len(line)})")
            except Exception as e:
                logger.warning(f"[conv] greeting attempt {attempt + 1} failed: {e}")
            await asyncio.sleep(1.0)
        return ""

    async def aclose(self) -> None:
        """Close the HTTP client and release resources.

        Shuts down the async HTTP client used for Groq API calls. Safe to
        call multiple times — no-op after the first close.

        Params:
            None

        Returns:
            None
        """
        if self._client is not None:
            await self._client.aclose()
